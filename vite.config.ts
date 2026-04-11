import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { nitro } from "nitro/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [nitro()],
  define: {
    __filename: JSON.stringify(fileURLToPath(import.meta.url)),
    __dirname: JSON.stringify(dirname(fileURLToPath(import.meta.url))),
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    sortImports: {
      type: "natural",
    },
    sortPackageJson: true,
    sortTailwindcss: {},
  },
  staged: {
    "*": "vp check --fix",
  },
});
