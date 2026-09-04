// ── Server-Side Cache TTL ──────────────────────────────

/** Font metadata (external API lists): 1 hour */
export const FONT_META_TTL = 3600;

/** Browser-based services (screenshots, reader): 1 day */
export const BROWSER_TTL = 86400;

/** Image proxy (source images may update): 1 day */
export const IMAGE_PROXY_TTL = 86400;

/** OG images (deterministic output, same params = same image): 7 days */
export const OG_IMAGE_TTL = 604800;

/** Gravatar (avatar images change infrequently): 7 days */
export const GRAVATAR_TTL = 604800;

/** Favicons (rarely change): 24 days — unstorage memory driver uses setTimeout(ttl * 1e3), which overflows a 32-bit signed integer above 2147483s */
export const FAVICON_TTL = 2073600;

/** Font files (static versioned assets): 24 days, capped for the same setTimeout limit */
export const FONT_FILE_TTL = 2073600;

// ── Defaults & Limits ───────────────────────────────

/** Screenshot: default viewport width */
export const SCREENSHOT_DEFAULT_WIDTH = 1280;

/** Screenshot: default viewport height */
export const SCREENSHOT_DEFAULT_HEIGHT = 720;

/** Screenshot: max viewport width */
export const SCREENSHOT_MAX_WIDTH = 2560;

/** Screenshot: max viewport height */
export const SCREENSHOT_MAX_HEIGHT = 1440;

/** Screenshot/Reader: default navigation timeout (ms) */
export const BROWSER_TIMEOUT = 10000;

/** Browser: max concurrent pages per worker */
export const BROWSER_MAX_CONCURRENCY = 4;

/** Favicon: default icon size */
export const FAVICON_DEFAULT_SIZE = 32;

/** Favicon: min icon size */
export const FAVICON_MIN_SIZE = 16;

/** Favicon: max icon size */
export const FAVICON_MAX_SIZE = 256;

/** OG image: default width */
export const OG_DEFAULT_WIDTH = 1200;

/** OG image: default height */
export const OG_DEFAULT_HEIGHT = 630;

// ── Rate Limit ──────────────────────────────────────

/** Browser rate limit: 10 requests per minute per IP */
export const BROWSER_RATE_LIMIT = 10;

/** Browser rate limit window: 60 seconds */
export const BROWSER_RATE_WINDOW = 60;

// ── Cache-Control ──────────────────────────────────────

/** Short cache for mutable data (font metadata): 1 hour */
export const CACHE_SHORT = "public, max-age=3600";

/** Font CSS (derived from cached metadata, mirrors Google Fonts TTL): 1 day */
export const CACHE_FONT_CSS = "public, max-age=86400";

/** Medium cache for mutable images (screenshots, image proxy): 1 day */
export const CACHE_MEDIUM = "public, max-age=86400";

/** Long cache for rarely-changing assets (favicons, gravatar): 30 days */
export const CACHE_LONG = "public, max-age=2592000";

/** Immutable cache for deterministic/static assets (OG images, font files): 1 year */
export const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";
