import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { HTTPError } from "nitro/h3";
import { type Browser, type Page } from "playwright";

import { withBrowserSlot } from "./browser-limiter";
import { BROWSER_TIMEOUT, SCREENSHOT_MAX_PIXELS } from "./constants";

// ── Types ──────────────────────────────────────────────

/**
 * Screenshot parameters aligned with Playwright's PageScreenshotOptions.
 * Custom navigation params (waitUntil, delay, mobile, darkMode) are extended
 * for the HTTP API use case.
 */
export interface ScreenshotParams {
  // Navigation
  url: string;
  width: number;
  height: number;
  mobile: boolean;
  darkMode: boolean;
  waitUntil: "load" | "domcontentloaded" | "networkidle";
  delay?: number;

  // Playwright PageScreenshotOptions
  type: "png" | "jpeg";
  fullPage?: boolean;
  quality?: number;
  clip?: { x: number; y: number; width: number; height: number };
  scale?: "css" | "device";
  animations?: "disabled" | "allow";
  caret?: "hide" | "initial";
  style?: string;
  timeout?: number;
}

export interface ScreenshotResult {
  buffer: Buffer;
  type: "png" | "jpeg";
}

// ── Browser Connection ─────────────────────────────────

// The browser is a remote Moli instance serving CDP; loopback matches the
// in-container deployment where the entrypoint supervises `moli serve`.
export const CDP_ENDPOINT = process.env.BROWSER_CDP_ENDPOINT || "http://127.0.0.1:9222";

// UA overrides are opt-in: the engine's own user agent stays consistent with
// its JS/TLS fingerprint, while hardcoded strings age into mismatched ones.
const DESKTOP_USER_AGENT = process.env.BROWSER_USER_AGENT;
const MOBILE_USER_AGENT = process.env.BROWSER_USER_AGENT_MOBILE;

let browser: Browser | null = null;
let browserInitializing: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser) return browser;
  if (browserInitializing) return browserInitializing;

  browserInitializing = (async () => {
    const { chromium } = await import("playwright");
    const b = await chromium.connectOverCDP(CDP_ENDPOINT);
    // Self-heal: drop the dead connection so the next request reconnects.
    b.on("disconnected", () => {
      browser = null;
      browserInitializing = null;
    });
    browser = b;
    return b;
  })().catch((err) => {
    browserInitializing = null;
    throw err;
  });

  return browserInitializing;
}

// ── Page Helpers ───────────────────────────────────────

/**
 * Prepare a page for rendering: bound timeouts. Resource blocking via route
 * interception is deliberately avoided — it stalls the browser on
 * resource-heavy pages; web fonts also improve screenshot typography.
 * Animation freezing happens at capture time via the screenshot
 * `animations` option — document-level styles injected before navigation
 * would be wiped by the goto.
 */
function optimizePage(page: Page): void {
  page.setDefaultTimeout(BROWSER_TIMEOUT);
  page.setDefaultNavigationTimeout(BROWSER_TIMEOUT);
}

/**
 * Let in-flight fonts and images settle without waiting indefinitely on a
 * broken third-party resource. The `load` event still remains the primary
 * readiness signal; this only prevents screenshots racing font replacement.
 */
async function waitForVisualStability(page: Page): Promise<void> {
  await page.evaluate(() => {
    const settled = new Promise<void>((resolve) => {
      setTimeout(resolve, 1_500);
    });
    const resources = [
      document.fonts.ready,
      ...Array.from(document.images)
        .filter((image) => !image.complete)
        .map(
          (image) =>
            new Promise<void>((resolve) => {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener("error", () => resolve(), { once: true });
            }),
        ),
    ];
    return Promise.race([settled, Promise.allSettled(resources).then(() => undefined)]);
  });
}

function rasterLimit(): number {
  const value = Number.parseInt(process.env.SCREENSHOT_MAX_PIXELS || "", 10);
  if (!Number.isFinite(value) || value < 1_000_000) return SCREENSHOT_MAX_PIXELS;
  return value;
}

/**
 * Moli renders a full-document capture as one bitmap rather than tiled output.
 * Reject pathological documents before allocating an oversized raster.
 */
