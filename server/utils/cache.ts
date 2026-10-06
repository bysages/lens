import { createHash, randomUUID } from "node:crypto";

import { HTTPError, type H3Event } from "nitro/h3";
import { useStorage } from "nitro/storage";

import { getRedis } from "./redis";

export interface CacheEntry {
  data: Buffer | string;
  /** Content type when it differs from the route's default */
  contentType?: string;
}

export interface ServeCachedOptions {
  key: string;
  ttl: number;
  /** Response content type when the payload does not carry a more specific one */
  contentType: string;
  cacheControl: string;
  /** Skip persisting entries above this size — the memory driver has no eviction */
  maxBytes?: number;
  produce: () => Promise<CacheEntry>;
}

interface CachePayload {
  data: Buffer | string;
  etag: string;
  contentType: string;
}

/** Strong ETag derived from the payload bytes, not the request parameters. */
function strongETag(data: Buffer | string): string {
  return `"${createHash("sha256").update(data).digest("hex").slice(0, 32)}"`;
}

function matchesIfNoneMatch(event: H3Event, etag: string): boolean {
  const header = event.req.headers.get("if-none-match");
  if (!header) return false;
  return header.split(",").some((candidate) => {
    const value = candidate.trim();
    return value === etag || value === `W/${etag}` || value === "*";
  });
}

const localRefreshes = new Map<string, Promise<unknown>>();

async function runLocallyOnce<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const existing = localRefreshes.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const refresh = operation().finally(() => {
    localRefreshes.delete(key);
  });
  localRefreshes.set(key, refresh);
  return refresh;
}

const RELEASE_LOCK_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

/**
 * Best-effort cross-worker single-flight. If Redis is unavailable we degrade to
 * the process-local lock above instead of making cache misses unavailable.
 */
async function withCacheLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  if (!redis) return operation();

  const lockKey = `lens:cache-lock:${key}`;
  const token = randomUUID();
  const deadline = Date.now() + 30_000;

  for (;;) {
    let acquired: string | null;
    try {
      acquired = await redis.set(lockKey, token, "PX", 120_000, "NX");
    } catch {
      return operation();
    }

    if (acquired === "OK") {
      try {
        return await operation();
      } finally {
        await redis.eval(RELEASE_LOCK_LUA, 1, lockKey, token).catch(() => {});
      }
    }

    if (Date.now() >= deadline) {
      throw new HTTPError({ status: 503, message: "Cache refresh is busy" });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Shared cache/ETag/304 handling for the response routes: reads through the
 * "cache" mount, negotiates If-None-Match against the payload's strong ETag,
 * and persists fresh payloads with ETag and content type in metadata.
 * Returns null for a 304 response.
 */
export async function serveCached(
  event: H3Event,
  options: ServeCachedOptions,
): Promise<Buffer | string | null> {
  const storage = useStorage("cache");
  const cached = await storage.getItemRaw<Uint8Array | string>(options.key);

  if (cached != null) {
    const meta = await storage.getMeta(options.key);
    const etag =
      typeof meta?.etag === "string"
        ? meta.etag
        : strongETag(typeof cached === "string" ? cached : Buffer.from(cached));
    if (matchesIfNoneMatch(event, etag)) {
      event.res.status = 304;
      event.res.headers.set("ETag", etag);
      event.res.headers.set("Cache-Control", options.cacheControl);
      return null;
    }
    event.res.headers.set("ETag", etag);
    event.res.headers.set("X-Cache", "HIT");
    event.res.headers.set(
      "Content-Type",
      typeof meta?.contentType === "string" ? meta.contentType : options.contentType,
    );
    event.res.headers.set("Cache-Control", options.cacheControl);
    return typeof cached === "string" ? cached : Buffer.from(cached);
  }

  const payload = await runLocallyOnce(options.key, () =>
    withCacheLock(options.key, async (): Promise<CachePayload> => {
      // Another worker may have refreshed the value while this request waited.
      const refreshed = await storage.getItemRaw<Uint8Array | string>(options.key);
      if (refreshed != null) {
        const meta = await storage.getMeta(options.key);
        return {
          data: typeof refreshed === "string" ? refreshed : Buffer.from(refreshed),
          etag:
            typeof meta?.etag === "string"
              ? meta.etag
              : strongETag(typeof refreshed === "string" ? refreshed : Buffer.from(refreshed)),
          contentType:
            typeof meta?.contentType === "string" ? meta.contentType : options.contentType,
        };
      }

      const entry = await options.produce();
      const etag = strongETag(entry.data);
      const contentType = entry.contentType ?? options.contentType;

      // Persist before returning so queued single-flight followers can hit it.
      // Respect maxBytes so a huge capture cannot turn the cache into RSS growth.
      const size =
        typeof entry.data === "string"
          ? Buffer.byteLength(entry.data, "utf8")
          : entry.data.byteLength;
      if (!options.maxBytes || size <= options.maxBytes) {
        await Promise.all([
          storage.setItemRaw(
            options.key,
            typeof entry.data === "string" ? entry.data : new Uint8Array(entry.data),
            { ttl: options.ttl },
          ),
          storage.setMeta(options.key, { etag, contentType }, { ttl: options.ttl }),
        ]);
      }
      return { data: entry.data, etag, contentType };
    }),
  );

  event.res.headers.set("ETag", payload.etag);
  event.res.headers.set("X-Cache", "MISS");
  event.res.headers.set("Content-Type", payload.contentType);
  event.res.headers.set("Cache-Control", options.cacheControl);
  return payload.data;
}
