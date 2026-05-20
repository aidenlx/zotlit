import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: [
    "react",
    "react-perf",
    "eslint",
    "typescript",
    "unicorn",
    "oxc",
    "import",
    "promise",
  ],
  rules: {
    "typescript/no-non-null-assertion": "off",
    "typescript/no-explicit-any": "off",
    "typescript/ban-ts-comment": "off",
    "typescript/prefer-readonly": "error",

    "no-param-reassign": "error",
    "default-param-last": "error",
    "max-params": ["error", { max: 3 }],
    "no-else-return": "error",
    "prefer-template": "warn",
    "no-useless-concat": "error",

    "unicorn/prefer-number-properties": "error",
    "unicorn/prefer-string-replace-all": "error",
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["../**"],
            message:
              "Use @/ alias instead of parent-directory relative imports.",
          },
        ],
      },
    ],
  },
});
