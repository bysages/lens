import * as cheerio from "cheerio";
import { defineHandler, HTTPError, getQuery } from "nitro/h3";
import { hash } from "ohash";
import sharp from "sharp";

import { serveCached } from "../utils/cache";
import {
  CACHE_LONG,
  FAVICON_MAX_SIZE,
  FAVICON_MIN_SIZE,
  FAVICON_DEFAULT_SIZE,
  FAVICON_RATE_LIMIT,
  FAVICON_TTL,
  MAX_CACHE_ENTRY_BYTES,
  RATE_WINDOW,
} from "../utils/constants";
import { clampInt, firstString } from "../utils/params";
import { rateLimit } from "../utils/rate-limit";
import { assertSafeUrl, extractHostname, safeFetch } from "../utils/ssrf";

export interface FaviconQuery {
  url: string;
  size?: string;
}

interface ManifestIcon {
  src: string;
  sizes: string;
  type?: string;
  purpose?: string;
}

// Cap on remote icon downloads: manifests and HTML tags can point anywhere,
// including multi-hundred-megabyte payloads
const MAX_ICON_BYTES = 5 * 1024 * 1024;

const FAVICON_UA = { "User-Agent": "Mozilla/5.0 Favicon Extractor" };

/** Read a response body enforcing the icon size cap. */
async function readWithinLimit(response: Response): Promise<Buffer | null> {
  const declared = Number.parseInt(response.headers.get("content-length") || "", 10);
  if (Number.isFinite(declared) && declared > MAX_ICON_BYTES) return null;
  const data = Buffer.from(await response.arrayBuffer());
  return data.byteLength <= MAX_ICON_BYTES ? data : null;
}

