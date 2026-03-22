import { defineNitroConfig } from "nitro/config";
import { env, isBun, isDeno, isNode } from "std-env";

import pkg from "./package.json";

// Detect if filesystem is available (Node.js, Bun, or Deno runtime)
const hasFilesystem = isNode || isBun || isDeno;

export default defineNitroConfig({
  serverDir: "./server/",
  experimental: {
    openAPI: true,
  },
  routeRules: {
    "/**": {
      cors: true,
    },
  },
  openAPI: {
    meta: {
      title: pkg.name,
      description: pkg.description,
      version: pkg.version,
    },
    production: "runtime",
    route: "/_docs/openapi.json",
    ui: {
      scalar: {
        route: "/_docs/scalar",
      },
      swagger: {
        route: "/_docs/swagger",
      },
    },
  },
  storage: {
    cache: {
      driver: env.REDIS_URL ? "redis" : hasFilesystem ? "fs" : "memory",
      ...(env.REDIS_URL && {
        url: env.REDIS_URL,
      }),
      ...(hasFilesystem &&
        !env.REDIS_URL && {
          base: "./.cache",
        }),
    },
  },
  devStorage: {
    cache: {
      driver: "fs",
      base: "./.cache",
    },
  },
});
