import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { type Browser, type Page } from "playwright";

import { BROWSER_MAX_CONCURRENCY } from "./constants";

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
  omitBackground?: boolean;
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
const CDP_ENDPOINT = process.env.BROWSER_CDP_ENDPOINT || "http://127.0.0.1:9222";

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

// ── Concurrency Semaphore ──────────────────────────────

const MAX_CONCURRENCY =
  Number.parseInt(process.env.BROWSER_MAX_CONCURRENCY || "") || BROWSER_MAX_CONCURRENCY;

let activeSlots = 0;
const slotWaiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (activeSlots < MAX_CONCURRENCY) {
    activeSlots++;
    return;
  }
  await new Promise<void>((resolve) => {
    slotWaiters.push(() => {
      activeSlots++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  const next = slotWaiters.shift();
  if (next) next();
  else activeSlots--;
}

// ── Page Helpers ───────────────────────────────────────

/**
 * Prepare a page for rendering: bound timeouts and freeze CSS animations.
 * Resource blocking via route interception is deliberately avoided — it
 * stalls the browser on resource-heavy pages; web fonts also improve
 * screenshot typography.
 */
async function optimizePage(page: Page): Promise<void> {
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(10000);

  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = "*,::after,::before{transition:none!important;animation:none!important}";
    document.head.appendChild(style);
  });
}

/**
 * Execute a function with a page from the default browser context.
 * Page is automatically closed after the callback completes.
 */
export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  await acquireSlot();
  try {
    const b = await getBrowser();
    const page = await b.newPage();
    await optimizePage(page);

    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    releaseSlot();
  }
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
  await acquireSlot();
  try {
    const b = await getBrowser();

    const context = await b.newContext({
      viewport,
      colorScheme: darkMode ? "dark" : "light",
      userAgent: mobile
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      isMobile: mobile,
      hasTouch: mobile,
    });

    const page = await context.newPage();
    await optimizePage(page);

    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  } finally {
    releaseSlot();
  }
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
    omitBackground,
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
        timeout: timeout ?? 10000,
      });

      if (delay) {
        await page.waitForTimeout(delay);
      }

      const screenshot = await page.screenshot({
        type,
        ...(fullPage !== undefined && { fullPage }),
        ...(quality !== undefined && { quality }),
        ...(clip && { clip }),
        ...(omitBackground !== undefined && { omitBackground }),
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
  /** Short description */
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
      timeout: timeout ?? 10000,
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