/** Download an icon through the SSRF-checked fetch wrapper. */
async function downloadIcon(
  url: string,
  timeoutMs: number,
  accept?: string,
): Promise<Buffer | null> {
  const response = await safeFetch(url, {
    headers: { ...FAVICON_UA, ...(accept && { Accept: accept }) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response?.ok) return null;
  return readWithinLimit(response);
}

/** Probe a candidate icon path; returns the bytes when the response is an image. */
async function probeIconPath(
  domain: string,
  path: string,
  timeoutMs: number,
): Promise<Buffer | null> {
  const response = await safeFetch(`https://${domain}${path}`, {
    headers: { ...FAVICON_UA, Accept: "image/*" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response?.ok || !response.headers.get("content-type")?.startsWith("image/")) return null;
  return readWithinLimit(response);
}

async function tryManifestIcons(domain: string): Promise<Buffer | null> {
  const manifestPaths = [
    "/manifest.webmanifest",
    "/manifest.json",
    "/site.webmanifest",
    "/app.webmanifest",
    "/app.manifest",
    "/assets/manifest.webmanifest",
    "/static/manifest.webmanifest",
    "/public/manifest.webmanifest",
  ];

  for (const path of manifestPaths) {
    const response = await safeFetch(`https://${domain}${path}`, {
      headers: { ...FAVICON_UA, Accept: "application/json,application/manifest+json" },
      signal: AbortSignal.timeout(5000),
    });

    if (!response?.ok) continue;

    const manifest = (await response.json().catch(() => null)) as { icons?: ManifestIcon[] } | null;
    if (!manifest?.icons?.length) continue;

    const sortedIcons = manifest.icons
      .filter((icon) => icon.sizes && icon.src)
      .sort((a, b) => {
        const aIsMaskable = a.purpose === "maskable" || a.sizes === "512x512";
        const bIsMaskable = b.purpose === "maskable" || b.sizes === "512x512";

        if (aIsMaskable && !bIsMaskable) return -1;
        if (!aIsMaskable && bIsMaskable) return 1;

        const sizeAParts = a.sizes.split("x");
        const sizeBParts = b.sizes.split("x");
        const sizeA = parseInt(sizeAParts[0] || "0") || 0;
        const sizeB = parseInt(sizeBParts[0] || "0") || 0;
        return sizeB - sizeA;
      });

    for (const icon of sortedIcons) {
      const iconUrl = /^https?:\/\//i.test(icon.src)
        ? icon.src
        : `https://${domain}${icon.src.startsWith("/") ? "" : "/"}${icon.src}`;

      const data = await downloadIcon(iconUrl, 5000, "image/*");
      if (data) return data;
    }
  }

  return null;
}

async function tryAppleTouchIcons(domain: string): Promise<Buffer | null> {
  const applePaths = [
    "/apple-touch-icon.png",
    "/apple-touch-icon-180x180.png",
    "/apple-touch-icon-precomposed.png",
    "/apple-touch-icon-192x192.png",
    "/apple-touch-icon-167x167.png",
    "/apple-touch-icon-152x152.png",
    "/apple-touch-icon-144x144.png",
    "/apple-touch-icon-120x120.png",
    "/apple-touch-icon-114x114.png",
    "/apple-touch-icon-96x96.png",
    "/apple-touch-icon-76x76.png",
    "/apple-touch-icon-72x72.png",
    "/apple-touch-icon-60x60.png",
    "/apple-touch-icon-57x57.png",
    "/assets/apple-touch-icon.png",
    "/static/apple-touch-icon.png",
    "/public/apple-touch-icon.png",
    "/images/apple-touch-icon.png",
    "/img/apple-touch-icon.png",
  ];

  for (const path of applePaths) {
    const data = await probeIconPath(domain, path, 3000);
    if (data) return data;
  }

  return null;
}

async function tryHTMLFaviconTags(domain: string): Promise<Buffer | null> {
  const response = await safeFetch(`https://${domain}`, {
    headers: { ...FAVICON_UA, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(8000),
  });

  if (!response?.ok) return null;

  const html = await response.text().catch(() => null);
  if (!html) return null;

  const headEnd = html.indexOf("</head>");
  const headHtml = headEnd > 0 ? html.substring(0, headEnd + 7) : html.substring(0, 5000);

  const $ = cheerio.load(headHtml);

  const selectors = [
    'link[rel="icon"][type="image/svg+xml"]',
    'link[rel="icon"][href*=".svg"]',
    'link[rel*="icon"][sizes*="512"]',
    'link[rel*="icon"][sizes*="256"]',
    'link[rel*="icon"][sizes*="192"]',
    'link[rel="apple-touch-icon"]',
    'link[rel="apple-touch-icon-precomposed"]',
    'link[rel="mask-icon"]',
    'link[rel="fluid-icon"]',
    'link[rel*="icon"][sizes*="128"]',
    'link[rel*="icon"][sizes="96"]',
    'link[rel*="icon"][sizes*="64"]',
    'link[rel*="icon"][sizes*="48"]',
    'link[rel*="icon"][sizes*="32"]',
    'link[rel*="icon"][sizes*="16"]',
    'link[rel="icon"]',
    'link[rel="shortcut icon"]',
    'meta[name="msapplication-TileImage"]',
    'meta[property="og:image"]',
  ];

  for (const selector of selectors) {
    let href: string | undefined;

    if (selector.startsWith('meta[name="msapplication-TileImage"]')) {
      href = $('meta[name="msapplication-TileImage"]').attr("content");
    } else if (selector.startsWith('meta[property="og:image"]')) {
      href = $('meta[property="og:image"]').attr("content");
    } else {
      href = $(selector).attr("href");
    }

    if (href) {
      // Icon URLs come from the target site's own markup — they may point
      // anywhere, so they go through the same SSRF-checked download
      const faviconUrl = /^https?:\/\//i.test(href)
        ? href
        : `https://${domain}${href.startsWith("/") ? "" : "/"}${href}`;

      const data = await downloadIcon(faviconUrl, 5000, "image/*");
      if (data) return data;
    }
  }

  return null;
}

async function tryDirectPaths(domain: string): Promise<Buffer | null> {
  const directPaths = [
    "/favicon.ico",
    "/favicon.png",
    "/favicon.svg",
    "/apple-touch-icon.png",
    "/icon.png",
    "/icon.ico",
    "/logo.png",
    "/logo.ico",
    "/favicon-16x16.png",
    "/favicon-32x32.png",
    "/favicon-96x96.png",
    "/favicon-192x192.png",
    "/favicon-512x512.png",
    "/favicon.jpg",
    "/favicon.jpeg",
    "/favicon.gif",
    "/assets/favicon.ico",
    "/assets/favicon.png",
    "/assets/favicon.svg",
    "/static/favicon.ico",
    "/static/favicon.png",
    "/static/favicon.svg",
    "/public/favicon.ico",
    "/public/favicon.png",
    "/public/favicon.svg",
    "/images/favicon.ico",
    "/images/favicon.png",
    "/images/favicon.svg",
    "/img/favicon.ico",
    "/img/favicon.png",
    "/media/favicon.ico",
    "/media/favicon.png",
    "/wp-content/themes/favicon.ico",
    "/wp-content/uploads/favicon.ico",
    "/wp-content/themes/favicon.png",
    "/wp-content/uploads/favicon.png",
    "/wp-includes/images/wlogo-blue-64x64.png",
    "/themes/favicon.ico",
    "/themes/favicon.png",
    "/content/favicon.ico",
  ];

  for (const path of directPaths) {
    const data = await probeIconPath(domain, path, 2000);
    if (data) return data;
  }

  return null;
}

async function optimizeFavicon(faviconBuffer: Buffer, targetSize: number): Promise<Buffer> {
  return await sharp(faviconBuffer, {
    sequentialRead: true,
    limitInputPixels: 16777216,
  })
    .resize(targetSize, targetSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      fastShrinkOnLoad: true,
    })
    .sharpen({ sigma: 0.5, m1: 1.0, m2: 2.0 })
    .png({
      quality: 90,
      compressionLevel: 6,
      progressive: false,
      palette: targetSize <= 32,
      adaptiveFiltering: false,
    })
    .toBuffer();
}

async function generateFallbackFavicon(domain: string, size: number): Promise<Buffer> {
  const firstLetter = domain.charAt(0).toUpperCase();

  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#f5f7fa;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#c3cfe2;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" fill="url(#grad)" rx="${Math.floor(size * 0.15)}"/>
      <text x="50%" y="50%" text-anchor="middle" dy="0.35em" fill="#4a5568"
            font-family="system-ui, -apple-system, sans-serif"
            font-weight="600"
            font-size="${Math.floor(size * 0.55)}"
            text-shadow="0 1px 2px rgba(0,0,0,0.1)">${firstLetter}</text>
    </svg>
  `;

  const processor = sharp(Buffer.from(svg));

  try {
    return await processor.png({ quality: 90 }).toBuffer();
  } finally {
    processor.destroy();
  }
}

async function getFavicon(domain: string, size: number = 32): Promise<Buffer> {
  const hostname = extractHostname(domain) ?? domain;

  // Execute all extraction methods in parallel
  const results = await Promise.allSettled([
    tryManifestIcons(hostname),
    tryAppleTouchIcons(hostname),
    tryHTMLFaviconTags(hostname),
    tryDirectPaths(hostname),
  ]);

  // Process results by priority
  for (const result of results) {
    if (result.status === "fulfilled" && result.value && result.value.length > 100) {
      const optimized = await optimizeFavicon(result.value, size).catch(() => null);
      if (optimized) return optimized;
    }
  }

  return generateFallbackFavicon(hostname, size);
}

export default defineHandler(async (event) => {
  const query = getQuery<FaviconQuery>(event);

  const rawUrl = firstString(query.url);
  if (!rawUrl) {
    throw new HTTPError({ status: 400, message: "Missing url parameter" });
  }

  const size = clampInt(query.size, FAVICON_MIN_SIZE, FAVICON_MAX_SIZE, FAVICON_DEFAULT_SIZE)!;
  const hostname = extractHostname(rawUrl) ?? rawUrl;
  await assertSafeUrl(`https://${hostname}`);

  const cacheKey = `favicon:${hash({ url: rawUrl, size })}.png`;

  return serveCached(event, {
    key: cacheKey,
    ttl: FAVICON_TTL,
    contentType: "image/png",
    cacheControl: CACHE_LONG,
    maxBytes: MAX_CACHE_ENTRY_BYTES,
    produce: async () => {
      await rateLimit(event, { limit: FAVICON_RATE_LIMIT, window: RATE_WINDOW, scope: "favicon" });
      return { data: await getFavicon(rawUrl, size) };
    },
  });
});
