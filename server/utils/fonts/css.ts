import { HTTPError } from "nitro/h3";

import { parseGoogleFontsFamily } from "./parse";
import { getFontshareMeta } from "./providers/fontshare";
// Font CSS generation utilities
// Compatible with Google Fonts API
import type { FontStyle, FontWeight, FontWeightRange } from "./types";

function normalizeFontshareFileUrl(file: string): string {
  return file.startsWith("//") ? `https:${file}.woff2` : file;
}

/**
 * Get variable font file URL for a weight range from a provider
 * Only providers with an explicit variable-font source are supported.
 */
export async function getVariableFontFileUrl(
  provider: string,
  family: string,
  weightRange: FontWeightRange,
  style: FontStyle,
): Promise<string | null> {
  if (provider !== "fontshare") {
    return null;
  }

  const targetItalic = style === "italic";
  const metadata = await getFontshareMeta();
  const fontMeta = metadata.find((f) => f.name.toLowerCase() === family.toLowerCase());
  const matchingStyle = fontMeta?.styles.find((s) => s.is_variable && s.is_italic === targetItalic);

  return matchingStyle?.file ? normalizeFontshareFileUrl(matchingStyle.file) : null;
}

/**
 * Get font file URL for a specific variant from a provider
 * Each provider has its own URL structure
 */
export async function getFontFileUrl(
  provider: string,
  family: string,
  variant: string,
  subset: string = "latin",
): Promise<string | null> {
  const normalizedName = family.replace(/\s+/g, "").toLowerCase();

  switch (provider) {
    case "google":
    case "googleicons": {
      // Google Fonts URLs are complex - we'll fetch from Google Fonts API instead
      return null;
    }
    case "bunny": {
      // Bunny pattern: https://fonts.bunny.net/{slug}/files/{slug}-{subset}-{weight}-{style}.woff2
      // style should be 'normal' or 'italic', not 'n' or 'i'
      const weight =
        variant === "regular" || variant === "italic" ? "400" : variant.replace("italic", "");
      const style = variant.includes("italic") ? "italic" : "normal";
      const slug = family.replace(/\s+/g, "-").toLowerCase();
      const resolvedSubset = subset || "latin";
      return `https://fonts.bunny.net/${slug}/files/${slug}-${resolvedSubset}-${weight}-${style}.woff2`;
    }
    case "fontshare": {
      // Fontshare requires fetching metadata to get actual file URLs
      try {
        const metadata = await getFontshareMeta();
        const fontMeta = metadata.find((f) => f.name.toLowerCase() === family.toLowerCase());

        if (!fontMeta?.styles) {
          console.warn(`Fontshare: font not found or has no styles: ${family}`);
          return null;
        }

        // Parse variant to get weight and style
        let targetWeight = 400;
        let targetItalic = false;

        if (variant === "regular") {
          targetWeight = 400;
          targetItalic = false;
        } else if (variant === "italic") {
          targetWeight = 400;
          targetItalic = true;
        } else if (variant.endsWith("italic")) {
          targetWeight = Number.parseInt(variant.replace("italic", ""), 10);
          targetItalic = true;
        } else {
          targetWeight = Number.parseInt(variant, 10);
          targetItalic = false;
        }

        // Fontshare uses 401-style numbers for italic styles; weight.weight is
        // the semantic CSS weight.
        const matchingStyle =
          fontMeta.styles.find(
            (s) =>
              !s.is_variable && s.weight.weight === targetWeight && s.is_italic === targetItalic,
          ) ?? fontMeta.styles.find((s) => s.is_variable && s.is_italic === targetItalic);

        if (!matchingStyle?.file) {
          console.warn(`Fontshare: no matching style for ${family} ${variant}`);
          return null;
        }

        return normalizeFontshareFileUrl(matchingStyle.file);
      } catch (error) {
        console.error(`Fontshare: failed to get metadata for ${family}:`, error);
        return null;
      }
    }
    case "fontsource": {
      // Fontsource pattern: https://cdn.jsdelivr.net/npm/@fontsource/{name}/files/{name}-{subset}-{weight}-{style}.woff2
      const weight =
        variant === "regular" || variant === "italic" ? "400" : variant.replace("italic", "");
      const style = variant.includes("italic") ? "italic" : "normal";
      const resolvedSubset = subset || "latin";
      return `https://cdn.jsdelivr.net/npm/@fontsource/${normalizedName}/files/${normalizedName}-${resolvedSubset}-${weight}-${style}.woff2`;
    }
    default:
      return null;
  }
}

