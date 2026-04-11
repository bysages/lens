import { defineHandler, HTTPError, getQuery } from "nitro/h3";
import { useStorage } from "nitro/storage";
import { hash } from "ohash";

import {
  BROWSER_RATE_LIMIT,
  BROWSER_RATE_WINDOW,
  BROWSER_TTL,
  CACHE_MEDIUM,
} from "../utils/constants";
import { captureScreenshot } from "../utils/playwright";
import { rateLimit } from "../utils/rate-limit";

export interface ScreenshotQuery {
  url: string;
  width?: string;
  height?: string;
  type?: string;
  fullPage?: string;
  quality?: string;
  clip?: string;
  omitBackground?: string;
  scale?: string;
  animations?: string;
  caret?: string;
  style?: string;
  timeout?: string;
  mobile?: string;
  darkMode?: string;
  waitUntil?: string;
  delay?: string;
}

function parseClip(
  value: string | undefined,
): { x: number; y: number; width: number; height: number } | undefined {
  if (!value) return undefined;
  // Expected format: "x,y,width,height"
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => isNaN(n))) return undefined;
  return { x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! };
}

export default defineHandler(async (event) => {
  const query = getQuery<ScreenshotQuery>(event);

  if (!query.url) {
    throw new HTTPError({
      status: 400,
      message: "Missing url parameter",
    });
  }

  let url = query.url;
  if (!url.startsWith("http")) {
    url = `https://${url}`;
  }

  const width = query.width ? Math.min(Math.max(parseInt(query.width), 100), 2560) : 1280;
  const height = query.height ? Math.min(Math.max(parseInt(query.height), 100), 1440) : 720;
  const type: "png" | "jpeg" = query.type === "jpeg" ? "jpeg" : "png";
  const quality = query.quality ? Math.min(Math.max(parseInt(query.quality), 1), 100) : undefined;
  const fullPage = query.fullPage === "true" ? true : undefined;
  const omitBackground = query.omitBackground === "true" ? true : undefined;
  const mobile = query.mobile === "true";
  const darkMode = query.darkMode === "true";
  const waitUntil = (query.waitUntil || "domcontentloaded") as
    | "load"
    | "domcontentloaded"
    | "networkidle";
  const delay = query.delay ? Math.min(Math.max(parseInt(query.delay), 0), 10000) : undefined;
  const timeout = query.timeout
    ? Math.min(Math.max(parseInt(query.timeout), 1000), 30000)
    : undefined;

  // Generate cache key using ohash
  const cacheParams = {
    url,
    width,
    height,
    type,
    quality,
    fullPage,
    clip: query.clip,
    omitBackground,
    scale: query.scale,
    animations: query.animations,
    caret: query.caret,
    style: query.style,
    timeout,
    mobile,
    darkMode,
    waitUntil,
    delay,
  };
  const cacheKey = `screenshot:${hash(cacheParams)}.${type}`;
  const storage = useStorage("cache");
  const etag = `"${cacheKey}"`;
  const cached = await storage.getItemRaw<Uint8Array>(cacheKey);

  if (cached) {
    if (event.req.headers.get("if-none-match") === etag) {
      event.res.status = 304;
      return null;
    }
    event.res.headers.set("ETag", etag);
    event.res.headers.set("X-Cache", "HIT");
    const contentType = type === "jpeg" ? "image/jpeg" : "image/png";
    event.res.headers.set("Content-Type", contentType);
    event.res.headers.set("Cache-Control", CACHE_MEDIUM);
    return Buffer.from(cached);
  }

  await rateLimit(event, { limit: BROWSER_RATE_LIMIT, window: BROWSER_RATE_WINDOW });

  // Capture screenshot
  const result = await captureScreenshot({
    url,
    width,
    height,
    type,
    quality,
    fullPage,
    clip: parseClip(query.clip),
    omitBackground,
    scale: query.scale as "css" | "device" | undefined,
    animations: query.animations as "disabled" | "allow" | undefined,
    caret: query.caret as "hide" | "initial" | undefined,
    style: query.style,
    timeout,
    mobile,
    darkMode,
    waitUntil,
    delay,
  });

  event.waitUntil(
    storage.setItemRaw(cacheKey, new Uint8Array(result.buffer), { ttl: BROWSER_TTL }),
  );

  // CORS is handled by global routeRules
  const contentType = type === "jpeg" ? "image/jpeg" : "image/png";
  event.res.headers.set("ETag", etag);
  event.res.headers.set("X-Cache", "MISS");
  event.res.headers.set("Content-Type", contentType);
  event.res.headers.set("Cache-Control", CACHE_MEDIUM);

  return result.buffer;
});
