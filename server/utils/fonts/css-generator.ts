// Font CSS generation utilities
import { cacheStorage } from "../storage";
import type { FontFaceData } from "./types";
import {
  parseGoogleFontsFamily,
  parseWeights,
  getUnifont,
  inferFormatFromUrl,
} from "./utils";
import { getCachedFontData, isFontAvailable } from "./cache";

// Generate CSS from font data with optional proxy rewriting
export function generateFontFaceCSS(
  fontData: FontFaceData,
  display: string,
  fontFamily: string,
  useProxy: boolean = false,
  baseUrl: string = "",
): string {
  if (!fontData.src?.length) return "";

  const fontSrc = fontData.src
    .filter((src) => "url" in src && src.url)
    .map((src) => {
      if ("url" in src) {
        let fontUrl = src.url;

        // Optionally rewrite URLs to use our proxy
        if (useProxy && baseUrl) {
          const url = new URL(fontUrl);
          let provider = "google"; // default
          let fontPath = "";

          // Detect provider from URL and extract clean path
          if (url.hostname.includes("fonts.gstatic.com")) {
            provider = "google";
            fontPath = url.pathname;
          } else if (url.hostname.includes("fonts.bunny.net")) {
            provider = "bunny";
            fontPath = url.pathname;
          } else if (
            url.hostname.includes("api.fontshare.com") ||
            url.hostname.includes("cdn.fontshare.com")
          ) {
            provider = "fontshare";
            fontPath = url.pathname;
          } else if (url.hostname.includes("cdn.jsdelivr.net")) {
            provider = "fontsource";
            fontPath = url.pathname;
          }

          // Create clean proxy URL without domain
          fontUrl = `${baseUrl}/fonts/${provider}${fontPath}`;
        }

        const format =
          ("format" in src && src.format) || inferFormatFromUrl(src.url);
        return `url('${fontUrl}') format('${format}')`;
      }
      return "";
    })
    .filter(Boolean)
    .join(", ");

  if (!fontSrc) return "";

  let css = `@font-face {
  font-family: '${fontFamily}';
  font-style: ${fontData.style || "normal"};
  font-weight: ${fontData.weight || 400};
  font-display: ${display};
  src: ${fontSrc};
`;

  if (fontData.unicodeRange?.length) {
    css += `  unicode-range: ${fontData.unicodeRange.join(", ")};
`;
  }

  css += `}

`;
  return css;
}

// Memory-efficient weight parsing with smart caching
export async function parseWeightsFromFont(
  fontName: string,
  weightSpec: string,
  unifont: any,
  provider: string = "google",
): Promise<string[]> {
  try {
    // Lightweight cache key (avoid btoa for performance)
    const fontHash = fontName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const specHash = weightSpec.replace(/[^0-9;.]/g, "");
    const weightCacheKey = `font-weights:${fontHash}:${specHash}`;

    const cachedWeights = await cacheStorage.metadata.get(weightCacheKey);
    if (cachedWeights && Array.isArray(cachedWeights)) {
      return cachedWeights;
    }

    // Use unified font data caching strategy
    const fontData = await getCachedFontData(provider, fontName, unifont);
    if (!fontData?.fonts?.length) {
      // Fallback to basic parsing if font not found
      return parseWeights(weightSpec);
    }

    // Extract available weights from font data
    const availableWeights = new Set<string>();
    for (const font of fontData.fonts) {
      if (font.weight) {
        const weight = String(font.weight);
        availableWeights.add(weight);
      }
    }

    const availableWeightNumbers = Array.from(availableWeights)
      .map((w) => parseInt(w))
      .filter((w) => !isNaN(w))
      .sort((a, b) => a - b);

    // Filter based on the weight specification
    let result: string[];
    if (weightSpec.includes("..")) {
      const [start, end] = weightSpec.split("..").map(Number);
      result = availableWeightNumbers
        .filter((weight) => weight >= start && weight <= end)
        .map((w) => w.toString());
    } else {
      // Handle individual weights
      const requestedWeights = weightSpec.split(";");
      result = requestedWeights.filter((weight) =>
        availableWeightNumbers.includes(parseInt(weight)),
      );
    }

    // Cache the result for 24 hours
    await cacheStorage.metadata.set(weightCacheKey, result);

    return result;
  } catch {
    // Failed to get font data, using fallback parsing
    return parseWeights(weightSpec);
  }
}

// Generate CSS for multiple fonts with smart weight resolution and optional proxy
export async function generateCSS(
  family: string,
  display: string,
  subset: string,
  provider: string,
  providerConfig?: unknown,
  useProxy: boolean = false,
  baseUrl: string = "",
): Promise<string> {
  const fonts = parseGoogleFontsFamily(family);
  let css = "";

  for (const font of fonts) {
    // Pre-check if font is available in cached list
    const unifont = await getUnifont(provider, providerConfig);
    const isAvailable = await isFontAvailable(
      font.name,
      provider,
      providerConfig,
      unifont,
    );

    if (!isAvailable) {
      continue;
    }

    try {
      // Use smart weight parsing based on actual font data
      let resolvedWeights = font.weights;

      // If weights contain ranges, resolve them based on actual font data
      const hasRanges = font.weights.some((w) => w.includes(".."));
      if (hasRanges) {
        const allResolvedWeights: string[] = [];
        for (const weight of font.weights) {
          if (weight.includes("..")) {
            const smartWeights = await parseWeightsFromFont(
              font.name,
              weight,
              unifont,
              provider,
            );
            allResolvedWeights.push(...smartWeights);
          } else {
            allResolvedWeights.push(weight);
          }
        }
        resolvedWeights = [...new Set(allResolvedWeights)];
      }

      const resolveOptions = {
        weights: resolvedWeights,
        styles: font.styles,
        subsets: [subset],
      };

      // Use unified caching strategy
      let fontData = await getCachedFontData(
        provider,
        font.name,
        unifont,
        resolveOptions,
      );

      if (!fontData?.fonts?.length) {
        console.warn(
          `No font variants found for: ${font.name} with options:`,
          resolveOptions,
        );

        // Try without options as fallback
        console.log(`Trying ${font.name} without specific options...`);
        const fallbackData = await getCachedFontData(
          provider,
          font.name,
          unifont,
        );

        if (!fallbackData?.fonts?.length) {
          console.warn(
            `Font completely unavailable: ${font.name} (provider: ${provider})`,
          );
          continue;
        }

        console.log(
          `Fallback successful for ${font.name}, using default variants`,
        );

        // Generate CSS for fallback data
        for (const fontFace of fallbackData.fonts) {
          css += generateFontFaceCSS(
            fontFace,
            display,
            font.name,
            useProxy,
            baseUrl,
          );
        }
        continue;
      }

      console.log(`Successfully resolved ${font.name}:`, {
        variantsCount: fontData.fonts.length,
        provider: fontData.provider,
        useProxy,
      });

      // Generate CSS for each font face
      for (const fontFace of fontData.fonts) {
        css += generateFontFaceCSS(
          fontFace,
          display,
          font.name,
          useProxy,
          baseUrl,
        );
      }
    } catch (error) {
      console.error(`Failed to resolve font: ${font.name}`, {
        error: error instanceof Error ? error.message : error,
        provider,
        fontWeights: font.weights,
      });
    }
  }

  return css;
}
