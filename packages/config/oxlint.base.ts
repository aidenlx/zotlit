import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "promise"],
  rules: {
    "typescript/no-non-null-assertion": "off",
    "typescript/no-explicit-any": "off",
    "typescript/ban-ts-comment": "off",

    "no-param-reassign": "error",
    "default-param-last": "error",
    "max-params": ["error", { max: 3 }],
    "no-else-return": "error",
    "prefer-template": "warn",
    "no-useless-concat": "error",

    "unicorn/prefer-number-properties": "error",
  },
});
