import { createIPX, ipxHttpStorage, ipxFSStorage, createIPXFetchHandler } from "ipx";
import { defineHandler } from "nitro/h3";
import { useStorage } from "nitro/storage";
import { hash } from "ohash";
import { env } from "std-env";

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
    maxAge: 86400,
  }),
  maxAge: 86400,
});

export function contentTypeToExtension(contentType: string): string {
  const type = contentType.toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  if (type.includes("avif")) return "avif";
  if (type.includes("heif")) return "heif";
  if (type.includes("tiff")) return "tiff";
  return "png";
}

export default defineHandler(async (event) => {
  const url = new URL(event.req.url);
  const ipxPath = url.pathname.replace(/^\/img/, "") || "/";
  url.pathname = ipxPath;

  // Generate cache key using ohash
  const cacheKeyBase = `img:${hash({ path: ipxPath, search: url.search })}`;
  const storage = useStorage("cache");

  // Try common image extensions for cache lookup
  const extensions = ["png", "jpg", "jpeg", "webp", "gif", "avif", "heif", "tiff", "tif"];
  let cached: Uint8Array | null = null;
  let cacheKey = "";

  for (const ext of extensions) {
    const key = `${cacheKeyBase}.${ext}`;
    const data = await storage.getItemRaw<Uint8Array>(key);
    if (data) {
      cached = data;
      cacheKey = key;
      break;
    }
  }

  if (cached) {
    event.res.headers.set("X-Cache", "HIT");
    return Buffer.from(cached);
  }

  cacheKey = cacheKeyBase;

  // Use IPX to process the image
  const fetchHandler = createIPXFetchHandler(ipx);
  const response = await fetchHandler(new Request(url, event.req));
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Get extension from response Content-Type
  const contentType = response.headers.get("content-type") || "image/png";
  const extension = contentTypeToExtension(contentType);
  cacheKey = `${cacheKey}.${extension}`;

  // Store raw binary data (7 days)
  await storage.setItemRaw(cacheKey, new Uint8Array(buffer));
  await storage.setMeta(cacheKey, { ttl: 604800 }); // 7 days

  // Copy headers from IPX response
  response.headers.forEach((value, key) => {
    event.res.headers.set(key, value);
  });

  event.res.headers.set("X-Cache", "MISS");

  return buffer;
});
