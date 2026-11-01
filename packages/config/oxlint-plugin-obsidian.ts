// obsidianmd: the type-free rules of eslint-plugin-obsidianmd, loaded into
// oxlint under the same name so a finding reads the same in both linters.
// oxlint's JS plugin layer gives a rule no type information, so the six
// type-aware rules stay with ESLint in `pnpm review`. Rule tests:
// oxlint-plugin-obsidian.test.ts.
import obsidianmd from "eslint-plugin-obsidianmd";

const typeAware = new Set([
  "no-plugin-as-component",
  "no-unsupported-api",
  "no-view-references-in-plugin",
  "prefer-create-el",
  "prefer-file-manager-trash-file",
  "prefer-instanceof",
]);

export default {
  meta: { name: "obsidianmd" },
  rules: Object.fromEntries(
    Object.entries(obsidianmd.rules).filter(([name]) => !typeAware.has(name)),
  ),
};
