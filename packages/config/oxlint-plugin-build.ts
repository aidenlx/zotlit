import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, matchesGlob, resolve } from "node:path";
import { parseSync } from "oxc-parser";
import type { Expression } from "oxc-parser";
import type { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];
type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type Member = Parameters<NonNullable<Visitor["MemberExpression"]>>[0];

function resolveBuildModule(specifier: string, importer: string): string {
  if (!specifier.startsWith("."))
    return createRequire(importer).resolve(specifier);
  const path = resolve(dirname(importer), specifier);
  const candidates = [
    path,
    `${path}.ts`,
    `${path}.tsx`,
    join(path, "index.ts"),
  ];
  if (path.endsWith(".js")) candidates.push(`${path.slice(0, -3)}.ts`);
  return candidates.find(existsSync) ?? path;
}

function staticString(
  node: NonNullable<Member["parent"]> | Expression | null | undefined,
): string | undefined {
  if (node?.type === "Literal" && typeof node.value === "string")
    return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw;
  if (
    node?.type === "TSAsExpression" ||
    node?.type === "TSSatisfiesExpression" ||
    node?.type === "TSNonNullExpression"
  )
    return staticString(node.expression);
  return undefined;
}

/** Imported constant keys use the exporting module's literal declaration. */
function importedString(
  specifier: string,
  importer: string,
  name: string,
): string | undefined {
  const file = resolveBuildModule(specifier, importer);
  const parsed = parseSync(file, readFileSync(file, "utf8"));
  for (const statement of parsed.program.body) {
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? statement.declaration
        : statement;
    if (
      declaration?.type !== "VariableDeclaration" ||
      declaration.kind !== "const"
    )
      continue;
    for (const binding of declaration.declarations)
      if (binding.id.type === "Identifier" && binding.id.name === name)
        return staticString(binding.init);
  }
  return undefined;
}

/** Follow workspace build imports, including re-exports, without executing them. */
export function buildModules(entry: string): Set<string> {
  const files = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    const parsed = parseSync(file, readFileSync(file, "utf8"));
    if (parsed.errors.length)
      throw new Error(`Cannot parse build module ${file}`);
    const imports = parsed.program.body.flatMap((node) =>
      node.type === "ImportDeclaration" ||
      node.type === "ExportAllDeclaration" ||
      node.type === "ExportNamedDeclaration"
        ? node.source &&
          !("exportKind" in node && node.exportKind === "type") &&
          !("importKind" in node && node.importKind === "type")
          ? [node.source.value]
          : []
        : [],
    );
    for (const specifier of imports) {
      if (
        !(
          specifier.startsWith(".") ||
          specifier.startsWith("#") ||
          specifier.startsWith("@zotlit/")
        )
      )
        continue;
      const target = resolveBuildModule(specifier, file);
      if (
        [".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs"].some((extension) =>
          target.endsWith(extension),
        ) &&
        !target.includes("/node_modules/")
      )
        visit(target);
    }
  };
  visit(resolve(entry));
  return files;
}

interface BuildPolicy {
  files: Set<string>;
  tasks: Record<string, string[]>;
}

function propertyName(node: Member): string | undefined {
  if (!node.computed && node.property.type === "Identifier")
    return node.property.name;
  if (node.computed) return staticString(node.property);
  return undefined;
}

/** The factory lets RuleTester supply a small build graph and task declarations. */
export function undeclaredEnvRule(policy: BuildPolicy): Rule {
  return {
    meta: {
      type: "problem",
      schema: [],
      messages: {
        undeclared:
          "Declare {{name}} in the Turbo {{tasks}} env lists; these tasks read it when they build the Obsidian plugin.",
      },
    },
    create(context) {
      if (!policy.files.has(context.filename)) return {};
      return {
        MemberExpression(node) {
          const env = node.object;
          if (
            env.type !== "MemberExpression" ||
            propertyName(env) !== "env" ||
            env.object.type !== "Identifier" ||
            env.object.name !== "process"
          )
            return;
          // Assignment targets write an environment value rather than read it.
          if (
            node.parent.type === "AssignmentExpression" &&
            node.parent.left === node &&
            node.parent.operator === "="
          )
            return;
          let name = propertyName(node);
          if (!name && node.computed && node.property.type === "Identifier") {
            for (
              let scope = context.sourceCode.getScope(node);
              scope;
              scope = scope.upper!
            ) {
              const variable = scope.set.get(node.property.name);
              if (!variable) continue;
              const definition = variable.defs[0];
              if (
                definition?.node.type === "VariableDeclarator" &&
                definition.parent?.type === "VariableDeclaration" &&
                definition.parent.kind === "const"
              ) {
                name = staticString(definition.node.init);
              } else if (
                definition?.node.type === "ImportSpecifier" &&
                definition.parent?.type === "ImportDeclaration"
              ) {
                const imported = definition.node.imported;
                name = importedString(
                  definition.parent.source.value,
                  context.filename,
                  imported.type === "Identifier"
                    ? imported.name
                    : imported.value,
                );
              }
              break;
            }
          }
          if (!name || name === "GH_TOKEN" || name === "GITHUB_TOKEN") return;
          const missing = Object.entries(policy.tasks)
            .filter(
              ([, patterns]) =>
                !patterns.some(
                  (pattern) =>
                    !pattern.startsWith("!") && matchesGlob(name, pattern),
                ) ||
                patterns.some(
                  (pattern) =>
                    pattern.startsWith("!") &&
                    matchesGlob(name, pattern.slice(1)),
                ),
            )
            .map(([task]) => task);
          if (missing.length)
            context.report({
              node,
              messageId: "undeclared",
              data: { name, tasks: missing.join(" and ") },
            });
        },
      };
    },
  };
}

const root = resolve(import.meta.dirname, "../..");
const obsidian = join(root, "apps/obsidian");
const turbo = JSON.parse(
  readFileSync(join(obsidian, "turbo.json"), "utf8"),
) as { tasks: Record<string, { env?: string[] }> };
const rootTurbo = JSON.parse(
  readFileSync(join(root, "turbo.json"), "utf8"),
) as typeof turbo;
export const noUndeclaredEnv = undeclaredEnvRule({
  files: buildModules(join(obsidian, "vite.config.ts")),
  tasks: Object.fromEntries(
    ["build:dev", "dev"].map((task) => {
      const local = turbo.tasks[task]?.env;
      const inherited = rootTurbo.tasks[task]?.env ?? [];
      return [
        task,
        local?.flatMap((name) =>
          name === "$TURBO_EXTENDS$" ? inherited : [name],
        ) ?? inherited,
      ];
    }),
  ),
});

export default {
  meta: { name: "zotlit-build" },
  rules: { "no-undeclared-env": noUndeclaredEnv },
};
