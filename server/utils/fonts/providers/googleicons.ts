// Google Icons provider for WebFonts API
import { useStorage } from "nitro/storage";

import type { WebFontItem } from "../types";

// Google Icons meta is just an array of family names
export type GoogleiconsFontMeta = string[];

const API_BASE = "https://fonts.google.com";

// Get Google Icons metadata
export async function getGoogleIconsMeta(): Promise<GoogleiconsFontMeta> {
  const storage = useStorage("cache");
  const cacheKey = "fontmeta:googleicons.json";
  const cached = await storage.getItem<GoogleiconsFontMeta>(cacheKey);

  if (cached) {
    return cached;
  }

  // Fetch from Google Fonts API
  const response = await fetch(`${API_BASE}/metadata/icons?key=material_symbols&incomplete=true`);
  const text = await response.text();

  // Remove first line (XSSI protection) and parse JSON
  const jsonStart = text.indexOf("\n") + 1;
  const data = JSON.parse(text.slice(jsonStart)) as { families: string[] };

  // Cache for 1 hour
  await storage.setItem(cacheKey, data.families);
  await storage.setMeta(cacheKey, { ttl: 3600 });

  return data.families;
}

// Convert to WebFontItem format
export async function getGoogleIconsWebFonts(filter?: string): Promise<WebFontItem[]> {
  const meta = await getGoogleIconsMeta();

  const filtered = filter
    ? meta.filter((family) => family.toLowerCase().includes(filter.toLowerCase()))
    : meta;

  return filtered.map((family) => {
    // Determine icon type from family name
    const isSymbols = family.toLowerCase().includes("symbols");
    const category = isSymbols ? "symbols" : "display";

    // Files object (will be populated when actual URLs are resolved)
    const files: Record<string, string> = {};

    // For Material Symbols (new icons with variable axes)
    if (isSymbols) {
      return {
        kind: "webfonts#webfont",
        family,
        category,
        variants: ["100", "200", "300", "400", "500", "600", "700"],
        subsets: ["latin"],
        files,
      };
    }

    // For Material Icons (legacy icons)
    return {
      kind: "webfonts#webfont",
      family,
      category,
      variants: ["regular"],
      subsets: ["latin"],
      files,
    };
  });
}
