import chromium from "@sparticuz/chromium";
import { defineHandler, HTTPError, getQuery } from "nitro/h3";
import { useStorage } from "nitro/storage";
import { hash } from "ohash";
import { chromium as playwright, type Browser, type Page, type BrowserContext } from "playwright";

import { IMAGE_TTL } from "../utils/constants";

export interface ScreenshotQuery {
  url: string;
  width?: string;
  height?: string;
  fullPage?: string;
  format?: string;
  quality?: string;
  deviceScaleFactor?: string;
  mobile?: string;
  darkMode?: string;
  waitUntil?: string;
  delay?: string;
}

// Singleton browser instance
let browserInstance: Browser | null = null;
let browserInitializing: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browserInstance) {
    return browserInstance;
  }

  if (browserInitializing) {
    return browserInitializing;
  }

  browserInitializing = (async () => {
    try {
      browserInstance = await playwright.launch({
        headless: true,
        executablePath: await chromium.executablePath(),
        args: chromium.args,
      });
      return browserInstance;
    } catch {
      // Fallback to standard playwright
      browserInstance = await playwright.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });
      return browserInstance;
    }
  })();

  return browserInitializing;
}

export async function optimizePage(page: Page): Promise<void> {
  await page.route("**/*", (route) => {
    const resourceType = route.request().resourceType();
    if (["font", "media", "websocket", "other", "manifest", "texttrack"].includes(resourceType)) {
      void route.abort();
    } else {
      void route.continue();
    }
  });

  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(10000);

  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = "*,::after,::before{transition:none!important;animation:none!important}";
    document.head.appendChild(style);
  });
}

export async function createScreenshotContext(
  browser: Browser,
  viewport: { width: number; height: number },
  darkMode: boolean,
  mobile: boolean,
): Promise<BrowserContext> {
  const contextOptions = {
    ignoreHTTPSErrors: true,
    bypassCSP: true,
    viewport,
    deviceScaleFactor: 1,
    colorScheme: (darkMode ? "dark" : "light") as "dark" | "light",
    userAgent: mobile
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    isMobile: mobile,
    hasTouch: mobile,
  };

  return await browser.newContext(contextOptions);
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
  const format: "png" | "jpeg" = query.format === "jpeg" ? "jpeg" : "png";
  const quality = query.quality ? Math.min(Math.max(parseInt(query.quality), 1), 100) : 80;
  const fullPage = query.fullPage === "true";
  const mobile = query.mobile === "true";
  const darkMode = query.darkMode === "true";
  const waitUntil = (query.waitUntil || "domcontentloaded") as
    | "load"
    | "domcontentloaded"
    | "networkidle";
  const delay = query.delay ? Math.min(Math.max(parseInt(query.delay), 0), 1000) : undefined;

  // Generate cache key using ohash (exclude url from hash for predictable key)
  const cacheParams = {
    url,
    width,
    height,
    format,
    quality,
    fullPage,
    mobile,
    darkMode,
    waitUntil,
    delay,
  };
  const cacheKey = `screenshot:${hash(cacheParams)}.${format}`;
  const storage = useStorage("cache");
  const cached = await storage.getItemRaw<Uint8Array>(cacheKey);

  if (cached) {
    event.res.headers.set("X-Cache", "HIT");
    const contentType = format === "jpeg" ? "image/jpeg" : "image/png";
    event.res.headers.set("Content-Type", contentType);
    event.res.headers.set("Cache-Control", `public, max-age=${IMAGE_TTL}`);
    return Buffer.from(cached);
  }

  // Get singleton browser instance
  const browser = await getBrowser();
  const viewport = { width, height };
  const context = await createScreenshotContext(browser, viewport, darkMode, mobile);
  let page: Page | undefined;

  try {
    page = await context.newPage();
    await optimizePage(page);

    await page.goto(url, {
      waitUntil,
      timeout: 10000,
    });

    if (delay) {
      await page.waitForTimeout(delay);
    }

    const screenshot = await page.screenshot({
      type: format,
      fullPage,
      ...(format === "jpeg" && { quality }),
    });

    // Non-blocking cache write (24 hours TTL)
    event.waitUntil(storage.setItemRaw(cacheKey, new Uint8Array(screenshot), { ttl: IMAGE_TTL }));

    // CORS is handled by global routeRules
    const contentType = format === "jpeg" ? "image/jpeg" : "image/png";
    event.res.headers.set("X-Cache", "MISS");
    event.res.headers.set("Content-Type", contentType);
    event.res.headers.set("Cache-Control", `public, max-age=${IMAGE_TTL}`);

    return screenshot;
  } finally {
    await page?.close().catch(() => {});
    await context.close().catch(() => {});
  }
});
