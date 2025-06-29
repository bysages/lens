// Font caching utilities
import { cacheStorage } from "../storage";
import type { Unifont } from "./types";

// Create unified cache key for font resolution with optional parameters
export function createFontCacheKey(
  provider: string,
  fontName: string,
  options?: unknown,
): string {
  const normalizedOptions = options || {};
  return `font-resolve:${provider}:${btoa(fontName)}:${btoa(JSON.stringify(normalizedOptions))}`;
}

// Get or set font data with unified caching strategy
export async function getCachedFontData(
  provider: string,
  fontName: string,
  unifont: Unifont,
  options?: unknown,
): Promise<any> {
  const normalizedOptions = options || {};
  const primaryCacheKey = createFontCacheKey(
    provider,
    fontName,
    normalizedOptions,
  );

  // Try primary cache first
  let fontData = await cacheStorage.metadata.get(primaryCacheKey);

  if (!fontData?.fonts?.length) {
    // Check if this is effectively a no-options call and can reuse base cache
    const isBasicCall =
      !normalizedOptions ||
      (typeof normalizedOptions === "object" &&
        Object.keys(normalizedOptions).length === 0) ||
      (typeof normalizedOptions === "object" &&
        !(normalizedOptions as any).weights &&
        !(normalizedOptions as any).styles &&
        (!(normalizedOptions as any).subsets ||
          (normalizedOptions as any).subsets.length === 0));

    if (isBasicCall && options) {
      // Try to reuse the base font data cache first
      const baseCacheKey = createFontCacheKey(provider, fontName, {});
      fontData = await cacheStorage.metadata.get(baseCacheKey);
    }

    if (!fontData?.fonts?.length) {
      // Fetch font data
      fontData = options
        ? await unifont.resolveFont(fontName, options)
        : await unifont.resolveFont(fontName);

      // Cache the resolved font data for 24 hours
      if (fontData?.fonts?.length) {
        await cacheStorage.metadata.set(primaryCacheKey, fontData);

        // If this was a basic call, also cache it with the base key for sharing
        if (isBasicCall && options) {
          const baseCacheKey = createFontCacheKey(provider, fontName, {});
          await cacheStorage.metadata.set(baseCacheKey, fontData);
        }
      }
    }
  }

  return fontData;
}

// Cache available fonts list
let cachedFontsList: string[] | null = null;
let fontsListCacheTime: number = 0;
const FONTS_LIST_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Get cached fonts list with automatic refresh
export async function getCachedFontsList(
  provider: string,
  config?: unknown,
  unifont?: Unifont,
): Promise<string[]> {
  const now = Date.now();
  const cacheKey = `fonts-list:${provider}:${config ? JSON.stringify(config) : ""}`;

  // Check memory cache first
  if (cachedFontsList && now - fontsListCacheTime < FONTS_LIST_CACHE_DURATION) {
    return cachedFontsList;
  }

  // Check persistent cache
  const cached = await cacheStorage.metadata.get(cacheKey);
  if (cached && Array.isArray(cached)) {
    cachedFontsList = cached;
    fontsListCacheTime = now;
    return cachedFontsList;
  }

  // Fetch fresh list if unifont instance provided
  if (unifont) {
    try {
      const fontsList = await unifont.listFonts();

      if (fontsList && fontsList.length > 0) {
        cachedFontsList = fontsList;
        fontsListCacheTime = now;

        // Cache for 24 hours
        await cacheStorage.metadata.set(cacheKey, fontsList);
        return fontsList;
      }
    } catch (error) {
      console.error(
        `Failed to fetch fonts list for provider ${provider}:`,
        error,
      );
    }
  }

  return [];
}

// Check if font exists in cached list
export async function isFontAvailable(
  fontName: string,
  provider: string,
  config?: unknown,
  unifont?: Unifont,
): Promise<boolean> {
  const fontsList = await getCachedFontsList(provider, config, unifont);
  return fontsList.some(
    (font) =>
      font.toLowerCase() === fontName.toLowerCase() ||
      font.toLowerCase().replace(/\s+/g, "") ===
        fontName.toLowerCase().replace(/\s+/g, ""),
  );
}
