// WebFonts API utilities - Google Fonts Developer API compatible
import type { WebFontItem } from "./types";
import { getCachedFontData, getCachedFontsList } from "./cache";
import { getUnifont } from "./utils";
import { detectSubsetsInRange, detectSubsetForCodepoint } from "./subsets";

// Extract font metadata for webfonts API
export async function extractFontMetadata(
  fontName: string,
  provider: string,
  unifont: any,
): Promise<WebFontItem | null> {
  try {
    const fontData = await getCachedFontData(provider, fontName, unifont);
    if (!fontData?.fonts?.length) return null;

    // Extract variants and weights with proper types
    const variants = new Set<string>();
    const files: Record<string, string> = {};
    const subsets = new Set<string>();
    let extractedVersion = "";
    let menuUrl = "";

    for (const font of fontData.fonts) {
      let variant = "regular";

      if (font.style === "italic") {
        variant =
          font.weight && font.weight !== "400" && font.weight !== 400
            ? `${font.weight}italic`
            : "italic";
      } else if (font.weight && font.weight !== "400" && font.weight !== 400) {
        variant = String(font.weight);
      }

      variants.add(variant);

      // Extract font file URL and version
      const fontSrc = font.src?.find((src: any) => "url" in src && src.url);
      if (fontSrc && "url" in fontSrc) {
        files[variant] = fontSrc.url;

        // Extract version from URL (e.g., /v30/ in Google Fonts URLs)
        if (!extractedVersion) {
          const versionMatch = fontSrc.url.match(/\/v(\d+)\//);
          if (versionMatch) {
            extractedVersion = `v${versionMatch[1]}`;
          }
        }

        // Use first regular font URL as menu URL
        if (variant === "regular" && !menuUrl) {
          menuUrl = fontSrc.url;
        }
      }

      // Extract subsets from Unicode ranges (optimized parsing)
      if (font.unicodeRange?.length) {
        subsets.clear(); // Clear previous subsets to rebuild accurately

        for (const range of font.unicodeRange) {
          // Pre-compile regex for better performance
          const cleanRange = range.replace(/[U+\s]/g, "");

          if (cleanRange.includes("-")) {
            const hyphenIndex = cleanRange.indexOf("-");
            const startHex = cleanRange.slice(0, hyphenIndex);
            const endHex = cleanRange.slice(hyphenIndex + 1);
            const startCode = parseInt(startHex, 16);
            const endCode = parseInt(endHex, 16);

            // Skip invalid ranges
            if (!isNaN(startCode) && !isNaN(endCode) && startCode <= endCode) {
              detectSubsetsInRange(startCode, endCode, subsets);
            }
          } else {
            // Single codepoint
            const codepoint = parseInt(cleanRange, 16);
            if (!isNaN(codepoint)) {
              detectSubsetForCodepoint(codepoint, subsets);
            }
          }
        }
      }
    }

    // Fallback to latin if no subsets detected
    if (subsets.size === 0) {
      subsets.add("latin");
    }

    // Categorize font
    const fontCategory = categorizeFontFamily(fontName);

    const fontItem: WebFontItem = {
      kind: "webfonts#webfont" as const,
      family: fontName,
      category: fontCategory,
      variants: Array.from(variants).sort(),
      subsets: Array.from(subsets).sort(),
      files,
    };

    // Only include optional fields if they have valid values
    if (extractedVersion) {
      fontItem.version = extractedVersion;
    }

    const finalMenuUrl = menuUrl || files.regular || Object.values(files)[0];
    if (finalMenuUrl) {
      fontItem.menu = finalMenuUrl;
    }

    return fontItem;
  } catch {
    return null;
  }
}

// Categorize font family by name (optimized pattern matching)
export function categorizeFontFamily(fontName: string): string {
  const fontNameLower = fontName.toLowerCase();

  // Pre-compiled patterns for better performance
  if (
    fontNameLower.indexOf("serif") !== -1 &&
    fontNameLower.indexOf("sans") === -1
  ) {
    return "serif";
  }

  if (
    fontNameLower.indexOf("mono") !== -1 ||
    fontNameLower.indexOf("code") !== -1
  ) {
    return "monospace";
  }

  if (
    fontNameLower.indexOf("display") !== -1 ||
    fontNameLower.indexOf("decorative") !== -1
  ) {
    return "display";
  }

  if (
    fontNameLower.indexOf("script") !== -1 ||
    fontNameLower.indexOf("handwriting") !== -1
  ) {
    return "handwriting";
  }

  return "sans-serif";
}

// Apply sorting to font items
export function sortFontItems(items: WebFontItem[], sort: string): void {
  switch (sort) {
    case "alpha":
      items.sort((a, b) => a.family.localeCompare(b.family));
      break;
    case "popularity":
      // Simplified popularity - in reality you'd have usage statistics
      items.sort((a, b) => b.variants.length - a.variants.length);
      break;
    case "style":
      items.sort((a, b) => b.variants.length - a.variants.length);
      break;
    case "trending":
      // Simplified trending - in reality you'd have trend data
      items.sort((a, b) => a.family.localeCompare(b.family));
      break;
    case "date":
      // Keep original order as "recent"
      break;
    default:
      // No sorting
      break;
  }
}

// Apply filters to font list
export function filterFontsList(
  fontsList: string[],
  filters: {
    family?: string;
  },
): string[] {
  let filteredList = fontsList;

  // Apply family filter
  if (filters.family) {
    filteredList = filteredList.filter((fontName) =>
      fontName.toLowerCase().includes(filters.family!.toLowerCase()),
    );
  }

  return filteredList;
}

// Apply filters to font items
export function filterFontItems(
  items: WebFontItem[],
  filters: {
    subset?: string;
    category?: string;
  },
): WebFontItem[] {
  let filteredItems = items;

  // Apply subset filter
  if (filters.subset) {
    filteredItems = filteredItems.filter((item) =>
      item.subsets.some((s) => s.includes(filters.subset!)),
    );
  }

  // Apply category filter
  if (filters.category) {
    filteredItems = filteredItems.filter(
      (item) => item.category === filters.category,
    );
  }

  return filteredItems;
}

// Process fonts list for webfonts API
export async function processFontsForWebfontsAPI(
  provider: string,
  providerConfig: unknown,
  filters: {
    family?: string;
    subset?: string;
    category?: string;
  },
  sort: string,
): Promise<WebFontItem[]> {
  const unifont = await getUnifont(provider, providerConfig);
  const fontsList = await getCachedFontsList(provider, providerConfig, unifont);

  if (!fontsList.length) {
    return [];
  }

  // Apply family filter early
  const filteredFontsList = filterFontsList(fontsList, {
    family: filters.family,
  });

  // Dynamic batch processing with optimal sizing
  const totalFonts = filteredFontsList.length;
  const optimalBatchSize =
    totalFonts < 50
      ? Math.min(totalFonts, 15) // Small lists: larger batches
      : Math.min(Math.max(Math.floor(totalFonts / 8), 8), 12); // Large lists: smaller batches

  const items: WebFontItem[] = [];
  const processingPromises: Promise<WebFontItem | null>[] = [];

  // Queue all processing tasks at once for better parallelization
  for (let i = 0; i < totalFonts; i += optimalBatchSize) {
    const batch = filteredFontsList.slice(i, i + optimalBatchSize);

    const batchPromise = Promise.all(
      batch.map((fontName) => extractFontMetadata(fontName, provider, unifont)),
    ).then((results) => results.filter(Boolean)); // Filter out null results

    processingPromises.push(batchPromise as any);
  }

  // Process all batches in parallel and flatten results
  const batchResults = await Promise.allSettled(processingPromises);

  for (const result of batchResults) {
    if (result.status === "fulfilled" && Array.isArray(result.value)) {
      items.push(...result.value);
    }
  }

  // Apply remaining filters
  const filteredItems = filterFontItems(items, {
    subset: filters.subset,
    category: filters.category,
  });

  // Apply sorting
  sortFontItems(filteredItems, sort);

  return filteredItems;
}
