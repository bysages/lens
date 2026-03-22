/**
 * Google Fonts variant sorting order
 * Used for consistent API compatibility across providers
 */
export const VARIANT_SORT_ORDER = [
  "regular",
  "italic",
  "100",
  "100italic",
  "200",
  "200italic",
  "300",
  "300italic",
  "500",
  "500italic",
  "600",
  "600italic",
  "700",
  "700italic",
  "800",
  "800italic",
  "900",
  "900italic",
] as const;

/**
 * Sort variants according to Google Fonts API standard order
 */
export function sortVariants(variants: string[]): string[] {
  return variants.sort((a, b) => {
    const aIndex = VARIANT_SORT_ORDER.indexOf(a as (typeof VARIANT_SORT_ORDER)[number]);
    const bIndex = VARIANT_SORT_ORDER.indexOf(b as (typeof VARIANT_SORT_ORDER)[number]);

    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return a.localeCompare(b);
  });
}

/**
 * Detect font format from URL extension
 */
export function detectFontFormat(url: string): string {
  if (url.includes(".woff2")) return "woff2";
  if (url.includes(".woff")) return "woff";
  if (url.includes(".ttf")) return "truetype";
  if (url.includes(".otf")) return "opentype";
  return "woff2";
}

/**
 * Categorize font family by name patterns
 * Shared utility for font providers
 */
export function categorizeFontFamily(fontName: string): string {
  const fontNameLower = fontName.toLowerCase();

  if (fontNameLower.indexOf("serif") !== -1 && fontNameLower.indexOf("sans") === -1) {
    return "serif";
  }

  if (fontNameLower.indexOf("mono") !== -1 || fontNameLower.indexOf("code") !== -1) {
    return "monospace";
  }

  if (fontNameLower.indexOf("display") !== -1 || fontNameLower.indexOf("decorative") !== -1) {
    return "display";
  }

  if (fontNameLower.indexOf("script") !== -1 || fontNameLower.indexOf("handwriting") !== -1) {
    return "handwriting";
  }

  return "sans-serif";
}
