import { useStorage } from "nitro/storage";

import { FONT_META_TTL } from "../../constants";
// Bunny Fonts provider for WebFonts API
import { sortVariants } from "../helpers";
import type { WebFontItem } from "../types";

export interface BunnyFontMeta {
  category: string;
  defSubset: string;
  familyName: string;
  isVariable: boolean;
  styles: string[];
  variants: Record<string, number>;
  weights: number[];
}

const API_BASE = "https://fonts.bunny.net";

// Get Bunny Fonts metadata
export async function getBunnyFontsMeta(): Promise<Record<string, BunnyFontMeta>> {
  const storage = useStorage("cache");
  const cacheKey = "fontmeta:bunny.json";
  const cached = await storage.getItem<Record<string, BunnyFontMeta>>(cacheKey);

  if (cached) {
    return cached;
  }

  // Fetch from Bunny Fonts API
  const response = await fetch(`${API_BASE}/list`);
  const data = (await response.json()) as Record<string, BunnyFontMeta>;

  // Cache for 1 hour
  await storage.setItem(cacheKey, data, { ttl: FONT_META_TTL });

  return data;
}

// Convert to WebFontItem format
export async function getBunnyWebFonts(filter?: string): Promise<WebFontItem[]> {
  const meta = await getBunnyFontsMeta();

  const filteredEntries = filter
    ? Object.entries(meta).filter(([_, fontMeta]) =>
        fontMeta.familyName.toLowerCase().includes(filter.toLowerCase()),
      )
    : Object.entries(meta);

  return filteredEntries.map(([_id, fontMeta]) => {
    const variants = new Set<string>();
    const files: Record<string, string> = {};

    // Generate variants from weights and styles
    for (const weight of fontMeta.weights) {
      const weightStr = String(weight);
      for (const style of fontMeta.styles) {
        if (style === "italic") {
          if (weightStr === "400") {
            variants.add("italic");
          } else {
            variants.add(`${weightStr}italic`);
          }
        } else {
          if (weightStr === "400") {
            variants.add("regular");
          } else {
            variants.add(weightStr);
          }
        }
      }
    }

    return {
      kind: "webfonts#webfont",
      family: fontMeta.familyName,
      category: fontMeta.category.toLowerCase(),
      variants: sortVariants(Array.from(variants)),
      subsets: [fontMeta.defSubset],
      files,
    };
  });
}
