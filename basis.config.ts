import { defineBasisConfig } from "@funish/basis";

export default defineBasisConfig({
  lint: {
    staged: {
      "*": "pnpm lint",
    },
    project: {
      check: "pnpm oxlint --fix --fix-suggestions -D suspicious",
      format:
        "pnpm prettier --write --list-different . --ignore-path .gitignore --plugin=@prettier/plugin-oxc",
    },
  },
  git: {
    hooks: {
      "pre-commit": "pnpm exec basis lint --staged",
      "commit-msg": "pnpm exec basis git --lint-commit",
    },
  },
});
