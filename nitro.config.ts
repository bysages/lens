import { defineNitroConfig } from "nitro/config";
import { env } from "std-env";

import pkg from "./package.json";

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
      // FS driver does not support TTL, only use redis or memory
      driver: env.REDIS_URL ? "redis" : "memory",
      ...(env.REDIS_URL && {
        url: env.REDIS_URL,
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
