//https://nitro.unjs.io/config
import { defineNitroConfig } from "nitropack/config";

export default defineNitroConfig({
  srcDir: "server",

  preset: "node_cluster",

  // Build configuration
  minify: process.env.NODE_ENV === "production",
});