/** Font-display values accepted by the CSS spec; anything else would be an injection vector. */
const FONT_DISPLAY_VALUES = new Set(["auto", "block", "swap", "fallback", "optional"]);

/**
 * Strip characters that would terminate the font-family string or break out
 * of the @font-face rule — family names flow in from query parameters.
 */
function sanitizeCssFamily(value: string): string {
  return value.replace(/['"\\{};]/g, "").trim();
}

function safeDisplay(value: string): string {
  return FONT_DISPLAY_VALUES.has(value) ? value : "swap";
}

function safeWeight(value: FontWeight | FontWeightRange): string {
  if (typeof value !== "string") {
    return `${value.min} ${value.max}`;
  }
  return /^\d{1,3}$/.test(value) ? value : "400";
}

const STANDARD_WEIGHTS: FontWeight[] = [
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
];

function expandWeightRange(weightRange: FontWeightRange): FontWeight[] {
  return STANDARD_WEIGHTS.filter(
    (weight) => Number(weight) >= weightRange.min && Number(weight) <= weightRange.max,
  );
}

/**
 * Generate @font-face CSS for a single font file
 * Follows CSS Fonts Module Level 4 specification
 */
export function generateFontFaceCSS(
  fontUrl: string,
  fontStyle: FontStyle,
  fontWeight: FontWeight | FontWeightRange,
  display: string,
  fontFamily: string,
  proxy: boolean = false,
): string {
  let fontSrcUrl = fontUrl;

  // Relative proxy URLs inherit the CSS document's origin and scheme. This
  // avoids mixed-content failures when an HTTPS reverse proxy terminates TLS.
  if (proxy) {
    const url = new URL(fontUrl);
    let provider = "google";
    let fontPath = url.pathname;

    // Detect provider from URL
    if (url.hostname.includes("fonts.gstatic.com")) {
      provider = "google";
    } else if (url.hostname.includes("fonts.bunny.net")) {
      provider = "bunny";
    } else if (url.hostname.includes("cdn.fontshare.com")) {
      provider = "fontshare";
    } else if (url.hostname.includes("cdn.jsdelivr.net")) {
      provider = "fontsource";
    }

    fontSrcUrl = `/fonts/${provider}${fontPath}`;
  }

  // Infer format from URL extension
  // More accurate detection of font formats
  let format = "truetype"; // default fallback

  if (fontUrl.includes(".woff2")) {
    format = "woff2";
  } else if (fontUrl.includes(".woff")) {
    format = "woff";
  } else if (fontUrl.includes(".ttf")) {
    format = "truetype";
  } else if (fontUrl.includes(".otf")) {
    format = "opentype";
  } else if (fontUrl.includes(".eot")) {
    format = "embedded-opentype";
  } else if (fontUrl.includes(".svg")) {
    format = "svg";
  }

  return `@font-face {
  font-family: '${sanitizeCssFamily(fontFamily)}';
  font-style: ${fontStyle === "italic" ? "italic" : "normal"};
  font-weight: ${safeWeight(fontWeight)};
  font-display: ${safeDisplay(display)};
  src: url('${fontSrcUrl}') format('${format}');
}

`;
}

/**
 * Fetch CSS from Google Fonts API and replace URLs with proxy
 */
export async function fetchGoogleFontsCSS(options: {
  family: string;
  display?: string;
  subset?: string;
  userAgent?: string | null;
  useV2API?: boolean;
  proxy?: boolean;
}): Promise<string> {
  const {
    family,
    display = "swap",
    subset = "latin",
    userAgent = null,
    useV2API = true,
    proxy = false,
  } = options;

  // Construct Google Fonts API URL
  // v1 API: /css (supports pipe separator for multiple fonts)
  // v2 API: /css2 (supports repeated family parameter)
  const apiVersion = useV2API ? "css2" : "css";
  let googleApiUrl = `https://fonts.googleapis.com/${apiVersion}?family=${encodeURIComponent(family)}&display=${encodeURIComponent(safeDisplay(display))}`;

  // Add subset parameter if not default latin
  if (subset && subset !== "latin") {
    googleApiUrl += `&subset=${encodeURIComponent(subset)}`;
  }

  // Prepare headers - pass through User-Agent to get appropriate format
  const headers: HeadersInit = {};
  if (userAgent) {
    headers["User-Agent"] = userAgent;
  }

  // Fetch CSS from Google Fonts
  const response = await fetch(googleApiUrl, { headers });

  if (!response.ok) {
    throw new HTTPError({
      status: 502,
      message: `Google Fonts API returned ${response.status}`,
    });
  }

  let css = await response.text();

  // Replace fonts.gstatic.com URLs with same-origin relative proxy URLs.
  // Relative URLs preserve the HTTPS scheme behind a TLS reverse proxy.
  if (proxy) {
    css = css.replace(
      /url\((['"]?)(https:\/\/fonts\.gstatic\.com\/[^)'"]+)\1\)/g,
      (_match, _quote, url: string) => {
        const urlObj = new URL(url);
        return `url('/fonts/google${urlObj.pathname}${urlObj.search}')`;
      },
    );
  }

  return css;
}

/**
 * Generate CSS for multiple fonts (Google Fonts API compatible)
 * This parses the family parameter and generates @font-face rules
 */
export async function generateFontCSS(options: {
  family: string;
  display?: string;
  subset?: string;
  provider?: string;
  proxy?: boolean;
  userAgent?: string | null;
  useV2API?: boolean;
}): Promise<string> {
  const {
    family,
    display = "swap",
    subset = "latin",
    provider = "google",
    proxy = false,
    userAgent = null,
    useV2API = true,
  } = options;

  // For Google provider, fetch from Google Fonts API
  if (provider === "google" || provider === "googleicons") {
    return fetchGoogleFontsCSS({
      family,
      display,
      subset,
      userAgent,
      useV2API,
      proxy,
    });
  }

  // For other providers, generate CSS ourselves
  const fonts = parseGoogleFontsFamily(family);

  // Resolve static variants and variable ranges in parallel
  type FontUrlConfig = {
    label: string;
    name: string;
    style: FontStyle;
    url: string | null;
    weight: FontWeight | FontWeightRange;
  };
  const fontUrlPromises: Array<Promise<FontUrlConfig | FontUrlConfig[]>> = [];

  for (const font of fonts) {
    for (const weight of font.weights) {
      for (const style of font.styles) {
        const variant =
          style === "italic"
            ? weight === "400"
              ? "italic"
              : `${weight}italic`
            : weight === "400"
              ? "regular"
              : weight;

        fontUrlPromises.push(
          getFontFileUrl(provider, font.name, variant, subset).then((url) => ({
            label: variant,
            name: font.name,
            style,
            url,
            weight,
          })),
        );
      }
    }

    for (const weightRange of font.weightRanges) {
      for (const style of weightRange.styles) {
        const label = `${weightRange.min}..${weightRange.max}`;

        if (provider === "fontshare") {
          fontUrlPromises.push(
            getVariableFontFileUrl(provider, font.name, weightRange, style).then((url) => ({
              label,
              name: font.name,
              style,
              url,
              weight: weightRange,
            })),
          );
          continue;
        }

        // Providers without an explicit variable source keep their existing
        // static-weight behavior.
        for (const weight of expandWeightRange(weightRange)) {
          const variant = weight === "400" ? "regular" : weight;
          fontUrlPromises.push(
            getFontFileUrl(provider, font.name, variant, subset).then((url) => ({
              label: `${label} ${variant}`,
              name: font.name,
              style,
              url,
              weight,
            })),
          );
        }
      }
    }
  }

  const fontUrls = (await Promise.all(fontUrlPromises)).flat();

  // Generate CSS from fetched URLs
  let css = "";
  for (const fontConfig of fontUrls) {
    if (!fontConfig.url) {
      console.warn(
        `Could not generate URL for ${fontConfig.name} ${fontConfig.label} (provider: ${provider})`,
      );
      continue;
    }

    css += generateFontFaceCSS(
      fontConfig.url,
      fontConfig.style,
      fontConfig.weight,
      display,
      fontConfig.name,
      proxy,
    );
  }

  return css;
}
