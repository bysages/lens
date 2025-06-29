import { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import {
  chromium as playwright,
  Browser,
  Page,
  BrowserContext,
} from "playwright";
import { cacheStorage } from "./storage";
import { pluginRateLimits } from "./rate-limits";
import { registerCleanup } from "./memory";

// Screenshot configuration interface
interface ScreenshotOptions {
  url: string;
  width?: number;
  height?: number;
  fullPage?: boolean;
  format?: "png" | "jpeg" | "webp";
  quality?: number;
  deviceScaleFactor?: number;
  mobile?: boolean;
  darkMode?: boolean;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  delay?: number;
}

// Browser pool item with viewport tracking
interface PooledBrowser {
  browser: Browser;
  context: BrowserContext;
  availablePages: Page[];
  activePagesCount: number;
  lastUsed: number;
  viewport: { width: number; height: number };
  isDarkMode: boolean;
  isMobile: boolean;
}

// Simple browser pool class (KISS principle)
class OptimizedBrowserPool {
  private browsers: PooledBrowser[] = [];
  private readonly maxBrowsers = 2; // Keep it simple
  private readonly maxPagesPerBrowser = 5; // Control memory usage
  private readonly pageIdleTimeout = 5 * 60 * 1000; // 5 minutes
  private readonly browserIdleTimeout = 10 * 60 * 1000; // 10 minutes

  /**
   * Get an available page for screenshot (optimized single-pass search)
   */
  async getPage(
    options: ScreenshotOptions,
  ): Promise<{ page: Page; releasePage: () => Promise<void> }> {
    const targetViewport = {
      width: options.width || 1280,
      height: options.height || 720,
    };
    const targetDarkMode = options.darkMode || false;
    const targetMobile = options.mobile || false;

    let bestBrowser: PooledBrowser | null = null;
    let needsNewContext = false;

    // Single-pass search for optimal browser
    for (const browser of this.browsers) {
      if (!browser.browser.isConnected()) continue;

      // Check viewport and context compatibility
      const isCompatible =
        browser.viewport.width === targetViewport.width &&
        browser.viewport.height === targetViewport.height &&
        browser.isDarkMode === targetDarkMode &&
        browser.isMobile === targetMobile;

      if (
        isCompatible &&
        browser.availablePages.length > 0 &&
        browser.activePagesCount < this.maxPagesPerBrowser
      ) {
        // Perfect match - use immediately
        bestBrowser = browser;
        break;
      }

      // Track least loaded browser for fallback
      if (
        !bestBrowser ||
        browser.activePagesCount < bestBrowser.activePagesCount
      ) {
        bestBrowser = browser;
        needsNewContext = !isCompatible;
      }
    }

    // Create new browser if needed and possible
    if (!bestBrowser && this.browsers.length < this.maxBrowsers) {
      bestBrowser = await this.createBrowser(options);
      needsNewContext = false;
    }

    if (!bestBrowser) {
      throw new Error("No available browsers in pool");
    }

    // Recreate context if viewport/settings don't match
    if (needsNewContext) {
      await bestBrowser.context.close();
      bestBrowser.context = await this.createContext(
        bestBrowser.browser,
        options,
      );
      bestBrowser.availablePages = [];
      bestBrowser.viewport = targetViewport;
      bestBrowser.isDarkMode = targetDarkMode;
      bestBrowser.isMobile = targetMobile;
    }

    // Get or create page (optimized page reuse)
    let page: Page;
    if (bestBrowser.availablePages.length > 0) {
      page = bestBrowser.availablePages.pop()!;
      // Only reset if absolutely necessary
      if (needsNewContext) {
        await this.quickResetPage(page);
      }
    } else {
      page = await this.createPage(bestBrowser, options);
    }

    bestBrowser.activePagesCount++;
    bestBrowser.lastUsed = Date.now();

    return {
      page,
      releasePage: async () => {
        bestBrowser!.activePagesCount--;
        bestBrowser!.availablePages.push(page);
        bestBrowser!.lastUsed = Date.now();
      },
    };
  }

  /**
   * Create browser context with optimized settings (single config pass)
   */
  private async createContext(
    browser: Browser,
    options: ScreenshotOptions,
  ): Promise<BrowserContext> {
    // Build complete context options in one pass
    const contextOptions: Parameters<typeof browser.newContext>[0] = {
      ignoreHTTPSErrors: true,
      bypassCSP: true, // Performance optimization
      viewport: {
        width: options.width || 1280,
        height: options.height || 720,
      },
      deviceScaleFactor: options.deviceScaleFactor || 1,
      colorScheme: options.darkMode ? "dark" : "light",
      // Use realistic user agent for all domains
      userAgent: options.mobile
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };

    // Mobile settings (all at once)
    if (options.mobile) {
      contextOptions.isMobile = true;
      contextOptions.hasTouch = true;
    }

    return await browser.newContext(contextOptions);
  }

  /**
   * Create new browser with optimized settings
   */
  private async createBrowser(
    options: ScreenshotOptions,
  ): Promise<PooledBrowser> {
    const isDevelopment =
      process.env.NODE_ENV === "development" || !process.env.NODE_ENV;

    // Browser selection priority
    const browserConfig = process.env.PLAYWRIGHT_BROWSER_CONFIG || "auto";

    let browser: Browser;

    try {
      // Standard chromium with aggressive performance optimizations and anti-detection
      const launchOptions: Parameters<typeof playwright.launch>[0] = {
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-web-security",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--disable-features=TranslateUI,BlinkGenPropertyTrees,VizDisplayCompositor",
          "--disable-background-networking",
          "--disable-default-apps",
          "--disable-extensions",
          "--disable-plugins",
          "--disable-sync",
          "--hide-scrollbars",
          "--mute-audio",
          "--no-default-browser-check",
          "--no-first-run",
          "--disable-gpu",
          "--disable-gpu-sandbox",
          "--disable-blink-features=AutomationControlled",
          "--disable-features=VizDisplayCompositor",
          "--disable-ipc-flooding-protection",
          "--disable-dev-tools",
          "--disable-hang-monitor",
          "--disable-prompt-on-repost",
          "--disable-domain-reliability",
          "--disable-component-extensions-with-background-pages",
          "--disable-client-side-phishing-detection",
          "--disable-background-mode",
        ],
      };

      // Try chromium-headless-shell first for better performance
      if (browserConfig === "auto" || browserConfig === "headless-shell") {
        try {
          browser = await playwright.launch({
            ...launchOptions,
            channel: "chromium-headless-shell",
          });
        } catch {
          browser = await playwright.launch(launchOptions);
        }
      } else {
        browser = await playwright.launch(launchOptions);
      }
    } catch {
      // Fallback: try with minimal configuration
      try {
        browser = await playwright.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
      } catch (fallbackError) {
        const errorMessage = `Browser launch failed: ${fallbackError instanceof Error ? fallbackError.message : "Unknown error"}`;
        const installHint = isDevelopment
          ? "Please install Playwright browsers: npx playwright install chromium-headless-shell chromium"
          : "Browser installation failed in production environment";

        throw new Error(`${errorMessage}. ${installHint}`);
      }
    }

    const context = await this.createContext(browser, options);

    const pooledBrowser: PooledBrowser = {
      browser,
      context,
      availablePages: [],
      activePagesCount: 0,
      lastUsed: Date.now(),
      viewport: { width: options.width || 1280, height: options.height || 720 },
      isDarkMode: options.darkMode || false,
      isMobile: options.mobile || false,
    };

    this.browsers.push(pooledBrowser);
    return pooledBrowser;
  }

  /**
   * Create new page with optimization
   */
  private async createPage(
    pooledBrowser: PooledBrowser,
    options: ScreenshotOptions,
  ): Promise<Page> {
    const page = await pooledBrowser.context.newPage();

    // Optimize page for screenshots (viewport is already set in context)
    await this.optimizePage(page, options);

    return page;
  }

  /**
   * Reset page state for reuse (legacy method)
   */
  private async resetPage(
    page: Page,
    options: ScreenshotOptions,
  ): Promise<void> {
    await this.quickResetPage(page);
    await this.optimizePage(page, options);
  }

  /**
   * Quick page reset for reuse (optimized)
   */
  private async quickResetPage(page: Page): Promise<void> {
    // Simple reset without full re-optimization
    await page.goto("about:blank", { waitUntil: "domcontentloaded" });
  }

  /**
   * Apply page optimizations (cached to avoid repetition)
   */
  private async optimizePage(
    page: Page,
    options: ScreenshotOptions,
  ): Promise<void> {
    // Check if optimizations already applied (avoid duplicate setup)
    if (!(page as any)._lensOptimized) {
      // Aggressive resource blocking for maximum performance
      await page.route("**/*", (route) => {
        const resourceType = route.request().resourceType();
        if (
          [
            "font",
            "media",
            "websocket",
            "other",
            "manifest",
            "texttrack",
          ].includes(resourceType)
        ) {
          route.abort();
        } else {
          route.continue();
        }
      });

      // Set optimized timeouts for performance
      page.setDefaultTimeout(10000);
      page.setDefaultNavigationTimeout(10000);

      // Fast CSS injection to disable animations
      await page.evaluate(() => {
        const style = document.createElement("style");
        style.textContent =
          "*,::after,::before{transition:none!important;animation:none!important}";
        document.head.appendChild(style);
      });

      // Mark as optimized
      (page as any)._lensOptimized = true;
    }

    // Set color scheme (can change per request)
    if (options.darkMode) {
      await page.emulateMedia({ colorScheme: "dark" });
    } else {
      await page.emulateMedia({ colorScheme: "light" });
    }
  }

  /**
   * Cleanup old resources (optimized single-pass)
   */
  async cleanup(): Promise<void> {
    const now = Date.now();
    const keepBrowsers: PooledBrowser[] = [];

    // Single-pass cleanup with parallel page closing
    const closePromises: Promise<void>[] = [];

    for (const browser of this.browsers) {
      const isIdle = now - browser.lastUsed > this.browserIdleTimeout;
      const shouldRemove =
        !browser.browser.isConnected() ||
        (browser.activePagesCount === 0 && isIdle);

      if (shouldRemove) {
        // Close browser (async)
        closePromises.push(
          browser.browser.close().catch(() => {}), // Silent failure
        );
      } else {
        // Keep browser but maybe clean pages
        if (
          browser.availablePages.length > 0 &&
          now - browser.lastUsed > this.pageIdleTimeout
        ) {
          // Close idle pages in parallel
          const pagesToClose = browser.availablePages.splice(0);
          closePromises.push(
            ...pagesToClose.map((page) => page.close().catch(() => {})),
          );
        }
        keepBrowsers.push(browser);
      }
    }

    // Wait for all cleanup operations in parallel
    if (closePromises.length > 0) {
      await Promise.allSettled(closePromises);
    }

    this.browsers = keepBrowsers;
  }

  /**
   * Shutdown all resources
   */
  async shutdown(): Promise<void> {
    for (const pooledBrowser of this.browsers) {
      try {
        await pooledBrowser.browser.close();
      } catch {
        // Silent failure - graceful degradation
      }
    }
    this.browsers = [];
  }
}

