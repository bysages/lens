import { nitro } from "nitro/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [nitro()],
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
