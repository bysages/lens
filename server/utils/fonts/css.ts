import { parseGoogleFontsFamily } from "./parse";
import { getFontshareMeta } from "./providers/fontshare";
// Font CSS generation utilities
// Compatible with Google Fonts API
import type { FontStyle, FontWeight } from "./types";

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

        // Find matching style (prefer non-variable fonts)
        const matchingStyle = fontMeta.styles.find((s) => {
          const weightMatch =
            s.weight.number === targetWeight ||
            s.weight.number === (targetItalic ? targetWeight + 1 : targetWeight);
          const italicMatch = s.is_italic === targetItalic;
          return weightMatch && italicMatch && !s.is_variable;
        });

        if (!matchingStyle?.file) {
          console.warn(`Fontshare: no matching style for ${family} ${variant}`);
          return null;
        }

        // Fontshare returns protocol-relative URL
        // Prefer woff2 over woff over ttf (browser support order)
        // All formats are available from Fontshare CDN
        return `https:${matchingStyle.file}.woff2`;
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

/**
 * Generate @font-face CSS for a single font file
 * Follows CSS Fonts Module Level 4 specification
 */
export function generateFontFaceCSS(
  fontUrl: string,
  fontStyle: FontStyle,
  fontWeight: FontWeight,
  display: string,
  fontFamily: string,
  proxy: boolean = false,
  baseUrl: string = "",
): string {
  let fontSrcUrl = fontUrl;

  // Optionally rewrite URLs to use our proxy
  if (proxy && baseUrl) {
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

    fontSrcUrl = `${baseUrl}/fonts/${provider}${fontPath}`;
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
  font-family: '${fontFamily}';
  font-style: ${fontStyle};
  font-weight: ${fontWeight};
  font-display: ${display};
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
  baseUrl?: string;
  userAgent?: string | null;
  useV2API?: boolean;
}): Promise<string> {
  const {
    family,
    display = "swap",
    subset = "latin",
    baseUrl = "",
    userAgent = null,
    useV2API = true,
  } = options;

  // Construct Google Fonts API URL
  // v1 API: /css (supports pipe separator for multiple fonts)
  // v2 API: /css2 (supports repeated family parameter)
  const apiVersion = useV2API ? "css2" : "css";
  let googleApiUrl = `https://fonts.googleapis.com/${apiVersion}?family=${family}&display=${display}`;

  // Add subset parameter if not default latin
  if (subset && subset !== "latin") {
    googleApiUrl += `&subset=${subset}`;
  }

  // Prepare headers - pass through User-Agent to get appropriate format
  const headers: HeadersInit = {};
  if (userAgent) {
    headers["User-Agent"] = userAgent;
  }

  // Fetch CSS from Google Fonts
  const response = await fetch(googleApiUrl, { headers });

  if (!response.ok) {
    throw new Error(`Google Fonts API returned ${response.status}`);
  }

  let css = await response.text();

  // Replace fonts.gstatic.com URLs with our proxy (only if baseUrl is provided)
  if (baseUrl) {
    css = css.replace(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g, (match, url) => {
      const urlObj = new URL(url);
      const proxyPath = urlObj.pathname;
      return `url('${baseUrl}/fonts/google${proxyPath}')`;
    });
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
  baseUrl?: string;
  userAgent?: string | null;
  useV2API?: boolean;
}): Promise<string> {
  const {
    family,
    display = "swap",
    subset = "latin",
    provider = "google",
    proxy = false,
    baseUrl = "",
    userAgent = null,
    useV2API = true,
  } = options;

  // For Google provider, fetch from Google Fonts API
  if (provider === "google" || provider === "googleicons") {
    return fetchGoogleFontsCSS({
      family,
      display,
      subset,
      baseUrl,
      userAgent,
      useV2API,
    });
  }

  // For other providers, generate CSS ourselves
  const fonts = parseGoogleFontsFamily(family);

  // Prepare all font URLs to fetch in parallel
  const fontConfigs: Array<{
    name: string;
    weight: FontWeight;
    style: FontStyle;
    variant: string;
  }> = [];

  for (const font of fonts) {
    for (const weight of font.weights) {
      for (const style of font.styles) {
        // Convert weight and style to Google Fonts variant format
        let variant: string;
        if (style === "italic") {
          variant = weight === "400" ? "italic" : `${weight}italic`;
        } else {
          variant = weight === "400" ? "regular" : weight;
        }

        fontConfigs.push({ name: font.name, weight, style, variant });
      }
    }
  }

  // Fetch all font URLs in parallel
  const fontUrls = await Promise.all(
    fontConfigs.map((config) =>
      getFontFileUrl(provider, config.name, config.variant, subset).then((url) => ({
        ...config,
        url,
      })),
    ),
  );

  // Generate CSS from fetched URLs
  let css = "";
  for (const fontConfig of fontUrls) {
    if (!fontConfig.url) {
      console.warn(
        `Could not generate URL for ${fontConfig.name} ${fontConfig.variant} (provider: ${provider})`,
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
      baseUrl,
    );
  }

  return css;
}