// Global browser pool instance
const browserPool = new OptimizedBrowserPool();

// Register cleanup with global memory manager
registerCleanup(async () => {
  await browserPool.cleanup();
});

/**
 * Take screenshot with retry mechanism (optimized for performance and reliability)
 */
async function takeScreenshotWithRetry(
  options: ScreenshotOptions,
  maxRetries: number = 0,
): Promise<Buffer> {
  // Performance mode: no retries by default for maximum speed
  if (maxRetries === 0) {
    return await takeScreenshot(options);
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await takeScreenshot(options);
    } catch (error) {
      lastError = error as Error;
      console.warn(
        `Screenshot attempt ${attempt + 1} failed:`,
        error instanceof Error ? error.message : error,
      );

      // Don't retry on the last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Minimal delay before retry for faster performance
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw lastError || new Error("Screenshot failed after retries");
}

/**
 * Take screenshot using optimized browser pool (streamlined flow)
 */
async function takeScreenshot(options: ScreenshotOptions): Promise<Buffer> {
  const { page, releasePage } = await browserPool.getPage(options);

  try {
    // Fast navigation strategy for performance
    const waitUntil = options.waitUntil || "domcontentloaded"; // Faster than 'load'

    await page.goto(options.url, {
      waitUntil,
      timeout: 10000, // Reduced timeout for better performance
    });

    // Minimal delay only when explicitly requested
    if (options.delay && options.delay > 0) {
      const actualDelay = Math.min(options.delay, 1000); // Further reduced max delay
      await page.waitForTimeout(actualDelay);
    }
    // Skip stability check for better performance

    // Optimized screenshot config (single object creation)
    const screenshotConfig: Parameters<typeof page.screenshot>[0] = {
      type: (options.format === "webp" ? "png" : options.format) || "png",
      fullPage: options.fullPage === true, // Explicit check for fullPage
      ...(options.format === "jpeg" && {
        quality: Math.min(Math.max(options.quality || 80, 1), 100),
      }),
    };

    return await page.screenshot(screenshotConfig);
  } finally {
    await releasePage();
  }
}

/**
 * Parse and validate screenshot options
 */
function parseScreenshotOptions(query: Record<string, any>): ScreenshotOptions {
  const url = String(query.url || "");
  if (!url) {
    throw new Error("Missing url parameter");
  }

  // Normalize URL to handle common cases like 'google.com' -> 'https://google.com'
  let normalizedUrl = url;
  if (!normalizedUrl.startsWith("http")) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  const options: ScreenshotOptions = {
    url: normalizedUrl,
  };

  // Parse dimensions with limits
  if (query.width) {
    options.width = Math.min(
      Math.max(parseInt(String(query.width)), 100),
      2560,
    );
  }
  if (query.height) {
    options.height = Math.min(
      Math.max(parseInt(String(query.height)), 100),
      1440,
    );
  }

  // Parse format
  const format = String(query.format || "png").toLowerCase();
  if (["png", "jpeg", "webp"].includes(format)) {
    options.format = format as "png" | "jpeg" | "webp";
  }

  // Parse boolean options
  options.fullPage = query.fullPage === "true"; // Default to viewport screenshot
  options.mobile = query.mobile === "true";
  options.darkMode = query.darkMode === "true";

  // Parse numeric options
  if (query.quality) {
    options.quality = Math.min(
      Math.max(parseInt(String(query.quality)), 1),
      100,
    );
  }

  if (query.deviceScaleFactor) {
    options.deviceScaleFactor = Math.min(
      Math.max(parseFloat(String(query.deviceScaleFactor)), 1),
      2,
    );
  }

  if (query.delay) {
    options.delay = Math.min(Math.max(parseInt(String(query.delay)), 0), 1000); // Reduced max delay for performance
  }

  // Parse wait condition
  const waitUntil = String(query.waitUntil || "networkidle");
  if (["load", "domcontentloaded", "networkidle"].includes(waitUntil)) {
    options.waitUntil = waitUntil as
      | "load"
      | "domcontentloaded"
      | "networkidle";
  }

  return options;
}

/**
 * Generate cache key for screenshot (optimized string building)
 */
function generateCacheKey(options: ScreenshotOptions): string {
  // Direct string template for better performance
  return `screenshot:${options.url}:${options.width || 1280}:${options.height || 720}:${options.fullPage ? "full" : "viewport"}:${options.format || "png"}:${options.quality || 80}:${options.mobile ? "mobile" : "desktop"}:${options.darkMode ? "dark" : "light"}`;
}

/**
 * Screenshot plugin for better-auth
 */
export const screenshotPlugin = (): BetterAuthPlugin => {
  return {
    id: "screenshot",

    rateLimit: pluginRateLimits.screenshot,

    endpoints: {
      captureScreenshot: createAuthEndpoint(
        "/screenshot",
        {
          method: "GET",
        },
        async (ctx) => {
          try {
            // Parse options
            const options = parseScreenshotOptions(ctx.query);

            // Generate cache key
            const cacheKey = generateCacheKey(options);

            // Check cache
            const cached = await cacheStorage.screenshots.get(cacheKey);
            if (cached) {
              const contentType =
                options.format === "jpeg"
                  ? "image/jpeg"
                  : options.format === "webp"
                    ? "image/webp"
                    : "image/png";

              return new Response(cached, {
                headers: {
                  "Content-Type": contentType,
                  "Cache-Control": "public, max-age=86400", // 24 hours for better performance
                  "X-Cache": "HIT",
                },
              });
            }

            // Take screenshot with retry mechanism
            const screenshotBuffer = await takeScreenshotWithRetry(options);

            // Cache result
            await cacheStorage.screenshots.set(cacheKey, screenshotBuffer);

            const contentType =
              options.format === "jpeg"
                ? "image/jpeg"
                : options.format === "webp"
                  ? "image/webp"
                  : "image/png";

            return new Response(screenshotBuffer, {
              headers: {
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=86400", // 24 hours for better performance
                "X-Cache": "MISS",
              },
            });
          } catch (error) {
            console.error("Screenshot error:", error);

            return new Response(
              JSON.stringify({
                error: "Screenshot capture failed",
                details:
                  error instanceof Error ? error.message : "Unknown error",
              }),
              {
                status: 500,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
        },
      ),
    },
  };
};

// Cleanup on process exit
const cleanup = async () => {
  await browserPool.shutdown();
};

process.on("exit", cleanup);
process.on("SIGINT", async () => {
  await cleanup();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(0);
});

// Periodic cleanup every 5 minutes
setInterval(
  () => {
    browserPool.cleanup().catch(console.error);
  },
  5 * 60 * 1000,
);
