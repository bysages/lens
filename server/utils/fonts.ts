// Fonts service plugin - Google Fonts API compatible
// Refactored for KISS, DRY, and Single Responsibility principles
import { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { cacheStorage } from "./storage";
import { pluginRateLimits } from "./rate-limits";

// Import modular components
import type { WebFontsResponse } from "./fonts/types";
import { parseProviderConfig } from "./fonts/utils";
import { generateCSS } from "./fonts/css-generator";
import { processFontsForWebfontsAPI } from "./fonts/webfonts-api";

export const fontsPlugin = (): BetterAuthPlugin => {
  return {
    id: "fonts",
    rateLimit: pluginRateLimits.fonts,
    endpoints: {
      // Google Fonts Developer API compatible - /webfonts
      listWebfonts: createAuthEndpoint(
        "/webfonts",
        { method: "GET" },
        async (ctx) => {
          const query = ctx.query;
          const provider = String(query.provider || "google");
          const sort = String(query.sort || "");
          const family = query.family ? String(query.family) : undefined;
          const subset = query.subset ? String(query.subset) : undefined;
          const category = query.category ? String(query.category) : undefined;

          // Create cache key
          const providerConfig = parseProviderConfig(query);
          const configKey = providerConfig
            ? JSON.stringify(providerConfig)
            : "default";
          const cacheKey = `webfonts:${provider}:${btoa(configKey)}:${sort}:${btoa(family || "all")}:${subset || "latin"}:${category || "all"}`;

          try {
            // Check cache first
            const cached = await cacheStorage.metadata.get(cacheKey);
            if (cached && typeof cached === "object") {
              return ctx.json(cached);
            }

            // Process fonts
            const items = await processFontsForWebfontsAPI(
              provider,
              providerConfig,
              { family, subset, category },
              sort,
            );

            const response: WebFontsResponse = {
              kind: "webfonts#webfontList" as const,
              items,
            };

            // Cache for 1 hour
            await cacheStorage.metadata.set(cacheKey, response);
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
                headers: { "Content-Type": "application/json" },
              },
            );
          }
        },
      ),

      // Google Fonts CSS API v1 compatible - /css
      generateCss: createAuthEndpoint(
        "/css",
        { method: "GET" },
        async (ctx) => {
          return await handleCssGeneration(ctx, "css");
        },
      ),

      // Google Fonts CSS API v2 compatible - /css2
      generateCss2: createAuthEndpoint(
        "/css2",
        { method: "GET" },
        async (ctx) => {
          return await handleCssGeneration(ctx, "css2");
        },
      ),

      // Font file proxy - /fonts/*
      getFontFile: createAuthEndpoint(
        "/fonts/*",
        { method: "GET" },
        async (ctx) => {
          return await handleFontFileProxy(ctx);
        },
      ),
    },
  };
};

// Handle CSS generation for both v1 and v2
async function handleCssGeneration(ctx: any, version: string) {
  const query = ctx.query;

  if (!query.family) {
    return ctx.json({ error: "Missing family parameter" });
  }

  const family = String(query.family);
  const display = String(query.display || "swap");
  const subset = String(query.subset || "latin");
  const provider = String(query.provider || "google");
  const useProxy = String(query.useProxy || "false") === "true";

  const providerConfig = parseProviderConfig(query);
  const baseUrl = useProxy ? new URL(ctx.request.url).origin : "";

  // Create cache key
  const configKey = providerConfig ? JSON.stringify(providerConfig) : "default";
  const cacheKey = `${version}:${btoa(family)}:${display}:${subset}:${provider}:${btoa(configKey)}:${useProxy}`;

  // Check cache first
  const cached = await cacheStorage.metadata.get(cacheKey);
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

    // Cache for 24 hours
    await cacheStorage.metadata.set(cacheKey, css);

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
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

// Handle font file proxy
async function handleFontFileProxy(ctx: any) {
  // Parse path manually
  const pathParts = ctx.request.url.split("/fonts/")[1]?.split("/");
  if (!pathParts || pathParts.length < 2) {
    return ctx.json({
      error: "Invalid font path format. Expected: /fonts/provider/path",
    });
  }

  const provider = pathParts[0];
  const fontpath = "/" + pathParts.slice(1).join("/");

  // Security: Only allow specific providers
  const allowedProviders = ["google", "bunny", "fontshare", "fontsource"];
  if (!allowedProviders.includes(provider)) {
    return ctx.json({
      error: `Provider '${provider}' not allowed. Supported providers: ${allowedProviders.join(", ")}`,
    });
  }

  try {
    // Construct full URL based on provider
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
        return ctx.json({ error: `Unsupported provider: ${provider}` });
    }

    // Security validation
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
          url.hostname === domain || url.hostname.endsWith(`.${domain}`),
      )
    ) {
      return ctx.json({
        error: `URL not allowed for provider '${provider}'`,
        receivedUrl: fontUrl,
        hostname: url.hostname,
      });
    }

    // Check cache
    const cacheKey = `fonts:${provider}:${btoa(fontUrl)}`;
    const cachedData = await cacheStorage.fonts.get(cacheKey);
    if (cachedData) {
      return new Response(cachedData, {
        headers: {
          "Content-Type": "font/woff2",
          "Cache-Control": "public, max-age=2592000",
          "X-Cache": "HIT",
        },
      });
    }

    // Fetch font file
    const response = await fetch(fontUrl, {
      headers: {
        "User-Agent": "fonts-proxy/1.0",
        Accept: "font/woff2,font/woff,font/ttf,*/*",
        "Accept-Encoding": "gzip, deflate, br",
      },
    });

    if (!response.ok) {
      return ctx.json(
        {
          error: "Font file not found",
          status: response.status,
          url: fontUrl,
        },
        { status: response.status },
      );
    }

    const responseData = await response.arrayBuffer();

    // Cache the font file
    cacheStorage.fonts.set(cacheKey, Buffer.from(responseData)).catch(() => {
      // Silent failure for graceful degradation
    });

    return new Response(responseData, {
      headers: {
        "Content-Type": response.headers.get("content-type") || "font/woff2",
        "Content-Length": responseData.byteLength.toString(),
        "Cache-Control": "public, max-age=2592000, immutable",
        "X-Cache": "MISS",
      },
    });
  } catch (error) {
    console.error("Font proxy error:", error);
    return ctx.json(
      {
        error: "Failed to proxy font file",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
