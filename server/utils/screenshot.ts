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

// Browser pool item
interface PooledBrowser {
  browser: Browser;
  context: BrowserContext;
  availablePages: Page[];
  activePagesCount: number;
  lastUsed: number;
}

// Simple browser pool class (KISS principle)
class OptimizedBrowserPool {
  private browsers: PooledBrowser[] = [];
  private readonly maxBrowsers = 2; // Keep it simple
  private readonly maxPagesPerBrowser = 5; // Control memory usage
  private readonly pageIdleTimeout = 5 * 60 * 1000; // 5 minutes
  private readonly browserIdleTimeout = 10 * 60 * 1000; // 10 minutes

  /**
   * Get an available page for screenshot
   */
  async getPage(
    options: ScreenshotOptions,
  ): Promise<{ page: Page; releasePage: () => Promise<void> }> {
    // Find browser with available pages
    let pooledBrowser = this.browsers.find(
      (b) =>
        b.browser.isConnected() &&
        b.availablePages.length > 0 &&
        b.activePagesCount < this.maxPagesPerBrowser,
    );

    // Create new browser if needed or viewport doesn't match
    if (!pooledBrowser && this.browsers.length < this.maxBrowsers) {
      pooledBrowser = await this.createBrowser(options);
    }

    // Use least loaded browser as fallback, but recreate context if viewport differs
    if (!pooledBrowser) {
      pooledBrowser = this.browsers
        .filter((b) => b.browser.isConnected())
        .sort((a, b) => a.activePagesCount - b.activePagesCount)[0];

      // Recreate context with new viewport
      await pooledBrowser.context.close();
      pooledBrowser.context = await this.createContext(
        pooledBrowser.browser,
        options,
      );
      pooledBrowser.availablePages = []; // Clear old pages
    }

    if (!pooledBrowser) {
      throw new Error("No available browsers in pool");
    }

    // Get or create page
    let page: Page;
    if (pooledBrowser.availablePages.length > 0) {
      page = pooledBrowser.availablePages.pop()!;
      await this.resetPage(page, options);
    } else {
      page = await this.createPage(pooledBrowser, options);
    }

    pooledBrowser.activePagesCount++;
    pooledBrowser.lastUsed = Date.now();

    // Return page with release function
    return {
      page,
      releasePage: async () => {
        pooledBrowser!.activePagesCount--;
        pooledBrowser!.availablePages.push(page);
        pooledBrowser!.lastUsed = Date.now();
      },
    };
  }

  /**
   * Create browser context with proper viewport
   */
  private async createContext(
    browser: Browser,
    options: ScreenshotOptions,
  ): Promise<BrowserContext> {
    const viewport = {
      width: options.width || 1280,
      height: options.height || 720,
    };

    const contextOptions: Parameters<typeof browser.newContext>[0] = {
      ignoreHTTPSErrors: true,
      viewport: viewport,
    };

    // Set device scale factor if specified
    if (options.deviceScaleFactor) {
      contextOptions.deviceScaleFactor = options.deviceScaleFactor;
    }

    // Set user agent for mobile if specified
    if (options.mobile) {
      contextOptions.userAgent =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1";
      contextOptions.isMobile = true;
      contextOptions.hasTouch = true;
    }

    const context = await browser.newContext(contextOptions);

    // Set color scheme if dark mode is requested
    if (options.darkMode) {
      await context.addInitScript(() => {
        const media = matchMedia("(prefers-color-scheme: dark)");
        Object.defineProperty(media, "matches", { value: true });
      });
    }

    return context;
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
      // Standard chromium with optimizations
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
   * Reset page state for reuse
   */
  private async resetPage(
    page: Page,
    options: ScreenshotOptions,
  ): Promise<void> {
    // Quick reset by navigating to blank page
    await page.goto("about:blank");

    // Note: Viewport is set at context level, no need to reset here

    // Reapply optimizations
    await this.optimizePage(page, options);
  }

  /**
   * Apply page optimizations
   */
  private async optimizePage(
    page: Page,
    options: ScreenshotOptions,
  ): Promise<void> {
    // Block unnecessary resources
    await page.route("**/*", (route) => {
      const resourceType = route.request().resourceType();
      if (["font", "media", "websocket"].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    // Set color scheme
    if (options.darkMode) {
      await page.emulateMedia({ colorScheme: "dark" });
    }

    // Set timeouts
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(20000);
  }

  /**
   * Cleanup old resources
   */
  async cleanup(): Promise<void> {
    const now = Date.now();

    for (const pooledBrowser of this.browsers) {
      // Close idle pages
      if (
        pooledBrowser.availablePages.length > 0 &&
        now - pooledBrowser.lastUsed > this.pageIdleTimeout
      ) {
        const pagesToClose = pooledBrowser.availablePages.splice(0);
        for (const page of pagesToClose) {
          try {
            await page.close();
          } catch {
            // Silent failure - graceful degradation
          }
        }
      }
    }

    // Remove idle browsers
    const browsersToRemove = this.browsers.filter(
      (b) =>
        !b.browser.isConnected() ||
        (b.activePagesCount === 0 &&
          now - b.lastUsed > this.browserIdleTimeout),
    );

    for (const browserInfo of browsersToRemove) {
      try {
        await browserInfo.browser.close();
      } catch {
        // Silent failure - graceful degradation
      }
    }

    this.browsers = this.browsers.filter((b) => !browsersToRemove.includes(b));
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

/**
 * Take screenshot using optimized browser pool
 */
async function takeScreenshot(options: ScreenshotOptions): Promise<Buffer> {
  const { page, releasePage } = await browserPool.getPage(options);

  try {
    // Navigate to URL
    await page.goto(options.url, {
      waitUntil: options.waitUntil || "networkidle",
      timeout: 20000,
    });

    // Optional delay
    if (options.delay && options.delay > 0) {
      await page.waitForTimeout(Math.min(options.delay, 3000));
    }

    // Screenshot configuration
    const screenshotConfig: Parameters<typeof page.screenshot>[0] = {
      type: (options.format === "webp" ? "png" : options.format) || "png", // WebP not supported, fallback to PNG
      fullPage: options.fullPage !== false,
    };

    // Add quality for JPEG only (WebP handled as PNG)
    if (options.format === "jpeg") {
      screenshotConfig.quality = Math.min(
        Math.max(options.quality || 80, 1),
        100,
      );
    }

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

  const options: ScreenshotOptions = {
    url: url.startsWith("http") ? url : `https://${url}`,
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
  options.fullPage = query.fullPage !== "false";
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
    options.delay = Math.min(Math.max(parseInt(String(query.delay)), 0), 3000);
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
 * Generate cache key for screenshot
 */
function generateCacheKey(options: ScreenshotOptions): string {
  const parts = [
    "screenshot-v2",
    options.url,
    options.width || 1280,
    options.height || 720,
    options.fullPage ? "full" : "viewport",
    options.format || "png",
    options.quality || 80,
    options.mobile ? "mobile" : "desktop",
    options.darkMode ? "dark" : "light",
  ];

  return parts.join(":");
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
                  "Cache-Control": "public, max-age=3600",
                  "X-Cache": "HIT",
                },
              });
            }

            // Take screenshot
            const screenshotBuffer = await takeScreenshot(options);

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
                "Cache-Control": "public, max-age=3600",
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
