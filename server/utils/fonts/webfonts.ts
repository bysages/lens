import { useStorage } from "nitro/storage";

import { FONT_META_TTL } from "../constants";
import { getBunnyWebFonts } from "./providers/bunny";
import { getFontshareWebFonts } from "./providers/fontshare";
import { getFontsourceWebFonts } from "./providers/fontsource";
// Import providers
import { getGoogleWebFonts } from "./providers/google";
import { getGoogleIconsWebFonts } from "./providers/googleicons";
// WebFonts API - Main entry point
import type { WebFontItem } from "./types";

// Supported providers
const SUPPORTED_PROVIDERS = ["google", "googleicons", "bunny", "fontshare", "fontsource"] as const;
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

// Provider registry (without storage parameter - providers don't handle caching)
const providers: Record<SupportedProvider, (filter?: string) => Promise<WebFontItem[]>> = {
  google: getGoogleWebFonts,
  googleicons: getGoogleIconsWebFonts,
  bunny: getBunnyWebFonts,
  fontshare: getFontshareWebFonts,
  fontsource: getFontsourceWebFonts,
};

// Apply sorting to font items
export function sortFontItems(items: WebFontItem[], sort: string): void {
  switch (sort) {
    case "alpha":
    case "trending":
      items.sort((a, b) => a.family.localeCompare(b.family));
      break;
    case "popularity":
    case "style":
      items.sort((a, b) => b.variants.length - a.variants.length);
      break;
    case "date":
    default:
      // Keep original order (no sorting needed)
      break;
  }
}

// Main function to get webfonts list with unified caching
export async function getWebfontsList(
  provider: string,
  filters: {
    family?: string;
    subset?: string;
    category?: string;
  },
  sort: string,
): Promise<{ kind: string; items: WebFontItem[] }> {
  // Validate provider
  if (!SUPPORTED_PROVIDERS.includes(provider as SupportedProvider)) {
    console.warn(`Unsupported provider: ${provider}. Falling back to google.`);
    provider = "google";
  }

  const storage = useStorage("cache");
  const cacheKey = `webfonts:list:${provider}:${filters.family || "all"}`;
  const cached = await storage.getItem<{ kind: string; items: WebFontItem[] }>(cacheKey);

  if (cached) {
    return cached;
  }

  const getFonts = providers[provider as SupportedProvider];

  // Get fonts from provider (providers only fetch data, no caching)
  let items = await getFonts(filters.family);

  // Apply subset filter
  if (filters.subset) {
    items = items.filter((item) => item.subsets.some((s) => s.includes(filters.subset!)));
  }

  // Apply category filter
  if (filters.category) {
    items = items.filter((item) => item.category === filters.category);
  }

  // Apply sorting
  sortFontItems(items, sort);

  const result = {
    kind: "webfonts#webfontList",
    items,
  };

  // Cache for 1 hour
  await storage.setItem(cacheKey, result, { ttl: FONT_META_TTL });

  return result;
}
