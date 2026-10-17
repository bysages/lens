import { defineHandler, HTTPError, getRouterParam } from "nitro/h3";
import { hash } from "ohash";
import { env } from "std-env";
import {
  createImageProxy,
  createImageProxyFetchHandler,
  fsDriver,
  httpDriver,
} from "unimage/server";

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

const imageProxy = createImageProxy({
  storage: fsDriver({ dir: "./public", maxAge: IMAGE_PROXY_TTL }),
  httpStorage: httpDriver({
    domains: allowedDomains,
    allowAllDomains: allowedDomains.length === 0,
    blockPrivateIPs: true,
    maxAge: IMAGE_PROXY_TTL,
  }),
  maxAge: IMAGE_PROXY_TTL,
});

const fetchHandler = createImageProxyFetchHandler(imageProxy);

/**
 * UnImage only enforces its domain allowlist; the source id is otherwise
 * fetched as-is. The URL parser decodes the source once and HTTP storage
 * decodes it once more, so replicate both forms here and run every remote URL
 * the request could fetch through the private-network check. Scheme slashes
 * may be collapsed to one by URL normalization along the way, so both forms
 * are covered.
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

  const proxyPath = "/" + path;
  const url = new URL(event.req.url);
  url.pathname = proxyPath;

  // v2 avoids serving stale IPX bytes produced under the same URL.
  // `f_auto` negotiates from Accept, so Accept participates in the cache key.
  const accept = event.req.headers.get("accept") ?? "";
  const cacheKey = `img:v2:${hash([proxyPath, accept])}`;

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
        throw new HTTPError({
          status: response.status,
          statusText: response.statusText || "IMAGE_PROCESSING_FAILED",
          message: "Image processing failed",
        });
      }

      return {
        data: Buffer.from(await response.bytes()),
        contentType: response.headers.get("content-type") || "image/png",
      };
    },
  });

  event.res.headers.set("Vary", "Accept");
  // Mirror the image handler's response hardening for processed images
  if (data) {
    event.res.headers.set("Content-Security-Policy", "default-src 'none'");
  }
  return data;
});
