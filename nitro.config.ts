//https://nitro.unjs.io/config
import { defineNitroConfig } from "nitropack/config";

export default defineNitroConfig({
  srcDir: "server",

  // Experimental features
  experimental: {
    wasm: true, // For potential WASM font processing
  },

  // Build configuration
  minify: process.env.NODE_ENV === "production",
});
