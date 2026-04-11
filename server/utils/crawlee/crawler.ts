import { BrowserPool, PlaywrightPlugin } from "@crawlee/browser-pool";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { type Page } from "playwright";

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

// ── BrowserPool Singleton ──────────────────────────────

type PoolInstance = Awaited<ReturnType<typeof createPool>>;

let poolInstance: PoolInstance | null = null;
let poolInitializing: Promise<PoolInstance> | null = null;

export async function createPool() {
  const { chromium: chromiumType } = await import("playwright");

  const plugin = new PlaywrightPlugin(chromiumType, {
    launchOptions: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    },
  });

  return new BrowserPool({
    browserPlugins: [plugin],
    maxOpenPagesPerBrowser: 10,
    retireBrowserAfterPageCount: 50,
    closeInactiveBrowserAfterSecs: 60,
    useFingerprints: false,
    postPageCreateHooks: [async (page: Page) => optimizePage(page)],
  });
}

export async function getBrowserPool() {
  if (poolInstance) return poolInstance;
  if (poolInitializing) return poolInitializing;

  poolInitializing = createPool().then((pool) => {
    poolInstance = pool;
    return pool;
  });

  return poolInitializing;
}

// ── Page Helpers ───────────────────────────────────────

/**
 * Strip animations/transitions and block unnecessary resource types.
 */
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

/**
 * Execute a function with a page from the pool.
 * Page is automatically closed after the callback completes.
 */
export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const pool = await getBrowserPool();
  const page: Page = await pool.newPage();

  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Execute a function with a context-configured page from the pool.
 */
export async function withContext<T>(
  viewport: { width: number; height: number },
  darkMode: boolean,
  mobile: boolean,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const pool = await getBrowserPool();
  const page: Page = await pool.newPage({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pageOptions: {
      viewport,
      colorScheme: darkMode ? "dark" : "light",
      userAgent: mobile
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      isMobile: mobile,
      hasTouch: mobile,
    } as any,
  });

  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

// ── Screenshot Task ────────────────────────────────────

/**
 * Capture a screenshot of the given URL using Crawlee's BrowserPool.
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
 * Extract article content from a URL using Playwright (rendered HTML) + Readability + JSDOM.
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
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
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
