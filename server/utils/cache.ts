import { createHash } from "node:crypto";

import type { H3Event } from "nitro/h3";
import { useStorage } from "nitro/storage";

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

  if (cached) {
    const meta = await storage.getMeta(options.key);
    const etag =
      typeof meta?.etag === "string"
        ? meta.etag
        : strongETag(typeof cached === "string" ? cached : Buffer.from(cached));
    if (matchesIfNoneMatch(event, etag)) {
      // 304 responses still carry the validators clients need (RFC 9110 §15.4.5)
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

  const entry = await options.produce();
  const etag = strongETag(entry.data);
  const contentType = entry.contentType ?? options.contentType;

  event.waitUntil(
    Promise.all([
      storage.setItemRaw(
        options.key,
        typeof entry.data === "string" ? entry.data : new Uint8Array(entry.data),
        { ttl: options.ttl },
      ),
      storage.setMeta(options.key, { etag, contentType }, { ttl: options.ttl }),
    ]),
  );

  event.res.headers.set("ETag", etag);
  event.res.headers.set("X-Cache", "MISS");
  event.res.headers.set("Content-Type", contentType);
  event.res.headers.set("Cache-Control", options.cacheControl);

  return entry.data;
}
