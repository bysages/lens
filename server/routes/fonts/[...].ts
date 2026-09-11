import { defineHandler, HTTPError, getRouterParam } from "nitro/h3";
import { hash } from "ohash";

import { serveCached } from "../../utils/cache";
import { CACHE_IMMUTABLE, FONT_FILE_TTL, MAX_CACHE_ENTRY_BYTES } from "../../utils/constants";

export const allowedProviders = ["google", "bunny", "fontshare", "fontsource"];

export const providerDomains: Record<string, string[]> = {
  google: ["fonts.gstatic.com", "fonts.googleapis.com"],
  bunny: ["fonts.bunny.net"],
  fontshare: ["api.fontshare.com", "cdn.fontshare.com"],
  fontsource: ["cdn.jsdelivr.net"],
};

export function getFontContentType(path: string): string {
  if (path.endsWith(".woff2")) return "font/woff2";
  if (path.endsWith(".woff")) return "font/woff";
  if (path.endsWith(".ttf")) return "font/ttf";
  if (path.endsWith(".otf")) return "font/otf";
  if (path.endsWith(".sfnt")) return "font/sfnt";
  return "font/woff2";
}

export function getFontExtension(path: string): string {
  if (path.endsWith(".woff2")) return "woff2";
  if (path.endsWith(".woff")) return "woff";
  if (path.endsWith(".ttf")) return "ttf";
  if (path.endsWith(".otf")) return "otf";
  if (path.endsWith(".sfnt")) return "sfnt";
  return "woff2";
}

export default defineHandler(async (event) => {
  const path = getRouterParam(event, "_") || "";
  const parts = path.split("/").filter(Boolean);

  if (parts.length < 2) {
    throw new HTTPError({
      status: 400,
      message: "Invalid font path format. Expected: /fonts/provider/path",
    });
  }

  const provider = parts[0];
  if (!provider) {
    throw new HTTPError({
      status: 400,
      message: "Missing provider in path",
    });
  }

  const fontpath = "/" + parts.slice(1).join("/");

  if (!allowedProviders.includes(provider)) {
    throw new HTTPError({
      status: 400,
      message: `Provider '${provider}' not allowed. Supported: ${allowedProviders.join(", ")}`,
    });
  }

  let fontUrl: string;
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
      throw new HTTPError({ status: 400, message: `Unsupported provider: ${provider}` });
  }

  const url = new URL(fontUrl);
  const domains = providerDomains[provider];
  if (!domains?.some((d) => url.hostname === d || url.hostname.endsWith(`.${d}`))) {
    throw new HTTPError({
      status: 400,
      message: `URL not allowed for provider '${provider}'`,
    });
  }

  // Generate cache key using ohash
  const extension = getFontExtension(fontpath);
  const cacheKey = `fonts:${hash({ provider, path: fontpath })}.${extension}`;

  return serveCached(event, {
    key: cacheKey,
    ttl: FONT_FILE_TTL,
    contentType: getFontContentType(fontpath),
    cacheControl: CACHE_IMMUTABLE,
    maxBytes: MAX_CACHE_ENTRY_BYTES,
    produce: async () => {
      const response = await fetch(fontUrl, {
        headers: {
          Accept: "font/woff2,font/woff,font/ttf,*/*",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new HTTPError({
          status: response.status,
          message: "Font file not found",
        });
      }

      return {
        data: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") || getFontContentType(fontpath),
      };
    },
  });
});
