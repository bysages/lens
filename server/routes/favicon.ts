import * as cheerio from "cheerio";
import { defineHandler, HTTPError, getQuery } from "nitro/h3";
import { useStorage } from "nitro/storage";
import { hash } from "ohash";
import sharp from "sharp";

export interface FaviconQuery {
  url: string;
  size?: string;
}

export interface ManifestIcon {
  src: string;
  sizes: string;
  type?: string;
  purpose?: string;
}

export async function tryManifestIcons(domain: string): Promise<Buffer | null> {
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
    const response = await fetch(`https://${domain}${path}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 Favicon Extractor",
        Accept: "application/json,application/manifest+json",
      },
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);

    if (!response?.ok) continue;

    const manifest = await response.json().catch(() => null);
    if (!manifest?.icons?.length) continue;

    const sortedIcons = (manifest.icons as ManifestIcon[])
      .filter((icon: ManifestIcon) => icon.sizes && icon.src)
      .sort((a: ManifestIcon, b: ManifestIcon) => {
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
      const iconUrl = icon.src.startsWith("http")
        ? icon.src
        : `https://${domain}${icon.src.startsWith("/") ? "" : "/"}${icon.src}`;

      const iconResponse = await fetch(iconUrl).catch(() => null);
      if (iconResponse?.ok) {
        return Buffer.from(await iconResponse.arrayBuffer());
      }
    }
  }

  return null;
}

export async function tryAppleTouchIcons(domain: string): Promise<Buffer | null> {
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
    const response = await fetch(`https://${domain}${path}`, {
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(3000),
    }).catch(() => null);

    if (response?.ok && response.headers.get("content-type")?.startsWith("image/")) {
      return Buffer.from(await response.arrayBuffer());
    }
  }

  return null;
}

export async function tryHTMLFaviconTags(domain: string): Promise<Buffer | null> {
  const response = await fetch(`https://${domain}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 Favicon Extractor",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);

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
      const faviconUrl = href.startsWith("http")
        ? href
        : `https://${domain}${href.startsWith("/") ? "" : "/"}${href}`;

      const faviconResponse = await fetch(faviconUrl).catch(() => null);
      if (faviconResponse?.ok) {
        return Buffer.from(await faviconResponse.arrayBuffer());
      }
    }
  }

  return null;
}

export async function tryDirectPaths(domain: string): Promise<Buffer | null> {
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
    const response = await fetch(`https://${domain}${path}`, {
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(2000),
    }).catch(() => null);

    if (response?.ok && response.headers.get("content-type")?.includes("image")) {
      return Buffer.from(await response.arrayBuffer());
    }
  }

  return null;
}

export async function optimizeFavicon(faviconBuffer: Buffer, targetSize: number): Promise<Buffer> {
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

export async function generateFallbackFavicon(domain: string, size: number): Promise<Buffer> {
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

export async function getFavicon(domain: string, size: number = 32): Promise<Buffer> {
  const hostname = domain.startsWith("http") ? new URL(domain).hostname : domain;

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

  if (!query.url) {
    throw new HTTPError({
      status: 400,
      message: "Missing url parameter",
    });
  }

  const size = Math.min(Math.max(parseInt(query.size || "32"), 16), 256);
  const url = String(query.url);

  const cacheKey = `favicon:${hash({ url, size })}.png`;
  const storage = useStorage("cache");
  const cached = await storage.getItemRaw<Uint8Array>(cacheKey);

  if (cached) {
    event.res.headers.set("X-Cache", "HIT");
    event.res.headers.set("Content-Type", "image/png");
    return Buffer.from(cached);
  }

  // CORS is handled by global routeRules
  const favicon = await getFavicon(url, size);

  await storage.setItemRaw(cacheKey, new Uint8Array(favicon));
  await storage.setMeta(cacheKey, { ttl: 2592000 }); // 30 days

  event.res.headers.set("X-Cache", "MISS");
  event.res.headers.set("Content-Type", "image/png");

  return favicon;
});
