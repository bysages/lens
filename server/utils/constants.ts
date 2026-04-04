// ── Server-Side Cache TTL ──────────────────────────────

/** Font metadata (external API lists): 1 hour */
export const FONT_META_TTL = 3600;

/** Screenshots (websites change frequently): 1 day */
export const SCREENSHOT_TTL = 86400;

/** Image proxy (source images may update): 1 day */
export const IMAGE_PROXY_TTL = 86400;

/** OG images (deterministic output, same params = same image): 7 days */
export const OG_IMAGE_TTL = 604800;

/** Gravatar (avatar images change infrequently): 7 days */
export const GRAVATAR_TTL = 604800;

/** Favicons (rarely change): 30 days */
export const FAVICON_TTL = 2592000;

/** Font files (static versioned assets): 30 days */
export const FONT_FILE_TTL = 2592000;

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
