import { useStorage } from "nitro/storage";

import { FONT_META_TTL } from "../../constants";
// Fontsource provider for WebFonts API
import { sortVariants } from "../helpers";
import type { WebFontItem } from "../types";

export interface FontsourceFontMeta {
  id: string;
  family: string;
  subsets: string[];
  weights: number[];
  styles: string[];
  defSubset: string;
  variable: boolean;
  lastModified: string;
  category: string;
  version: string;
  type: string;
}

const API_BASE = "https://api.fontsource.org/v1";

// Get Fontsource metadata
export async function getFontsourceMeta(): Promise<FontsourceFontMeta[]> {
  const storage = useStorage("cache");
  const cacheKey = "fontmeta:fontsource.json";
  const cached = await storage.getItem<FontsourceFontMeta[]>(cacheKey);

  if (cached) {
    return cached;
  }

  // Fetch from Fontsource API
  const response = await fetch(`${API_BASE}/fonts`);
  const data = (await response.json()) as FontsourceFontMeta[];

  // Cache for 1 hour
  await storage.setItem(cacheKey, data, { ttl: FONT_META_TTL });

  return data;
}

// Convert to WebFontItem format
export async function getFontsourceWebFonts(filter?: string): Promise<WebFontItem[]> {
  const meta = await getFontsourceMeta();

  const filtered = filter
    ? meta.filter((font) => font.family.toLowerCase().includes(filter.toLowerCase()))
    : meta;

  return filtered.map((font) => {
    const variants = new Set<string>();
    const files: Record<string, string> = {};

    // Generate variants from weights and styles
    for (const weight of font.weights) {
      const weightStr = String(weight);
      for (const style of font.styles) {
        if (style === "italic") {
          if (weightStr === "400") {
            variants.add("italic");
          } else {
            variants.add(`${weightStr}italic`);
          }
        } else if (weightStr === "400") {
          variants.add("regular");
        } else {
          variants.add(weightStr);
        }
      }
    }

    return {
      kind: "webfonts#webfont",
      family: font.family,
      category: font.category.toLowerCase(),
      variants: sortVariants(Array.from(variants)),
      subsets: font.subsets,
      version: font.version,
      lastModified: font.lastModified,
      files,
    };
  });
}
