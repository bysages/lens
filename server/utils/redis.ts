import Redis, { type Redis as RedisClient } from "ioredis";

let client: RedisClient | null = null;
let lastErrorAt = 0;

/**
 * Shared Redis client for coordination that must be cluster-wide (browser
 * permits and cache single-flight). Commands fail fast when Redis is offline;
 * callers fall back to process-local behavior only where that is safe.
 */
export function getRedis(): RedisClient | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (client) return client;

  client = new Redis(url, {
    connectTimeout: 2_000,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
  });
  client.on("error", (error) => {
    const now = Date.now();
    if (now - lastErrorAt > 30_000) {
      lastErrorAt = now;
      console.warn("[redis] coordination unavailable:", error.message);
    }
  });
  return client;
}
