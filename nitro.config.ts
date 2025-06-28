//https://nitro.unjs.io/config
import { defineNitroConfig } from "nitropack/config";

export default defineNitroConfig({
  srcDir: "server",

  // Runtime configuration with environment variables
  runtimeConfig: {
    // Private runtime config (server only)
    allowedDomains: process.env.ALLOWED_DOMAINS || "example.com",
    redisUrl: process.env.REDIS_URL || "",

    // Public runtime config (client and server)
    public: {
      apiBase: process.env.API_BASE || "http://localhost:3000",
    },
  },

  // Route rules for caching and headers
  routeRules: {
    // OG images cache for 1 hour
    "/og**": {
      headers: {
        "cache-control": "public, max-age=3600",
        "content-type": "image/png",
      },
    },

    // Image proxy cache for 1 day
    "/img/**": {
      headers: {
        "cache-control": "public, max-age=86400",
      },
      cors: true,
    },

    // Favicon cache for 1 day
    "/favicon**": {
      headers: {
        "cache-control": "public, max-age=86400",
        "content-type": "image/png",
      },
    },

    // Screenshot cache for 30 minutes
    "/screenshot**": {
      headers: {
        "cache-control": "public, max-age=1800",
      },
    },

    // Font CSS cache for 1 day
    "/css**": {
      headers: {
        "cache-control": "public, max-age=86400",
        "content-type": "text/css; charset=utf-8",
      },
      cors: true,
    },

    // Font files cache for 1 year
    "/fonts/**": {
      headers: {
        "cache-control": "public, max-age=31536000",
      },
      cors: true,
    },

    // API routes with CORS
    "/api/**": {
      cors: true,
      headers: {
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "Content-Type, Authorization",
      },
    },
  },

  // Experimental features
  experimental: {
    wasm: true, // For potential WASM font processing
  },

  // Development proxy for testing
  devProxy:
    process.env.NODE_ENV === "development"
      ? {
          "/proxy/test": "http://localhost:3001",
        }
      : undefined,

  // Build configuration
  minify: process.env.NODE_ENV === "production",
});
