import { useStorage } from "nitro/storage";

import { FONT_META_TTL } from "../../constants";
// Google Fonts provider for WebFonts API
import { sortVariants } from "../helpers";
import { categorizeFontFamily } from "../helpers";
import type { WebFontItem } from "../types";

export interface GoogleFontMeta {
  family: string;
  subsets: string[];
  fonts: Record<
    string,
    {
      thickness: number | null;
      slant: number | null;
      width: number | null;
      lineHeight: number | null;
    }
  >;
  axes: Array<{
    tag: string;
    min: number;
    max: number;
    defaultValue: number;
  }>;
}

const API_BASE = "https://fonts.google.com";

// Convert Google meta to WebFontItem
export function convertMeta(family: string, meta: GoogleFontMeta): WebFontItem {
  const variants = new Set<string>();
  const files: Record<string, string> = {};

  // Filter out "menu" from subsets
  const subsets = meta.subsets.filter((s) => s !== "menu");

  // Extract variants from fonts object keys
  // Keys are like "100", "200", "100italic", "400i", etc.
  for (const fontKey of Object.keys(meta.fonts)) {
    let variant = fontKey;

    // Convert "400" to "regular"
    if (fontKey === "400") {
      variant = "regular";
    }
    // Convert "400i" or "400italic" to "italic" or "400italic"
    else if (fontKey.endsWith("i") || fontKey.endsWith("italic")) {
      const weight = fontKey.replace(/i$/, "").replace("italic", "");
      if (weight === "400" || weight === "") {
        variant = "italic";
      } else {
        variant = `${weight}italic`;
      }
    }

    variants.add(variant);
  }

  // Sort variants - standard Google Fonts API order
  const sortedVariants = sortVariants(Array.from(variants));

  return {
    kind: "webfonts#webfont",
    family,
    category: categorizeFontFamily(family),
    variants: sortedVariants,
    subsets,
    files,
  };
}

// Get Google Fonts metadata
export async function getGoogleFontsMeta(): Promise<GoogleFontMeta[]> {
  const storage = useStorage("cache");
  const cacheKey = "fontmeta:google.json";
  const cached = await storage.getItem<GoogleFontMeta[]>(cacheKey);

  if (cached) {
    return cached;
  }

  // Fetch from Google Fonts API
  const response = await fetch(`${API_BASE}/metadata/fonts`);
  const text = await response.text();

  // Extract JSON from JSONP response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Invalid response from Google Fonts API");
  }

  const data = JSON.parse(jsonMatch[0]) as { familyMetadataList: GoogleFontMeta[] };

  // Cache for 1 hour
  await storage.setItem(cacheKey, data.familyMetadataList, { ttl: FONT_META_TTL });

  return data.familyMetadataList;
}

// Convert to WebFontItem format
export async function getGoogleWebFonts(filter?: string): Promise<WebFontItem[]> {
  const meta = await getGoogleFontsMeta();

  const filtered = filter
    ? meta.filter((font) => font.family.toLowerCase().includes(filter.toLowerCase()))
    : meta;

  return filtered.map((font) => convertMeta(font.family, font));
}
