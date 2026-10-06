import { H3Event, HTTPError, getRequestIP } from "nitro/h3";
import { useStorage } from "nitro/storage";
import { hash } from "ohash";

// Forwarded headers are only honored when the deployment actually sits
// behind a trusted proxy (TRUST_PROXY=1). Without it, any client can set
// these headers itself and rotate rate-limit buckets at will.
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || "");

const IP_HEADERS = [
  "true-client-ip",
  "cf-connecting-ip",
  "x-vercel-forwarded-for",
  "fly-client-ip",
  "fastly-client-ip",
  "x-forwarded-for",
  "x-real-ip",
];

export function getClientIP(event: Parameters<typeof getRequestIP>[0]): string {
  if (TRUST_PROXY) {
    for (const header of IP_HEADERS) {
      const value = event.req.headers.get(header);
      if (value) {
        const ip = value.split(",")[0]?.trim();
        if (ip) return ip;
      }
    }
    return getRequestIP(event, { xForwardedFor: true }) || "unknown";
  }
  return getRequestIP(event, { xForwardedFor: false }) || "unknown";
}

export interface RateLimitOptions {
  /** Max requests within the fixed window */
  limit: number;
  /** Window duration in seconds */
  window: number;
  /** Bucket namespace — endpoints sharing a scope share a counter */
  scope?: string;
}

interface RateWindowState {
  count: number;
  expiresAt: number;
}

/**
 * Fixed-window rate limit over unstorage (Redis shared across workers when
 * REDIS_URL is set, per-worker memory otherwise). The read-modify-write is
 * not atomic, so concurrent bursts may exceed the limit slightly —
 * acceptable for a protective limit.
 */
const localRateStates = new Map<string, RateWindowState>();
const LOCAL_RATE_LIMIT_CAPACITY = 10_000;

/** Keep the degraded limiter bounded when Redis is briefly unavailable. */
function rememberLocalRate(key: string, value: RateWindowState): void {
  if (localRateStates.size >= LOCAL_RATE_LIMIT_CAPACITY) {
    const now = Date.now();
    for (const [expiredKey, state] of localRateStates) {
      if (state.expiresAt <= now) localRateStates.delete(expiredKey);
      if (localRateStates.size < LOCAL_RATE_LIMIT_CAPACITY) break;
    }
    if (localRateStates.size >= LOCAL_RATE_LIMIT_CAPACITY) {
      const oldest = localRateStates.keys().next().value;
      if (oldest !== undefined) localRateStates.delete(oldest);
    }
  }
  localRateStates.set(key, value);
}

async function readRateState(
  storage: ReturnType<typeof useStorage>,
  key: string,
): Promise<RateWindowState | null> {
  try {
    return (await storage.getItem<RateWindowState>(key)) ?? null;
  } catch {
    const state = localRateStates.get(key);
    return state && state.expiresAt > Date.now() ? state : null;
  }
}

async function writeRateState(
  storage: ReturnType<typeof useStorage>,
  key: string,
  value: RateWindowState,
  ttl: number,
): Promise<void> {
  try {
    await storage.setItem(key, value, { ttl });
    localRateStates.delete(key);
  } catch {
    rememberLocalRate(key, value);
  }
}

export async function rateLimit(event: H3Event, options: RateLimitOptions): Promise<void> {
  const storage = useStorage("cache");
  const key = `ratelimit:${options.scope ? `${options.scope}:` : ""}${hash(getClientIP(event))}`;
  const now = Date.now();

  const state = await readRateState(storage, key);
  const expired = !state || state.expiresAt <= now;
  const count = (expired ? 0 : state.count) + 1;

  if (count > options.limit) {
    throw new HTTPError({
      status: 429,
      message: "Too many requests",
    });
  }

  // expiresAt enforces the fixed window; the storage ttl is only a safety
  // net so abandoned keys cannot outlive their window indefinitely.
  const value: RateWindowState = expired
    ? { count, expiresAt: now + options.window * 1000 }
    : { count, expiresAt: state.expiresAt };
  await writeRateState(storage, key, value, options.window);
}
