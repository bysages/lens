import { useStorage } from "nitro/storage";

import { FONT_META_TTL } from "../../constants";
// Fontshare provider for WebFonts API
import { sortVariants, categorizeFontFamily } from "../helpers";
import type { WebFontItem } from "../types";

export interface FontshareFontMeta {
  slug: string;
  name: string;
  styles: Array<{
    default: boolean;
    file: string;
    id: string;
    is_italic: boolean;
    is_variable: boolean;
    weight: {
      label: string;
      number: number;
      weight: number;
    };
  }>;
}

const API_BASE = "https://api.fontshare.com/v2";

// Get Fontshare metadata
export async function getFontshareMeta(): Promise<FontshareFontMeta[]> {
  const storage = useStorage("cache");
  const cacheKey = "fontmeta:fontshare.json";
  const cached = await storage.getItem<FontshareFontMeta[]>(cacheKey);

  if (cached) {
    return cached;
  }

  const fonts: FontshareFontMeta[] = [];
  let offset = 0;
  let hasMore = true;

  // Fetch all fonts (paginated)
  while (hasMore) {
    const response = await fetch(`${API_BASE}/fonts?offset=${offset}&limit=100`);
    const data = (await response.json()) as {
      fonts: FontshareFontMeta[];
      has_more: boolean;
    };

    fonts.push(...data.fonts);
    hasMore = data.has_more;
    offset++;
  }

  console.log(`[Fontshare] Fetched ${fonts.length} fonts`);

  // Cache for 1 hour
  await storage.setItem(cacheKey, fonts, { ttl: FONT_META_TTL });

  return fonts;
}

// Convert to WebFontItem format
export async function getFontshareWebFonts(filter?: string): Promise<WebFontItem[]> {
  const meta = await getFontshareMeta();

  const filtered = filter
    ? meta.filter((font) => font.name.toLowerCase().includes(filter.toLowerCase()))
    : meta;

  return filtered.map((font) => {
    const variants = new Set<string>();
    const files: Record<string, string> = {};

    // Check if font has variable fonts
    const hasVariable = font.styles.some((s) => s.is_variable);
    const variableStyle = font.styles.find((s) => s.is_variable && !s.is_italic);
    const variableItalicStyle = font.styles.find((s) => s.is_variable && s.is_italic);

    // Generate variants from styles
    for (const style of font.styles) {
      // Skip variable fonts, they'll be handled separately
      if (style.is_variable) {
        continue;
      }

      const weight = style.weight.number;

      // Only accept standard weights (100, 200, 300, 400, 500, 600, 700, 800, 900)
      // or their italic variants (101, 201, 301, 401, 501, 601, 701, 801, 901)
      const isValidWeight =
        (weight >= 100 && weight <= 900 && weight % 100 === 0) ||
        (weight >= 101 && weight <= 901 && (weight - 1) % 100 === 0);

      if (!isValidWeight) {
        continue;
      }

      if (style.is_italic) {
        if (weight === 400 || weight === 401) {
          variants.add("italic");
        } else {
          // Map 101 -> 100italic, 201 -> 200italic, 301 -> 300italic, etc.
          const baseWeight = weight % 100 === 1 ? weight - 1 : weight;
          variants.add(`${baseWeight}italic`);
        }
      } else {
        if (weight === 400) {
          variants.add("regular");
        } else {
          variants.add(String(weight));
        }
      }
    }

    // If font has variable fonts, add standard variable variants
    if (hasVariable) {
      if (variableStyle) {
        // Add standard weights for variable font
        ["100", "200", "300", "400", "500", "600", "700", "800", "900"].forEach((w) => {
          if (w === "400") {
            variants.add("regular");
          } else {
            variants.add(w);
          }
        });
      }
      if (variableItalicStyle) {
        // Add italic weights for variable font
        ["100", "200", "300", "400", "500", "600", "700", "800", "900"].forEach((w) => {
          if (w === "400") {
            variants.add("italic");
          } else {
            variants.add(`${w}italic`);
          }
        });
      }
    }

    return {
      kind: "webfonts#webfont",
      family: font.name,
      category: categorizeFontFamily(font.name),
      variants: sortVariants(Array.from(variants)),
      subsets: ["latin"],
      files,
    };
  });
}
