import { randomUUID } from "node:crypto";

import type Redis from "ioredis";
import { HTTPError } from "nitro/h3";

import { BROWSER_MAX_CONCURRENCY, BROWSER_QUEUE_TIMEOUT } from "./constants";
import { getRedis } from "./redis";

const REDIS_KEY = "lens:browser:permits";

const ACQUIRE_LUA = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])
if tonumber(redis.call("ZCARD", KEYS[1])) >= tonumber(ARGV[2]) then
  return 0
end
redis.call("ZADD", KEYS[1], ARGV[4], ARGV[3])
redis.call("PEXPIRE", KEYS[1], ARGV[5])
return 1
`;

function positiveInt(name: string, fallback: number, max: number): number {
  const value = Number.parseInt(process.env[name] || "", 10);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(value, max);
}

function concurrencyLimit(): number {
  return positiveInt("BROWSER_MAX_CONCURRENCY", BROWSER_MAX_CONCURRENCY, 64);
}

function queueTimeout(): number {
  return positiveInt("BROWSER_QUEUE_TIMEOUT", BROWSER_QUEUE_TIMEOUT, 60_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Release = () => Promise<void>;

let localActive = 0;

async function acquireLocal(limit: number, timeoutMs: number): Promise<Release> {
  const deadline = Date.now() + timeoutMs;

  while (localActive >= limit) {
    if (Date.now() >= deadline) {
      throw new HTTPError({ status: 503, message: "Browser is busy" });
    }
    await sleep(100);
  }

  localActive++;
  let released = false;
  return () => {
    if (released) return Promise.resolve();
    released = true;
    localActive--;
    return Promise.resolve();
  };
}

async function acquireRedis(redis: Redis, limit: number, timeoutMs: number): Promise<Release> {
  const lease = randomUUID();
  const deadline = Date.now() + timeoutMs;
  const leaseMs = timeoutMs + 60_000;

  while (Date.now() < deadline) {
    const now = Date.now();
    const acquired = Number(
      await redis.eval(
        ACQUIRE_LUA,
        1,
        REDIS_KEY,
        now.toString(),
        limit.toString(),
        lease,
        (now + leaseMs).toString(),
        leaseMs.toString(),
      ),
    );

    if (acquired === 1) {
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await redis.zrem(REDIS_KEY, lease).catch(() => {});
      };
    }

    await sleep(100);
  }

  throw new HTTPError({ status: 503, message: "Browser is busy" });
}

/**
 * Acquire the most restrictive available slot. Redis transport failures fall
 * back to the process semaphore rather than turning a cacheable render into a
 * 500; explicit queue timeouts still propagate as 503.
 */
async function acquireSlot(): Promise<Release> {
  const redis = getRedis();
  if (!redis) return acquireLocal(concurrencyLimit(), queueTimeout());

  try {
    return await acquireRedis(redis, concurrencyLimit(), queueTimeout());
  } catch (error) {
    if (error instanceof HTTPError) throw error;
    return acquireLocal(concurrencyLimit(), queueTimeout());
  }
}

/**
 * Limit Moli pages globally when Redis is available. The fallback is still a
 * bounded process semaphore, so a deployment without Redis cannot fan out
 * indefinitely inside one worker.
 */
export async function withBrowserSlot<T>(operation: () => Promise<T>): Promise<T> {
  const release = await acquireSlot();

  try {
    return await operation();
  } finally {
    await release();
  }
}
