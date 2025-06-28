// Better Auth configuration with adaptive storage integration
import { betterAuth } from "better-auth";
import { openAPI, bearer, apiKey } from "better-auth/plugins";
import { createSecondaryStorageAdapter, getAdaptiveDatabase } from "./storage";
import { fontsPlugin } from "./fonts";
import { ogPlugin } from "./og";
import { faviconPlugin } from "./favicon";
import { screenshotPlugin } from "./screenshot";
import { imagePlugin } from "./image";
import { globalRateLimit, createCustomRules } from "./rate-limits";

/**
 * Create social providers configuration with graceful degradation
 */
function createSocialProviders() {
  const providers: Record<string, any> = {};

  // GitHub OAuth - only if credentials are available
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    providers.github = {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    };
  }

  return providers;
}

export const auth = betterAuth({
  database: getAdaptiveDatabase(),
  secondaryStorage: createSecondaryStorageAdapter(),

  emailAndPassword: {
    enabled: true,
  },

  socialProviders: createSocialProviders(),

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    storeSessionInDatabase: false,
  },

  rateLimit: {
    enabled: globalRateLimit.enabled,
    window: globalRateLimit.window,
    max: globalRateLimit.max,
    storage: globalRateLimit.storage,
    customRules: createCustomRules(),
  },

  plugins: [
    bearer(),
    openAPI(),
    // API Key plugin for convenient GET request authentication
    apiKey({
      // Support multiple header names for API keys
      apiKeyHeaders: ["x-api-key", "authorization"],
      // Also support query parameter for GET requests
      customAPIKeyGetter: (ctx) => {
        // Check headers first
        const apiKeyHeader = ctx.request.headers.get("x-api-key");
        if (apiKeyHeader) return apiKeyHeader;

        // Check authorization header for "Bearer api_key_value" format
        const authHeader = ctx.request.headers.get("authorization");
        if (authHeader?.startsWith("Bearer ")) {
          const token = authHeader.slice(7);
          // Simple heuristic: API keys are typically longer and contain underscores/hyphens
          if (
            token.length > 20 &&
            (token.includes("_") || token.includes("-"))
          ) {
            return token;
          }
        }

        // Fallback to query parameter for GET requests (less secure but convenient)
        const url = new URL(ctx.request.url);
        return url.searchParams.get("api_key");
      },
      // Default permissions for new API keys
      permissions: {
        defaultPermissions: {
          images: ["read", "process"],
          screenshots: ["read", "create"],
          fonts: ["read"],
          favicon: ["read", "extract"],
          og: ["read", "generate"],
        },
      },
      // Enable metadata storage for API key management
      enableMetadata: true,
      // Default expiration: 1 year
      keyExpiration: {
        defaultExpiresIn: 365 * 24 * 60 * 60 * 1000, // 1 year in milliseconds
        maxExpiresIn: 365, // 1 year max
        minExpiresIn: 1, // 1 day min
      },
      // Note: Rate limiting is handled by Better Auth's global system
      // API key users are treated as authenticated users
    }),
    fontsPlugin(),
    ogPlugin(),
    faviconPlugin(),
    screenshotPlugin(),
    imagePlugin(),
  ],

  basePath: "/",
});