async function validateFullPageExtent(page: Page): Promise<void> {
  const { width, height } = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  if (width * height > rasterLimit()) {
    throw new HTTPError({
      status: 400,
      message: "Full page is too large to render safely; use clip or a smaller viewport",
    });
  }
}

/**
 * Execute a function with a page from the default browser context.
 * Page is automatically closed after the callback completes.
 */
export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  return withBrowserSlot(async () => {
    const b = await getBrowser();
    const page = await b.newPage();
    optimizePage(page);

    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => {});
    }
  });
}

/**
 * Execute a function with a context-configured page.
 */
export async function withContext<T>(
  viewport: { width: number; height: number },
  darkMode: boolean,
  mobile: boolean,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  return withBrowserSlot(async () => {
    const b = await getBrowser();

    const context = await b.newContext({
      viewport,
      colorScheme: darkMode ? "dark" : "light",
      ...((mobile ? MOBILE_USER_AGENT : DESKTOP_USER_AGENT) && {
        userAgent: mobile ? MOBILE_USER_AGENT : DESKTOP_USER_AGENT,
      }),
      // Moli's CDP backend rejects Playwright's isMobile emulation.
      hasTouch: mobile,
    });

    const page = await context.newPage();
    optimizePage(page);

    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  });
}

// ── Screenshot Task ────────────────────────────────────

/**
 * Capture a screenshot of the given URL.
 */
export async function captureScreenshot(params: ScreenshotParams): Promise<ScreenshotResult> {
  const {
    url,
    type,
    fullPage,
    quality,
    clip,
    scale,
    animations,
    caret,
    style,
    timeout,
    waitUntil,
    delay,
  } = params;

  return withContext(
    { width: params.width, height: params.height },
    params.darkMode,
    params.mobile,
    async (page) => {
      await page.goto(url, {
        waitUntil,
        timeout: timeout ?? BROWSER_TIMEOUT,
      });
      await waitForVisualStability(page);
      if (delay) {
        await page.waitForTimeout(delay);
      }
      if (fullPage) {
        await validateFullPageExtent(page);
      }

      const screenshot = await page.screenshot({
        type,
        ...(fullPage !== undefined && { fullPage }),
        ...(quality !== undefined && { quality }),
        ...(clip && { clip }),
        ...(scale && { scale }),
        ...(animations && { animations }),
        ...(caret && { caret }),
        ...(style && { style }),
      });

      return { buffer: Buffer.from(screenshot), type };
    },
  );
}

// ── Content Extraction ─────────────────────────────────

export interface ExtractParams {
  url: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  delay?: number;
  timeout?: number;
}

export interface ExtractResult {
  /** Clean article HTML from Readability */
  content: string;
  /** Plain text content */
  textContent: string;
  /** Article title */
  title: string;
  /** Plain description */
  excerpt: string;
  /** Author */
  byline: string | null;
  /** Website name */
  siteName: string;
  /** Content language */
  lang: string;
  /** Content direction */
  dir: string;
}

/**
 * Extract article content from a URL using Playwright (rendered HTML) + Readability + linkedom.
 * Parse runs entirely in Node.js — no browser-side script injection, no CSP issues.
 */
export async function extractContent(params: ExtractParams): Promise<ExtractResult> {
  const { url, waitUntil = "domcontentloaded", delay, timeout } = params;

  return withPage(async (page) => {
    await page.goto(url, {
      waitUntil,
      timeout: timeout ?? BROWSER_TIMEOUT,
    });

    if (delay) {
      await page.waitForTimeout(delay);
    }

    // Get fully rendered HTML from Playwright, then parse in Node.js
    const html = await page.content();
    const { document } = parseHTML(html, { url });
    const reader = new Readability(document);
    const article = reader.parse();

    return {
      content: article?.content ?? "",
      textContent: article?.textContent ?? "",
      title: article?.title ?? "",
      excerpt: article?.excerpt ?? "",
      byline: article?.byline ?? null,
      siteName: article?.siteName ?? "",
      lang: article?.lang ?? "",
      dir: article?.dir ?? "ltr",
    };
  });
}
