import { defineHandler, HTTPError, getQuery } from "nitro/h3";
import { hash } from "ohash";

import { serveCached } from "../utils/cache";
import {
  BROWSER_RATE_LIMIT,
  BROWSER_TTL,
  CACHE_MEDIUM,
  MAX_CACHE_ENTRY_BYTES,
  RATE_WINDOW,
  SCREENSHOT_DEFAULT_HEIGHT,
  SCREENSHOT_DEFAULT_WIDTH,
  SCREENSHOT_MAX_HEIGHT,
  SCREENSHOT_MAX_WIDTH,
} from "../utils/constants";
import { boolParam, clampInt, firstString, oneOf } from "../utils/params";
import { captureScreenshot } from "../utils/playwright";
import { rateLimit } from "../utils/rate-limit";
import { assertSafeUrl, normalizeInputUrl } from "../utils/ssrf";

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

  const rawUrl = firstString(query.url);
  if (!rawUrl) {
    throw new HTTPError({ status: 400, message: "Missing url parameter" });
  }
  const url = normalizeInputUrl(rawUrl);
  await assertSafeUrl(url);

  const type = oneOf(query.type, ["png", "jpeg"] as const, "png")!;
  // Playwright rejects quality for png screenshots — only parse it for jpeg
  const quality = type === "jpeg" ? clampInt(query.quality, 1, 100) : undefined;
  const width = clampInt(query.width, 100, SCREENSHOT_MAX_WIDTH, SCREENSHOT_DEFAULT_WIDTH);
  const height = clampInt(query.height, 100, SCREENSHOT_MAX_HEIGHT, SCREENSHOT_DEFAULT_HEIGHT);
  const fullPage = boolParam(query.fullPage) || undefined;
  const mobile = boolParam(query.mobile);
  const darkMode = boolParam(query.darkMode);
  const waitUntil = oneOf(
    query.waitUntil,
    ["load", "domcontentloaded", "networkidle"] as const,
    "load",
  )!;
  const delay = clampInt(query.delay, 0, 10000);
  const timeout = clampInt(query.timeout, 1000, 30000);
  const scale = oneOf(query.scale, ["css", "device"] as const);
  const animations = oneOf(query.animations, ["disabled", "allow"] as const, "disabled");
  const caret = oneOf(query.caret, ["hide", "initial"] as const);
  const style = firstString(query.style);
  const clip = firstString(query.clip);

  // Moli does not implement the CDP method behind this option — fail fast
  // with a clear status instead of an opaque browser error
  if (boolParam(query.omitBackground)) {
    throw new HTTPError({
      status: 400,
      message: "omitBackground is not supported by the Moli browser kernel",
    });
  }

  const cacheKey = `screenshot:${hash({
    // Rendering fixes and engine policy changes must not replay old images.
    browserEngine: process.env.MOLI_VERSION || "local",
    url,
    width,
    height,
    type,
    quality,
    fullPage,
    clip,
    scale,
    animations,
    caret,
    style,
    timeout,
    mobile,
    darkMode,
    waitUntil,
    delay,
  })}.${type}`;

  return serveCached(event, {
    key: cacheKey,
    ttl: BROWSER_TTL,
    contentType: type === "jpeg" ? "image/jpeg" : "image/png",
    cacheControl: CACHE_MEDIUM,
    maxBytes: MAX_CACHE_ENTRY_BYTES,
    produce: async () => {
      await rateLimit(event, { limit: BROWSER_RATE_LIMIT, window: RATE_WINDOW, scope: "browser" });
      const result = await captureScreenshot({
        url,
        width,
        height,
        type,
        quality,
        fullPage,
        clip: parseClip(clip),
        scale,
        animations,
        caret,
        style,
        timeout,
        mobile,
        darkMode,
        waitUntil,
        delay,
      });
      return { data: result.buffer };
    },
  });
});
