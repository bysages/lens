import { createIPX, ipxHttpStorage, ipxFSStorage, createIPXFetchHandler } from "ipx";
import { defineHandler, HTTPError, getRouterParam } from "nitro/h3";
import { hash } from "ohash";
import { env } from "std-env";

import { serveCached } from "../../utils/cache";
import {
  CACHE_MEDIUM,
  IMAGE_PROXY_TTL,
  IMAGE_RATE_LIMIT,
  MAX_CACHE_ENTRY_BYTES,
  RATE_WINDOW,
} from "../../utils/constants";
import { rateLimit } from "../../utils/rate-limit";
import { assertSafeUrl } from "../../utils/ssrf";

// Parse allowed domains from environment
export const allowedDomains = env.ALLOWED_DOMAINS
  ? env.ALLOWED_DOMAINS.split(",")
      .map((d) => d.trim())
      .filter(Boolean)
  : [];

// Create IPX instance
export const ipx = createIPX({
  storage: ipxFSStorage({ dir: "./public" }),
  httpStorage: ipxHttpStorage({
    domains: allowedDomains,
    allowAllDomains: allowedDomains.length === 0,
    maxAge: IMAGE_PROXY_TTL,
  }),
  maxAge: IMAGE_PROXY_TTL,
});

const fetchHandler = createIPXFetchHandler(ipx);

/**
 * IPX only enforces its domain allowlist; the source id is otherwise
 * fetched as-is. IPX builds the id from everything after the modifiers
 * segment and decodes it (its validateId decodes a second time), so
 * replicate that here and run every remote URL the request could fetch
 * through the private-network check. Scheme slashes may be collapsed to
 * one by URL normalization along the way, so both forms are covered.
 */
async function assertSafeSource(path: string): Promise<void> {
  const rawId = path.split("/").filter(Boolean).slice(1).join("/");
  const candidates = [rawId];
  let decoded = rawId;
  for (let depth = 0; depth < 2; depth++) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      break;
    }
    candidates.push(decoded);
  }

  for (const candidate of candidates) {
    const normalized = candidate.replace(/^(https?:)\/{1,2}/i, "$1//");
    const match = normalized.match(/^https?:\/\/([^/?#\\\s]+)/i);
    if (match) {
      await assertSafeUrl(`http://${match[1]}`);
    }
  }
}

export default defineHandler(async (event) => {
  const path = getRouterParam(event, "_") || "";
  if (!path) {
    throw new HTTPError({ status: 400, message: "Missing image path" });
  }

  await assertSafeSource(path);

  const ipxPath = "/" + path;
  const url = new URL(event.req.url);
  url.pathname = ipxPath;

  const cacheKey = `img:${hash(ipxPath)}`;

  const data = await serveCached(event, {
    key: cacheKey,
    ttl: IMAGE_PROXY_TTL,
    contentType: "image/png",
    cacheControl: CACHE_MEDIUM,
    maxBytes: MAX_CACHE_ENTRY_BYTES,
    produce: async () => {
      await rateLimit(event, { limit: IMAGE_RATE_LIMIT, window: RATE_WINDOW, scope: "img" });

      const response = await fetchHandler(new Request(url, event.req));
      // Error bodies must neither be served as images nor poison the cache
      if (!response.ok) {
        throw new HTTPError({ status: response.status, message: "Image processing failed" });
      }

      return {
        data: Buffer.from(await response.bytes()),
        contentType: response.headers.get("content-type") || "image/png",
      };
    },
  });

  // Mirror IPX's own response hardening for processed images
  if (data) {
    event.res.headers.set("Content-Security-Policy", "default-src 'none'");
  }
  return data;
});
