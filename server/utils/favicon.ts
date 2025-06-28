import { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import * as cheerio from "cheerio";
import { cacheStorage } from "./storage";
import { pluginRateLimits } from "./rate-limits";

// Copy Sharp types
type SharpOptions = {
  fit?: "contain" | "cover" | "fill" | "inside" | "outside";
  background?: { r: number; g: number; b: number; alpha: number };
};

// PWA Manifest icon interface
interface ManifestIcon {
  src: string;
  sizes: string;
  type?: string;
}

interface WebManifest {
  icons?: ManifestIcon[];
}

/**
 * Try to get high-quality icons from PWA manifests
 */
async function tryManifestIcons(domain: string): Promise<Buffer | null> {
  const manifestPaths = [
    "/manifest.json",
    "/site.webmanifest",
    "/manifest.webmanifest",
    "/app.manifest",
    "/assets/manifest.json",
    "/static/manifest.json",
    "/public/manifest.json",
  ];

  for (const manifestPath of manifestPaths) {
    try {
      const response = await fetch(`https://${domain}${manifestPath}`, {
        headers: { "User-Agent": "Mozilla/5.0 Favicon Extractor" },
      });

      if (!response.ok) continue;

      const manifest: WebManifest = await response.json();
      if (!manifest.icons?.length) continue;

      // Sort icons by size (largest first), try multiple sizes as fallback
      const sortedIcons = manifest.icons
        .filter((icon) => icon.sizes && icon.src)
        .sort((a, b) => {
          const sizeA = parseInt(a.sizes.split("x")[0]) || 0;
          const sizeB = parseInt(b.sizes.split("x")[0]) || 0;
          return sizeB - sizeA;
        });

      // Try icons starting from highest quality
      for (const icon of sortedIcons) {
        try {
          const iconUrl = icon.src.startsWith("http")
            ? icon.src
            : `https://${domain}${icon.src.startsWith("/") ? "" : "/"}${icon.src}`;

          const iconResponse = await fetch(iconUrl);
          if (iconResponse.ok) {
            return Buffer.from(await iconResponse.arrayBuffer());
          }
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Try to get Apple Touch Icons (usually high quality)
 */
async function tryAppleTouchIcons(domain: string): Promise<Buffer | null> {
  const applePaths = [
    // Largest to smallest (better quality first)
    "/apple-touch-icon.png", // Default, usually largest
    "/apple-touch-icon-180x180.png", // iPhone 6 Plus/X/11/12/13
    "/apple-touch-icon-167x167.png", // iPad Pro
    "/apple-touch-icon-152x152.png", // iPad
    "/apple-touch-icon-120x120.png", // iPhone 6/7/8
    "/apple-touch-icon-114x114.png", // iPhone 4 Retina
    "/apple-touch-icon-76x76.png", // iPad
    "/apple-touch-icon-72x72.png", // iPad 1/2
    "/apple-touch-icon-60x60.png", // iPhone
    "/apple-touch-icon-57x57.png", // iPhone 3G/3GS
    "/apple-touch-icon-precomposed.png", // Generic precomposed
    // Also check in common subdirectories
    "/assets/apple-touch-icon.png",
    "/static/apple-touch-icon.png",
    "/public/apple-touch-icon.png",
    "/images/apple-touch-icon.png",
    "/img/apple-touch-icon.png",
  ];

  for (const path of applePaths) {
    try {
      const response = await fetch(`https://${domain}${path}`);
      if (
        response.ok &&
        response.headers.get("content-type")?.startsWith("image/")
      ) {
        return Buffer.from(await response.arrayBuffer());
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Try to get favicon from HTML tags (lightweight parsing)
 */
async function tryHTMLFaviconTags(domain: string): Promise<Buffer | null> {
  try {
    const response = await fetch(`https://${domain}`, {
      headers: { "User-Agent": "Mozilla/5.0 Favicon Extractor" },
    });

    if (!response.ok) return null;

    const html = await response.text();
    // Only parse <head> section for performance
    const headEnd = html.indexOf("</head>");
    const headHtml =
      headEnd > 0 ? html.substring(0, headEnd + 7) : html.substring(0, 5000);

    const $ = cheerio.load(headHtml);

    // Try to find high-quality favicon links (ordered by preference)
    const faviconSelectors = [
      // High quality sized icons first
      'link[rel*="icon"][sizes*="512"]',
      'link[rel*="icon"][sizes*="256"]',
      'link[rel*="icon"][sizes*="192"]',
      'link[rel*="icon"][sizes*="128"]',
      'link[rel*="icon"][sizes*="96"]',
      'link[rel*="icon"][sizes*="64"]',
      'link[rel*="icon"][sizes*="48"]',
      'link[rel*="icon"][sizes*="32"]',
      'link[rel*="icon"][sizes*="16"]',

      // Apple Touch Icons in HTML
      'link[rel="apple-touch-icon"]',
      'link[rel="apple-touch-icon-precomposed"]',

      // Safari and other browser specific
      'link[rel="mask-icon"]', // Safari Pinned Tab
      'link[rel="fluid-icon"]', // Fluid App

      // Standard favicon types
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',

      // As last resort, try meta tags
      'meta[name="msapplication-TileImage"]', // Windows Live Tiles
      'meta[property="og:image"]', // Open Graph as fallback
    ];

    for (const selector of faviconSelectors) {
      let href: string | undefined;

      // Handle different tag types
      if (selector.startsWith('meta[name="msapplication-TileImage"]')) {
        href = $('meta[name="msapplication-TileImage"]').attr("content");
      } else if (selector.startsWith('meta[property="og:image"]')) {
        href = $('meta[property="og:image"]').attr("content");
      } else {
        // Standard link tags
        href = $(selector).attr("href");
      }

      if (href) {
        const faviconUrl = href.startsWith("http")
          ? href
          : `https://${domain}${href.startsWith("/") ? "" : "/"}${href}`;

        try {
          const faviconResponse = await fetch(faviconUrl);
          if (faviconResponse.ok) {
            return Buffer.from(await faviconResponse.arrayBuffer());
          }
        } catch {
          continue;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Try direct paths as fallback
 */
async function tryDirectPaths(domain: string): Promise<Buffer | null> {
  const directPaths = [
    // Standard favicon paths
    "/favicon.ico",
    "/favicon.png",
    "/favicon.jpg",
    "/favicon.jpeg",
    "/favicon.gif",
    "/favicon.svg",

    // Sized favicons
    "/favicon-16x16.png",
    "/favicon-32x32.png",
    "/favicon-96x96.png",
    "/favicon-192x192.png",

    // Alternative names
    "/icon.png",
    "/icon.ico",
    "/logo.png",
    "/logo.ico",
    "/logo.jpg",

    // Common subdirectories
    "/assets/favicon.ico",
    "/assets/favicon.png",
    "/static/favicon.ico",
    "/static/favicon.png",
    "/public/favicon.ico",
    "/public/favicon.png",
    "/images/favicon.ico",
    "/images/favicon.png",
    "/img/favicon.ico",
    "/img/favicon.png",
    "/media/favicon.ico",
    "/media/favicon.png",

    // WordPress/CMS common paths
    "/wp-content/themes/favicon.ico",
    "/wp-content/uploads/favicon.ico",
    "/themes/favicon.ico",
    "/content/favicon.ico",
  ];

  for (const path of directPaths) {
    try {
      const response = await fetch(`https://${domain}${path}`);
      if (
        response.ok &&
        response.headers.get("content-type")?.includes("image")
      ) {
        return Buffer.from(await response.arrayBuffer());
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Optimize favicon using Sharp
 */
async function optimizeWithSharp(
  faviconBuffer: Buffer,
  targetSize: number,
): Promise<Buffer> {
  const sharp = await import("sharp");

  return await sharp
    .default(faviconBuffer)
    .resize(targetSize, targetSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    } satisfies SharpOptions)
    .sharpen()
    .png({ quality: 90 })
    .toBuffer();
}

/**
 * Generate default favicon if all sources fail
 */
async function generateDefaultFavicon(
  domain: string,
  size: number,
): Promise<Buffer> {
  const sharp = await import("sharp");

  // Extract first letter of domain for better readability
  const firstLetter = domain.charAt(0).toUpperCase();

  // Generate gradient colors based on domain hash
  const hash = domain.split("").reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0);
    return a & a;
  }, 0);

  const hue = Math.abs(hash) % 360;
  const lightColor = `hsl(${hue}, 70%, 60%)`;
  const darkColor = `hsl(${hue}, 80%, 45%)`;

  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${lightColor};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${darkColor};stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" fill="url(#grad)" rx="${Math.floor(size * 0.15)}"/>
      <text x="50%" y="50%" text-anchor="middle" dy="0.35em" fill="white" 
            font-family="system-ui, -apple-system, sans-serif" 
            font-weight="600" 
            font-size="${Math.floor(size * 0.55)}"
            text-shadow="0 1px 2px rgba(0,0,0,0.3)">${firstLetter}</text>
    </svg>
  `;

  return await sharp.default(Buffer.from(svg)).png({ quality: 90 }).toBuffer();
}

/**
 * Main favicon extraction function
 */
async function getFavicon(domain: string, size: number = 32): Promise<Buffer> {
  // Clean domain
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");

  // Try sources in quality priority order
  const sources = [
    () => tryManifestIcons(cleanDomain),
    () => tryAppleTouchIcons(cleanDomain),
    () => tryHTMLFaviconTags(cleanDomain),
    () => tryDirectPaths(cleanDomain),
  ];

  for (const source of sources) {
    try {
      const favicon = await source();
      if (favicon && favicon.length > 100) {
        // Basic validation
        return await optimizeWithSharp(favicon, size);
      }
    } catch {
      // Favicon source failed - try next source
      continue;
    }
  }

  // Generate default if all sources fail
  return await generateDefaultFavicon(cleanDomain, size);
}

export const faviconPlugin = (): BetterAuthPlugin => {
  return {
    id: "favicon",

    rateLimit: pluginRateLimits.favicon,

    endpoints: {
      // Favicon extraction endpoint
      extractFavicon: createAuthEndpoint(
        "/favicon",
        {
          method: "GET",
        },
        async (ctx) => {
          try {
            const query = ctx.query;

            // Get URL parameter and extract domain
            const url = String(query.url || "");
            if (!url) {
              return new Response(
                JSON.stringify({ error: "Missing url parameter" }),
                {
                  status: 400,
                  headers: { "Content-Type": "application/json" },
                },
              );
            }

            // Parse size parameter
            const size = Math.min(
              Math.max(parseInt(String(query.size || "32")), 16),
              256,
            );

            // Extract domain from URL for cache key
            const domain = url
              .replace(/^https?:\/\//, "")
              .replace(/\/$/, "")
              .split("/")[0];

            // Generate cache key
            const cacheKey = `favicon:${domain}:${size}`;

            // Check cache first
            const cached = await cacheStorage.favicons.get(cacheKey);
            if (cached) {
              return new Response(cached, {
                headers: {
                  "Content-Type": "image/png",
                  "Cache-Control": "public, max-age=86400", // 24 hours
                  "X-Cache": "HIT",
                },
              });
            }

            // Extract favicon
            const faviconBuffer = await getFavicon(url, size);

            // Cache for 24 hours
            await cacheStorage.favicons.set(cacheKey, faviconBuffer);

            return new Response(faviconBuffer, {
              headers: {
                "Content-Type": "image/png",
                "Cache-Control": "public, max-age=86400",
                "X-Cache": "MISS",
              },
            });
          } catch (error) {
            return new Response(
              JSON.stringify({
                error: "Favicon extraction failed",
                details:
                  error instanceof Error ? error.message : "Unknown error",
              }),
              {
                status: 500,
                headers: {
                  "Content-Type": "application/json",
                },
              },
            );
          }
        },
      ),
    },
  };
};
