import { defineNitroConfig } from "nitro/config";

import pkg from "./package.json";

const linuxArch = process.arch === "arm64" ? "arm64" : "x64";
const sharpTraceDeps =
  process.platform === "linux" ? [`@img/sharp-libvips-linux-${linuxArch}`] : [];
const canvasTraceDeps =
  process.platform === "linux" ? [`@napi-rs/canvas-linux-${linuxArch}-gnu`] : [];

export default defineNitroConfig({
  serverDir: "./server/",
  experimental: {
    openAPI: true,
  },
  routeRules: {
    "/**": {
      cors: {
        origin: "*",
        methods: ["GET", "HEAD", "POST", "OPTIONS"],
        allowHeaders: "*",
        exposeHeaders: "*",
        maxAge: "86400",
        preflight: { statusCode: 204 },
      },
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
  // sharp dynamically loads libvips and @napi-rs/canvas dynamically loads its
  // platform binary; explicit tracing prevents Linux images from shipping the
  // JavaScript loaders only.
  traceDeps: [...sharpTraceDeps, ...canvasTraceDeps],
  storage: {
    cache: {
      // FS driver does not support TTL; memory is the build-time default.
      // server/plugins/storage.ts mounts redis over this at runtime when
      // REDIS_URL is set — config-level env checks are evaluated at build
      // time and would freeze the driver into the bundle.
      driver: "memory",
    },
  },
  devStorage: {
    cache: {
      driver: "fs",
      base: "./.cache",
    },
  },
});
