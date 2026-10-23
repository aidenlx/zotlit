import { isMemberOf } from "./oxlint-ast.ts";
import type { AstNode, Rule } from "./oxlint-ast.ts";

const TEST_FUNCTIONS = new Set(["it", "test"]);
/** `it.<name>` forms whose body is an Effect, run by @effect/vitest. */
const EFFECT_TESTERS = new Set(["effect", "live", "layer", "prop"]);

/** Modules exporting the `Effect` namespace by that name. */
const EFFECT_NAMESPACE_MODULES = new Set(["effect", "@/lib/effect"]);
/** Modules that are the `Effect` namespace, run entry points included. */
const EFFECT_MODULES = new Set(["effect/Effect", "@/lib/effect-runtime"]);

const isRun = (name: string) => name.startsWith("run");

/**
 * The names a file runs an Effect through: namespaces whose `run…` members
 * run one, and `run…` functions imported on their own.
 */
interface RunNames {
  readonly namespaces: Set<string>;
  readonly functions: Set<string>;
}

interface ImportSpecifier {
  readonly type: string;
  readonly local: { readonly name: string };
  readonly imported?: {
    readonly type: string;
    readonly name?: string;
    readonly value?: string;
  };
}

function collectRunNames(
  source: string,
  specifiers: readonly ImportSpecifier[],
  names: RunNames,
): void {
  for (const specifier of specifiers) {
    const imported = specifier.imported?.name ?? specifier.imported?.value;
    if (EFFECT_NAMESPACE_MODULES.has(source)) {
      if (specifier.type === "ImportSpecifier" && imported === "Effect")
        names.namespaces.add(specifier.local.name);
    } else if (EFFECT_MODULES.has(source)) {
      if (specifier.type === "ImportNamespaceSpecifier")
        names.namespaces.add(specifier.local.name);
      else if (
        specifier.type === "ImportSpecifier" &&
        typeof imported === "string" &&
        isRun(imported)
      )
        names.functions.add(specifier.local.name);
    }
  }
}

/** `Effect.run…(…)` or an imported `run…(…)`: a run entry point. */
function isEffectRun(callee: AstNode | undefined, names: RunNames): boolean {
  return (
    isMemberOf(callee, names.namespaces, isRun) ||
    (callee?.type === "Identifier" &&
      names.functions.has(callee.name as string))
  );
}

/**
 * Whether `callee` is a plain Vitest case: `it(…)`, `test.only(…)`,
 * `it.each(…)(…)`, but not `it.effect(…)` or another Effect tester.
 */
function isPlainTestCall(callee: AstNode | undefined): boolean {
  let node = callee;
  let plain = true;
  while (node) {
    if (node.type === "Identifier")
      return plain && TEST_FUNCTIONS.has(node.name as string);
    if (node.type === "MemberExpression") {
      if (EFFECT_TESTERS.has(node.property?.name as string)) plain = false;
      node = node.object;
    } else if (node.type === "CallExpression") node = node.callee;
    else return false;
  }
  return false;
}

/** The plain test case `node` runs inside, if any. */
function inPlainTest(node: AstNode): boolean {
  for (let child = node, parent = node.parent; parent;) {
    if (
      parent.type === "CallExpression" &&
      parent.arguments?.includes(child) &&
      isPlainTestCall(parent.callee)
    )
      return true;
    child = parent;
    parent = parent.parent;
  }
  return false;
}

/**
 * An Effect test runs through `it.effect` from `@/lib/effect-vitest`
 * (policies/testing-strategy.md → Effect code), which supplies the plugin's
 * runtime services and the test services such as TestClock. A
 * `ManagedRuntime`'s own `run…` stays allowed: a plain adapter's test drives
 * the adapter through its runtime.
 */
export const noEffectRunInTest: Rule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require it.effect for a test that runs Effect code.",
    },
    messages: {
      run: "Write this case with it.effect from @/lib/effect-vitest and yield* the Effect; it runs with the plugin's runtime services and TestClock.",
    },
    schema: [],
  },
  create(context) {
    const names: RunNames = { namespaces: new Set(), functions: new Set() };
    return {
      ImportDeclaration(node) {
        if (node.importKind === "type") return;
        collectRunNames(
          node.source.value,
          node.specifiers as readonly ImportSpecifier[],
          names,
        );
      },
      CallExpression(node) {
        if (
          isEffectRun(node.callee as AstNode, names) &&
          inPlainTest(node as unknown as AstNode)
        )
          context.report({ node, messageId: "run" });
      },
    };
  },
};

export default {
  meta: { name: "zotlit-effect-tests" },
  rules: { "no-effect-run-in-test": noEffectRunInTest },
};
