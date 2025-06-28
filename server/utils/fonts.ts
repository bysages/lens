// Fonts service plugin - Google Fonts API compatible
//
// Features:
// 1. Google Fonts CSS API v1/v2 compatible endpoints (/css, /css2)
// 2. Smart weight range parsing (200..800 → actual available weights)
// 3. Multi-layer caching (font list cache + individual font cache)
// 4. Font file proxy with streaming and caching (/fonts/{provider}/{fontpath})
// 5. Google Fonts Developer API compatible metadata endpoint (/webfonts)
//
// Usage Examples:
//
// Basic CSS generation:
// GET /css?family=Roboto:wght@200..800&display=swap
// GET /css2?family=Roboto:wght@200..800&display=swap&subset=latin
//
// With font file proxy (cached through our server):
// GET /css?family=Roboto:wght@200..800&display=swap&useProxy=true
//
// Font metadata (Google Fonts Developer API compatible):
// GET /webfonts?sort=popularity&family=Roboto
// GET /webfonts?category=sans-serif&sort=alpha
//
// Direct font file proxy:
// GET /fonts/google/https%3A//fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxK.woff2
//
// Supported providers: google, bunny, fontshare, fontsource, adobe
//
import { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import {
  createUnifont,
  providers,
  type Unifont,
  type FontFaceData,
  type ResolveFontOptions,
  type FontStyles,
  type Provider,
} from "unifont";
import { cacheStorage } from "./storage";
import { pluginRateLimits } from "./rate-limits";

// Cache unifont instances
const unifontInstances = new Map<string, Unifont>();

// Cache available fonts list
let cachedFontsList: string[] | null = null;
let fontsListCacheTime: number = 0;
const FONTS_LIST_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Define proper types using unifont definitions
interface WebFontItem {
  kind: "webfonts#webfont";
  family: string;
  category: string;
  variants: string[];
  subsets: string[];
  version: string;
  lastModified: string;
  files: Record<string, string>;
  menu: string;
}

interface WebFontsResponse {
  kind: "webfonts#webfontList";
  items: WebFontItem[];
}

// Get unifont instance for provider with optional configuration
async function getUnifont(
  provider: string,
  config?: unknown,
): Promise<Unifont> {
  const cacheKey = config ? `${provider}:${JSON.stringify(config)}` : provider;

  if (!unifontInstances.has(cacheKey)) {
    let providerInstance: Provider;

    // Create provider instance using unifont's built-in types
    switch (provider) {
      case "adobe":
        if (!config) {
          throw new Error(
            "Adobe provider requires configuration with 'id' parameter",
          );
        }
        // Use unifont's ProviderOption$2 type for adobe
        providerInstance = providers.adobe(
          config as Parameters<typeof providers.adobe>[0],
        );
        break;
      case "google":
        // Use unifont's ProviderOption$1 type for google
        providerInstance = config
          ? providers.google(config as Parameters<typeof providers.google>[0])
          : providers.google();
        break;
      case "googleicons":
        // Use unifont's ProviderOption type for googleicons
        providerInstance = config
          ? providers.googleicons(
              config as Parameters<typeof providers.googleicons>[0],
            )
          : providers.googleicons();
        break;
      case "bunny":
        providerInstance = providers.bunny();
        break;
      case "fontshare":
        providerInstance = providers.fontshare();
        break;
      case "fontsource":
        providerInstance = providers.fontsource();
        break;
      default:
        // Default to google if provider not recognized
        providerInstance = providers.google();
      // Unknown provider, fallback to google
    }

    // Create unifont with cache storage
    const instance = await createUnifont([providerInstance], {
      storage: {
        async getItem(key: string) {
          return await cacheStorage.metadata.get(`unifont:${key}`);
        },
        async setItem(key: string, value) {
          await cacheStorage.metadata.set(`unifont:${key}`, value);
        },
      },
    });

    unifontInstances.set(cacheKey, instance);
  }

  return unifontInstances.get(cacheKey)!;
}

// Get cached fonts list with automatic refresh
async function getCachedFontsList(
  provider: string,
  config?: unknown,
): Promise<string[]> {
  const now = Date.now();
  const cacheKey = `fonts-list:${provider}:${config ? JSON.stringify(config) : ""}`;

  // Check memory cache first
  if (cachedFontsList && now - fontsListCacheTime < FONTS_LIST_CACHE_DURATION) {
    return cachedFontsList;
  }

  // Check persistent cache
  const cached = await cacheStorage.metadata.get(cacheKey);
  if (cached && Array.isArray(cached)) {
    cachedFontsList = cached;
    fontsListCacheTime = now;
    return cachedFontsList;
  }

  // Fetch fresh list
  try {
    const unifont = await getUnifont(provider, config);
    const fontsList = await unifont.listFonts();

    if (fontsList && fontsList.length > 0) {
      cachedFontsList = fontsList;
      fontsListCacheTime = now;

      // Cache for 24 hours
      await cacheStorage.metadata.set(cacheKey, fontsList);

      // Refreshed fonts list cache
      return fontsList;
    }
  } catch (error) {
    console.error(
      `Failed to fetch fonts list for provider ${provider}:`,
      error,
    );
  }

  return [];
}

// Check if font exists in cached list
async function isFontAvailable(
  fontName: string,
  provider: string,
  config?: unknown,
): Promise<boolean> {
  const fontsList = await getCachedFontsList(provider, config);
  return fontsList.some(
    (font) =>
      font.toLowerCase() === fontName.toLowerCase() ||
      font.toLowerCase().replace(/\s+/g, "") ===
        fontName.toLowerCase().replace(/\s+/g, ""),
  );
}

// Parse provider configuration with proper types
function parseProviderConfig(
  query: Record<string, unknown>,
):
  | Parameters<typeof providers.adobe>[0]
  | Parameters<typeof providers.google>[0]
  | undefined {
  const config: Record<string, unknown> = {};

  // Adobe provider options
  if (query.id) {
    config.id = String(query.id);
  }

  // Google provider experimental options
  if (query.experimental) {
    try {
      config.experimental = JSON.parse(String(query.experimental));
    } catch {
      // Failed to parse experimental options
    }
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

// Generate CSS from font data with optional proxy rewriting
function generateFontFaceCSS(
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
            // Extract path after domain: /s/roboto/v30/KFOmCnqEu92Fr1Mu4mxK.woff2
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

function inferFormatFromUrl(url: string): string {
  if (url.includes(".woff2")) return "woff2";
  if (url.includes(".woff")) return "woff";
  if (url.includes(".ttf")) return "truetype";
  if (url.includes(".otf")) return "opentype";
  return "woff2";
}

// Parse Google Fonts family parameter and generate CSS
function parseGoogleFontsFamily(family: string): Array<{
  name: string;
  weights: string[];
  styles: FontStyles[];
}> {
  const fonts: Array<{
    name: string;
    weights: string[];
    styles: FontStyles[];
  }> = [];
  const families = family.split("|");

  for (const familySpec of families) {
    const font = {
      name: "",
      weights: ["400"],
      styles: ["normal"] as FontStyles[],
    };

    if (familySpec.includes(":")) {
      const [name, spec] = familySpec.split(":");
      font.name = name.replaceAll(/\+/g, " ");

      if (spec.startsWith("wght@")) {
        const weightSpec = spec.slice(5);
        font.weights = parseWeights(weightSpec);
      } else if (spec.startsWith("ital,wght@")) {
        const specs = spec.slice(10).split(";");
        const weights: string[] = [];
        const styles: FontStyles[] = [];

        for (const s of specs) {
          const [italic, weight] = s.split(",");
          if (weight) {
            const expandedWeights = parseWeights(weight);
            weights.push(...expandedWeights);
            styles.push(italic === "1" ? "italic" : "normal");
          }
        }

        font.weights = [...new Set(weights)];
        font.styles = [...new Set(styles)];
      }
    } else {
      font.name = familySpec.replaceAll(/\+/g, " ");
    }

    fonts.push(font);
  }

  return fonts;
}

// Smart weight parsing based on actual font data
async function parseWeightsFromFont(
  fontName: string,
  weightSpec: string,
  unifont: Unifont,
): Promise<string[]> {
  // First get the actual font data to determine available weights
  try {
    const fontData = await unifont.resolveFont(fontName);
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

    // Available weights extracted from font data

    // Now filter based on the weight specification
    if (weightSpec.includes("..")) {
      const [start, end] = weightSpec.split("..").map(Number);
      return availableWeightNumbers
        .filter((weight) => weight >= start && weight <= end)
        .map((w) => w.toString());
    } else {
      // Handle individual weights
      const requestedWeights = weightSpec.split(";");
      return requestedWeights.filter((weight) =>
        availableWeightNumbers.includes(parseInt(weight)),
      );
    }
  } catch {
    // Failed to get font data, using fallback parsing
    return parseWeights(weightSpec);
  }
}

// Helper function to parse weight specifications including ranges (fallback)
function parseWeights(weightSpec: string): string[] {
  const weights: string[] = [];
  const specs = weightSpec.split(";");

  for (const spec of specs) {
    if (spec.includes("..")) {
      // Handle range format like "200..800"
      const [start, end] = spec.split("..").map(Number);
      const standardWeights = [100, 200, 300, 400, 500, 600, 700, 800, 900];

      for (const weight of standardWeights) {
        if (weight >= start && weight <= end) {
          weights.push(weight.toString());
        }
      }
    } else {
      // Handle individual weights
      weights.push(spec);
    }
  }

  return weights.length > 0 ? weights : ["400"];
}

// Generate CSS for multiple fonts with smart weight resolution and optional proxy
async function generateCSS(
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
    const isAvailable = await isFontAvailable(
      font.name,
      provider,
      providerConfig,
    );
    if (!isAvailable) {
      // Font not in available list - skip
      continue;
    }

    const unifont = await getUnifont(provider, providerConfig);

    // Processing font with resolved weights and styles

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
            );
            allResolvedWeights.push(...smartWeights);
          } else {
            allResolvedWeights.push(weight);
          }
        }
        resolvedWeights = [...new Set(allResolvedWeights)];
      }

      console.log(`Resolved weights for ${font.name}:`, resolvedWeights);

      const resolveOptions: Partial<ResolveFontOptions> = {
        weights: resolvedWeights,
        styles: font.styles,
        subsets: [subset],
      };

      const fontData = await unifont.resolveFont(font.name, resolveOptions);

      if (!fontData?.fonts?.length) {
        console.warn(
          `No font variants found for: ${font.name} with options:`,
          resolveOptions,
        );

        // Try without options as fallback
        console.log(`Trying ${font.name} without specific options...`);
        const fallbackData = await unifont.resolveFont(font.name);

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

export const fontsPlugin = (): BetterAuthPlugin => {
  return {
    id: "fonts",

    rateLimit: pluginRateLimits.fonts,

    endpoints: {
      // Google Fonts Developer API compatible - /webfonts
      listWebfonts: createAuthEndpoint(
        "/webfonts",
        {
          method: "GET",
        },
        async (ctx) => {
          const query = ctx.query;
          const provider = String(query.provider || "google");
          const sort = String(query.sort || "");
          const family = query.family ? String(query.family) : undefined;
          const subset = query.subset ? String(query.subset) : undefined;
          const category = query.category ? String(query.category) : undefined;

          const providerConfig = parseProviderConfig(query);
          const configKey = providerConfig
            ? JSON.stringify(providerConfig)
            : "default";
          const familyPart = family || "all";
          const sortPart = sort || "default";
          const subsetPart = subset || "latin";
          const categoryPart = category || "all";

          const safeCacheKey = `webfonts:${provider}:${btoa(configKey)}:${sortPart}:${btoa(familyPart)}:${subsetPart}:${categoryPart}`;

          try {
            // Check cache first
            const cached = await cacheStorage.metadata.get(safeCacheKey);
            if (cached && typeof cached === "object") {
              return ctx.json(cached);
            }

            const unifont = await getUnifont(provider, providerConfig);
            const fontsList = await getCachedFontsList(
              provider,
              providerConfig,
            );

            if (!fontsList.length) {
              return ctx.json({
                kind: "webfonts#webfontList",
                items: [],
              });
            }

            // Build font metadata items
            const items: WebFontItem[] = [];

            for (const fontName of fontsList) {
              // Apply family filter
              if (
                family &&
                !fontName.toLowerCase().includes(family.toLowerCase())
              ) {
                continue;
              }

              try {
                // Get detailed font information
                const fontData = await unifont.resolveFont(fontName);
                if (!fontData?.fonts?.length) continue;

                // Extract variants and weights with proper types
                const variants = new Set<string>();
                const files: Record<string, string> = {};
                const subsets = new Set<string>();

                for (const font of fontData.fonts) {
                  let variant = "regular";

                  if (font.style === "italic") {
                    variant =
                      font.weight &&
                      font.weight !== "400" &&
                      font.weight !== 400
                        ? `${font.weight}italic`
                        : "italic";
                  } else if (
                    font.weight &&
                    font.weight !== "400" &&
                    font.weight !== 400
                  ) {
                    variant = String(font.weight);
                  }

                  variants.add(variant);

                  // Extract font file URL
                  const fontSrc = font.src?.find(
                    (src) => "url" in src && src.url,
                  );
                  if (fontSrc && "url" in fontSrc) {
                    files[variant] = fontSrc.url;
                  }

                  // Extract unicode ranges as subsets approximation
                  if (font.unicodeRange?.length) {
                    // This is a simplified mapping - in reality you'd need proper unicode range analysis
                    subsets.add("latin");
                  } else {
                    subsets.add("latin");
                  }
                }

                // Apply subset filter
                if (
                  subset &&
                  !Array.from(subsets).some((s) => s.includes(subset))
                ) {
                  continue;
                }

                // Categorize font (simplified categorization)
                let fontCategory = "sans-serif";
                const fontNameLower = fontName.toLowerCase();
                if (
                  fontNameLower.includes("serif") &&
                  !fontNameLower.includes("sans")
                ) {
                  fontCategory = "serif";
                } else if (
                  fontNameLower.includes("mono") ||
                  fontNameLower.includes("code")
                ) {
                  fontCategory = "monospace";
                } else if (
                  fontNameLower.includes("display") ||
                  fontNameLower.includes("decorative")
                ) {
                  fontCategory = "display";
                } else if (
                  fontNameLower.includes("script") ||
                  fontNameLower.includes("handwriting")
                ) {
                  fontCategory = "handwriting";
                }

                // Apply category filter
                if (category && fontCategory !== category) {
                  continue;
                }

                const fontItem: WebFontItem = {
                  kind: "webfonts#webfont" as const,
                  family: fontName,
                  category: fontCategory,
                  variants: Array.from(variants).sort(),
                  subsets: Array.from(subsets).sort(),
                  version: "v1",
                  lastModified: "2024-01-01",
                  files,
                  menu: files.regular || Object.values(files)[0] || "",
                };

                items.push(fontItem);
              } catch {
                // Failed to process font metadata - skip
                continue;
              }
            }

            // Apply sorting
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

            const response: WebFontsResponse = {
              kind: "webfonts#webfontList" as const,
              items: items,
            };

            // Cache for 1 hour
            await cacheStorage.metadata.set(safeCacheKey, response);

            return ctx.json(response);
          } catch (error) {
            console.error("Webfonts API error:", error);
            return new Response(
              JSON.stringify({
                error: "Failed to fetch webfonts data",
                details:
                  error instanceof Error ? error.message : "Unknown error",
              }),
              {
                status: 500,
                headers: {
                  "Content-Type": "application/json",
                },
              },
            );
          }
        },
      ),

      // Google Fonts CSS API v1 compatible - /css
      generateCss: createAuthEndpoint(
        "/css",
        {
          method: "GET",
        },
        async (ctx) => {
          const query = ctx.query;

          if (!query.family) {
            return ctx.json({ error: "Missing family parameter" });
          }

          const family = String(query.family);
          const display = String(query.display || "swap");
          const subset = String(query.subset || "latin");
          const provider = String(query.provider || "google");
          const useProxy = String(query.useProxy || "false") === "true";

          // Parse provider configuration using unifont's built-in option types
          const providerConfig = parseProviderConfig(query);

          // Get base URL for proxy functionality
          const baseUrl = useProxy ? new URL(ctx.request.url).origin : "";

          // Create cache key including provider config and proxy setting
          const configKey = providerConfig
            ? JSON.stringify(providerConfig)
            : "default";
          const safeCacheKey = `css:${btoa(family)}:${display}:${subset}:${provider}:${btoa(configKey)}:${useProxy}`;

          // Check cache first
          const cached = await cacheStorage.metadata.get(safeCacheKey);
          if (cached && typeof cached === "string") {
            return new Response(cached, {
              headers: {
                "Content-Type": "text/css; charset=utf-8",
                "Cache-Control": "public, max-age=86400", // 24 hours
                "X-Cache": "HIT",
                "X-Proxy-Enabled": useProxy.toString(),
              },
            });
          }

          try {
            const css = await generateCSS(
              family,
              display,
              subset,
              provider,
              providerConfig,
              useProxy,
              baseUrl,
            );

            // Cache the result for 24 hours
            await cacheStorage.metadata.set(safeCacheKey, css);

            return new Response(css, {
              headers: {
                "Content-Type": "text/css; charset=utf-8",
                "Cache-Control": "public, max-age=86400",
                "X-Cache": "MISS",
                "X-Proxy-Enabled": useProxy.toString(),
              },
            });
          } catch (error) {
            console.error("CSS generation error:", error);
            return new Response(
              JSON.stringify({
                error: "Failed to generate font CSS",
                details:
                  error instanceof Error ? error.message : "Unknown error",
              }),
              {
                status: 500,
                headers: {
                  "Content-Type": "application/json",
                },
              },
            );
          }
        },
      ),

      // Google Fonts CSS API v2 compatible - /css2
      generateCss2: createAuthEndpoint(
        "/css2",
        {
          method: "GET",
        },
        async (ctx) => {
          // Same implementation as CSS v1 with proxy support
          const query = ctx.query;

          if (!query.family) {
            return ctx.json({ error: "Missing family parameter" });
          }

          const family = String(query.family);
          const display = String(query.display || "swap");
          const subset = String(query.subset || "latin");
          const provider = String(query.provider || "google");
          const useProxy = String(query.useProxy || "false") === "true";

          // Parse provider configuration
          const providerConfig = parseProviderConfig(query);

          // Get base URL for proxy functionality
          const baseUrl = useProxy ? new URL(ctx.request.url).origin : "";

          // Create cache key including provider config and proxy setting
          const configKey = providerConfig
            ? JSON.stringify(providerConfig)
            : "default";
          const safeCacheKey = `css2:${btoa(family)}:${display}:${subset}:${provider}:${btoa(configKey)}:${useProxy}`;

          // Check cache first
          const cached = await cacheStorage.metadata.get(safeCacheKey);
          if (cached && typeof cached === "string") {
            return new Response(cached, {
              headers: {
                "Content-Type": "text/css; charset=utf-8",
                "Cache-Control": "public, max-age=86400",
                "X-Cache": "HIT",
                "X-Proxy-Enabled": useProxy.toString(),
              },
            });
          }

          try {
            const css = await generateCSS(
              family,
              display,
              subset,
              provider,
              providerConfig,
              useProxy,
              baseUrl,
            );

            // Cache the result for 24 hours
            await cacheStorage.metadata.set(safeCacheKey, css);

            return new Response(css, {
              headers: {
                "Content-Type": "text/css; charset=utf-8",
                "Cache-Control": "public, max-age=86400",
                "X-Cache": "MISS",
                "X-Proxy-Enabled": useProxy.toString(),
              },
            });
          } catch (error) {
            console.error("CSS generation error:", error);
            return new Response(
              JSON.stringify({
                error: "Failed to generate font CSS",
                details:
                  error instanceof Error ? error.message : "Unknown error",
              }),
              {
                status: 500,
                headers: {
                  "Content-Type": "application/json",
                },
              },
            );
          }
        },
      ),

      // Font file proxy with security restrictions - /fonts/*
      getFontFile: createAuthEndpoint(
        "/fonts/*",
        {
          method: "GET",
        },
        async (ctx) => {
          // Parse path manually since better-auth might not support complex param patterns
          const pathParts = ctx.request.url.split("/fonts/")[1]?.split("/");
          if (!pathParts || pathParts.length < 2) {
            return ctx.json({
              error: "Invalid font path format. Expected: /fonts/provider/path",
            });
          }

          const provider = pathParts[0];
          const fontpath = "/" + pathParts.slice(1).join("/");

          if (!fontpath) {
            return ctx.json({ error: "Font path required" });
          }

          // Security: Only allow specific providers
          const allowedProviders = [
            "google",
            "bunny",
            "fontshare",
            "fontsource",
          ];
          if (!allowedProviders.includes(provider)) {
            return ctx.json({
              error: `Provider '${provider}' not allowed. Supported providers: ${allowedProviders.join(", ")}`,
            });
          }

          // Extract and validate font URL
          let fontUrl: string;

          try {
            // Handle simplified path format: /fonts/google/s/roboto/v30/file.woff2
            // fontpath now contains just the path part: /s/roboto/v30/file.woff2

            // Construct full URL based on provider and path
            switch (provider) {
              case "google":
                fontUrl = `https://fonts.gstatic.com${fontpath}`;
                break;
              case "bunny":
                fontUrl = `https://fonts.bunny.net${fontpath}`;
                break;
              case "fontshare":
                fontUrl = `https://api.fontshare.com${fontpath}`;
                break;
              case "fontsource":
                fontUrl = `https://cdn.jsdelivr.net${fontpath}`;
                break;
              default:
                return ctx.json({ error: `Unsupported provider: ${provider}` });
            }

            // Security: Validate the URL belongs to allowed domains
            const url = new URL(fontUrl);
            const allowedDomains = {
              google: ["fonts.gstatic.com", "fonts.googleapis.com"],
              bunny: ["fonts.bunny.net"],
              fontshare: ["api.fontshare.com", "cdn.fontshare.com"],
              fontsource: ["cdn.jsdelivr.net"],
            };

            const providerDomains =
              allowedDomains[provider as keyof typeof allowedDomains];
            if (
              !providerDomains?.some(
                (domain) =>
                  url.hostname === domain ||
                  url.hostname.endsWith(`.${domain}`),
              )
            ) {
              return ctx.json({
                error: `URL not allowed for provider '${provider}'. Expected domains: ${providerDomains?.join(", ")}`,
                receivedUrl: fontUrl,
                hostname: url.hostname,
              });
            }

            // Create cache key for persistent storage (use btoa for safe filename)
            const safeCacheKey = `fonts:${provider}:${btoa(fontUrl)}`;

            // Check font cache
            const cachedBinaryData = await cacheStorage.fonts.get(safeCacheKey);
            if (cachedBinaryData) {
              return new Response(cachedBinaryData, {
                headers: {
                  "Content-Type": "font/woff2",
                  "Cache-Control": "public, max-age=2592000", // 30 days
                  "X-Cache": "HIT",
                },
              });
            }

            // Use native fetch to get font file
            console.log(`Fetching font file: ${fontUrl}`);

            const response = await fetch(fontUrl, {
              headers: {
                "User-Agent": "fonts-proxy/1.0",
                Accept: "font/woff2,font/woff,font/ttf,*/*",
                "Accept-Encoding": "gzip, deflate, br",
              },
            });

            if (!response.ok) {
              console.error(
                `Font fetch failed: ${response.status} ${response.statusText} for ${fontUrl}`,
              );
              return ctx.json(
                {
                  error: "Font file not found",
                  status: response.status,
                  url: fontUrl,
                  statusText: response.statusText,
                },
                { status: response.status },
              );
            }

            // Get content type and create ETag
            const contentType =
              response.headers.get("content-type") || "font/woff2";
            const lastModified =
              response.headers.get("last-modified") || new Date().toUTCString();
            const etag = `"${btoa(fontUrl)}-${Date.now()}"`;

            // Convert response data to ArrayBuffer
            const responseData = await response.arrayBuffer();

            // Cache the font file
            cacheStorage.fonts
              .set(safeCacheKey, Buffer.from(responseData))
              .catch(() => {
                // Silent failure - graceful degradation
              });

            // Return the font with proper headers
            return new Response(responseData, {
              headers: {
                "Content-Type": contentType,
                "Content-Length": responseData.byteLength.toString(),
                "Cache-Control": "public, max-age=2592000, immutable", // 30 days, immutable for font files
                ETag: etag,
                "Last-Modified": lastModified,
                "X-Cache": "MISS",
                "Access-Control-Allow-Origin": "*", // Allow cross-origin font requests
                "Cross-Origin-Resource-Policy": "cross-origin",
              },
            });
          } catch (error) {
            console.error("Font proxy error:", error);

            if (error instanceof TypeError && error.message.includes("fetch")) {
              return ctx.json(
                {
                  error: "Failed to fetch font file - network error",
                  details: "The font server may be unreachable",
                  fontpath: fontpath,
                  resolvedUrl: fontUrl || "unknown",
                },
                { status: 502 },
              );
            }

            return ctx.json(
              {
                error: "Failed to proxy font file",
                details:
                  error instanceof Error ? error.message : "Unknown error",
                fontpath: fontpath,
              },
              { status: 500 },
            );
          }
        },
      ),
    },
  };
};
