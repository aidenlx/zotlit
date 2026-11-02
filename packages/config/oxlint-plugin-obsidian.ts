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

type Rule = NonNullable<(typeof obsidianmd.rules)[string]>;

/** The rule without its autofix: it reports, and the author picks the global. */
function reportOnly(rule: Rule): Rule {
  return {
    ...rule,
    meta: { ...rule.meta, fixable: undefined },
    create: (context) =>
      rule.create(
        new Proxy({} as typeof context, {
          get: (_, key) =>
            key === "report"
              ? (report: { fix?: unknown }) =>
                  context.report({ ...report, fix: undefined } as never)
              : Reflect.get(context, key, context),
        }),
      ),
  } as Rule;
}

const rules: Record<string, Rule> = {};
for (const [name, rule] of Object.entries(obsidianmd.rules)) {
  if (rule && !typeAware.has(name)) rules[name] = rule;
}
// `window` is undefined in a worker, so `oxlint --fix` must leave this alone.
rules["no-global-this"] = reportOnly(rules["no-global-this"]!);

export default { meta: { name: "obsidianmd" }, rules };
