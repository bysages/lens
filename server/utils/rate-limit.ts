import { H3Event, HTTPError, getRequestIP } from "nitro/h3";
import { useStorage } from "nitro/storage";
import { hash } from "ohash";

export interface RateLimitOptions {
  /** Max requests within window */
  limit: number;
  /** Window duration in seconds */
  window: number;
}

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
  for (const header of IP_HEADERS) {
    const value = event.req.headers.get(header);
    if (value) {
      const ip = value.split(",")[0]?.trim();
      if (ip) return ip;
    }
  }
  return getRequestIP(event, { xForwardedFor: true }) || "unknown";
}

/**
 * Rate limit using unstorage (Redis when available, memory otherwise).
 * Non-atomic but acceptable for rate limiting purposes.
 */
export async function rateLimit(event: H3Event, options: RateLimitOptions): Promise<void> {
  const storage = useStorage("cache");
  const ip = hash(getClientIP(event));
  const key = `ratelimit:${ip}`;

  const current = ((await storage.getItem<number>(key)) || 0) + 1;

  if (current > options.limit) {
    throw new HTTPError({
      status: 429,
      message: "Too many requests",
    });
  }

  await storage.setItem(key, current, { ttl: options.window });
}
