// Font utility functions
import { createUnifont, providers } from "unifont";
import { cacheStorage } from "../storage";
import type { ParsedFont, FontStyles, Provider, Unifont } from "./types";

// Cache unifont instances
const unifontInstances = new Map<string, Unifont>();

// Get unifont instance for provider with optional configuration
export async function getUnifont(
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
        providerInstance = providers.adobe(
          config as Parameters<typeof providers.adobe>[0],
        );
        break;
      case "google":
        providerInstance = config
          ? providers.google(config as Parameters<typeof providers.google>[0])
          : providers.google();
        break;
      case "googleicons":
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

// Parse provider configuration with proper types
export function parseProviderConfig(
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

// Infer format from URL
export function inferFormatFromUrl(url: string): string {
  if (url.includes(".woff2")) return "woff2";
  if (url.includes(".woff")) return "woff";
  if (url.includes(".ttf")) return "truetype";
  if (url.includes(".otf")) return "opentype";
  return "woff2";
}

// Parse Google Fonts family parameter
export function parseGoogleFontsFamily(family: string): ParsedFont[] {
  const fonts: ParsedFont[] = [];
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

// Parse weight specifications including ranges
export function parseWeights(weightSpec: string): string[] {
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
