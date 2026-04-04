import { createIPX, ipxHttpStorage, ipxFSStorage, createIPXFetchHandler } from "ipx";
import { defineHandler, getRouterParam } from "nitro/h3";
import { useStorage } from "nitro/storage";
import { hash } from "ohash";
import { env } from "std-env";

import { IMAGE_TTL, OG_IMAGE_TTL } from "../../utils/constants";

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
    maxAge: IMAGE_TTL,
  }),
  maxAge: IMAGE_TTL,
});

const fetchHandler = createIPXFetchHandler(ipx);

export default defineHandler(async (event) => {
  const path = getRouterParam(event, "_") || "";
  const ipxPath = "/" + path;
  const url = new URL(event.req.url);
  url.pathname = ipxPath;

  const cacheKey = `img:${hash({ path: ipxPath, search: url.search })}`;
  const storage = useStorage("cache");

  // Cache lookup
  const cached = await storage.getItemRaw<Uint8Array>(cacheKey);
  if (cached) {
    const cachedMeta = await storage.getMeta(cacheKey);
    const contentType =
      typeof cachedMeta?.contentType === "string" ? cachedMeta.contentType : "image/png";
    event.res.headers.set("Content-Type", contentType);
    event.res.headers.set("X-Cache", "HIT");
    event.res.headers.set("Cache-Control", `public, max-age=${IMAGE_TTL}`);
    return cached;
  }

  // Process with IPX
  const response = await fetchHandler(new Request(url, event.req));
  const data = await response.bytes();

  // Copy IPX response headers
  response.headers.forEach((value, key) => {
    event.res.headers.set(key, value);
  });

  event.res.headers.set("X-Cache", "MISS");
  event.res.headers.set("Cache-Control", `public, max-age=${IMAGE_TTL}`);

  // Non-blocking cache write: data with TTL, Content-Type in metadata
  const contentType = response.headers.get("content-type") || "image/png";
  event.waitUntil(
    Promise.all([
      storage.setItemRaw(cacheKey, data, { ttl: OG_IMAGE_TTL }),
      storage.setMeta(cacheKey, { contentType }, { ttl: OG_IMAGE_TTL }),
    ]),
  );

  return data;
});
