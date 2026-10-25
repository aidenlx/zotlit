// zotlit-effect-style: the Effect v4 code style
// (https://effect.website/docs/v4/code-style/guidelines). Rejects a tacit
// (point-free) callback passed to an `effect` combinator, and `flow`. Rule
// tests: src/lint/effect-style.test.ts.
import type { AstNode, Rule } from "./oxlint-ast.ts";

/**
 * Combinators whose last parameter is a callback that the combinator calls
 * with arguments, in every overload, by `effect` module. Checked against the
 * installed `dist/*.d.ts`. In both the data-first and the data-last form the
 * callback is the last argument, so the rule reads only that one.
 *
 * Left out on purpose: a parameter that also takes a value (`Effect.andThen`,
 * `Effect.tap`); a zero-argument thunk (`Effect.sync`, `Effect.suspend`,
 * `Option.getOrElse`), which gets no argument to misread; an `Order` or
 * `Equivalence` (`Array.sort`, `Array.dedupeWith`), a value that is callable;
 * a function that wraps a function (`Option.liftPredicate`,
 * `Effect.effectify`, `Effect.fn`), where the reference is the point; and a
 * callback inside an object (`Option.match({ onNone, onSome })`).
 */
const CALLBACK_LAST: Readonly<Record<string, ReadonlySet<string>>> = {
  Effect: new Set([
    "acquireRelease",
    "acquireUseRelease",
    "addFinalizer",
    "bind",
    "callback",
    "catch",
    "catchCause",
    "catchCauseFilter",
    "catchCauseIf",
    "catchDefect",
    "catchFilter",
    "catchIf",
    "catchReason",
    "catchTag",
    "clockWith",
    "contextWith",
    "filter",
    "filterMap",
    "filterMapEffect",
    "filterMapOrElse",
    "filterMapOrFail",
    "filterOrElse",
    "filterOrFail",
    "findFirst",
    "flatMap",
    "forEach",
    "interruptibleMask",
    "let",
    "map",
    "mapError",
    "onError",
    "onErrorFilter",
    "onErrorIf",
    "onExit",
    "onExitFilter",
    "onExitIf",
    "onInterrupt",
    "partition",
    "promise",
    "reduce",
    "repeatOrElse",
    "retryOrElse",
    "scopedWith",
    "tapCause",
    "tapCauseFilter",
    "tapCauseIf",
    "tapDefect",
    "tapError",
    "tapErrorTag",
    "tryPromise",
    "uninterruptibleMask",
    "updateContext",
    "updateService",
    "withFiber",
    "zipWith",
  ]),
  Stream: new Set([
    "bind",
    "bindEffect",
    "callback",
    "catch",
    "catchCause",
    "catchCauseFilter",
    "catchCauseIf",
    "catchDefect",
    "catchFilter",
    "catchIf",
    "catchReason",
    "catchTag",
    "dropUntil",
    "dropUntilEffect",
    "dropWhile",
    "dropWhileEffect",
    "dropWhileFilter",
    "filter",
    "filterEffect",
    "filterMap",
    "filterMapEffect",
    "flatMap",
    "groupAdjacentBy",
    "groupBy",
    "groupByKey",
    "iterate",
    "let",
    "map",
    "mapAccum",
    "mapAccumArray",
    "mapAccumArrayEffect",
    "mapAccumEffect",
    "mapArray",
    "mapArrayEffect",
    "mapEffect",
    "mapError",
    "onError",
    "onExit",
    "onFirst",
    "paginate",
    "partition",
    "partitionEffect",
    "runFold",
    "runFoldEffect",
    "runForEach",
    "runForEachArray",
    "runForEachWhile",
    "scan",
    "scanEffect",
    "split",
    "switchMap",
    "takeUntil",
    "takeUntilEffect",
    "takeWhile",
    "takeWhileEffect",
    "takeWhileFilter",
    "tap",
    "tapCause",
    "tapDefect",
    "tapError",
    "tapErrorTag",
    "unfold",
    "updateContext",
    "updateService",
    "zipLatestWith",
    "zipWith",
    "zipWithArray",
  ]),
  Option: new Set([
    "bind",
    "exists",
    "filter",
    "filterMap",
    "flatMap",
    "flatMapNullishOr",
    "let",
    "map",
    "partitionMap",
    "tap",
    "zipWith",
  ]),
  Result: new Set([
    "bind",
    "filterOrFail",
    "flatMap",
    "fromNullishOr",
    "getOrElse",
    "getOrThrowWith",
    "let",
    "map",
    "mapError",
    "orElse",
    "tap",
  ]),
  Exit: new Set(["map", "mapError"]),
  Cause: new Set(["map"]),
  Layer: new Set([
    "catch",
    "catchCause",
    "catchTag",
    "flatMap",
    "fromBuild",
    "fromBuildMemo",
    "tap",
    "tapCause",
    "tapError",
    "updateService",
  ]),
  Schedule: new Set(["addDelay", "map", "modifyDelay", "tap", "while"]),
  Ref: new Set([
    "getAndUpdate",
    "getAndUpdateSome",
    "modify",
    "modifySome",
    "update",
    "updateAndGet",
    "updateSome",
    "updateSomeAndGet",
  ]),
  SubscriptionRef: new Set([
    "getAndUpdate",
    "getAndUpdateEffect",
    "getAndUpdateSome",
    "getAndUpdateSomeEffect",
    "modify",
    "modifyEffect",
    "modifySome",
    "modifySomeEffect",
    "update",
    "updateAndGet",
    "updateAndGetEffect",
    "updateEffect",
    "updateSome",
    "updateSomeAndGet",
    "updateSomeAndGetEffect",
    "updateSomeEffect",
  ]),
  Array: new Set([
    "bind",
    "cartesianWith",
    "chop",
    "countBy",
    "dropWhile",
    "every",
    "extend",
    "filter",
    "filterMap",
    "findFirst",
    "findFirstIndex",
    "findFirstWithIndex",
    "findLast",
    "findLastIndex",
    "flatMap",
    "flatMapNullishOr",
    "forEach",
    "groupBy",
    "let",
    "makeBy",
    "map",
    "mapAccum",
    "modify",
    "partition",
    "reduce",
    "reduceRight",
    "scan",
    "scanRight",
    "some",
    "span",
    "splitWhere",
    "takeWhile",
    "unfold",
    "zipWith",
  ]),
  SchemaGetter: new Set([
    "map",
    "transform",
    "transformEffect",
    "transformOptional",
    "transformOptionalEffect",
  ]),
};

/**
 * Combinators that take an options object after the callback
 * (`Effect.forEach(items, f, { concurrency })`). An object literal in the
 * last place is skipped; an options object passed by name is not told apart
 * from a callback.
 */
const OPTIONS_AFTER = new Set([
  "Effect.acquireRelease",
  "Effect.filter",
  "Effect.filterMapEffect",
  "Effect.forEach",
  "Effect.partition",
  "Effect.zipWith",
  "Stream.bind",
  "Stream.bindEffect",
  "Stream.callback",
  "Stream.flatMap",
  "Stream.groupBy",
  "Stream.groupByKey",
  "Stream.mapAccum",
  "Stream.mapAccumArray",
  "Stream.mapAccumArrayEffect",
  "Stream.mapAccumEffect",
  "Stream.mapEffect",
  "Stream.partition",
  "Stream.partitionEffect",
  "Stream.switchMap",
  "Stream.takeUntil",
  "Stream.takeUntilEffect",
  "Stream.tap",
]);

/** The `effect` module that exports `flow`. */
const FUNCTION_MODULE = "Function";

interface ImportSpecifier {
  readonly type: string;
  readonly importKind?: string;
  readonly local: { readonly name: string };
  readonly imported?: {
    readonly name?: string;
    readonly value?: string;
  };
}

/**
 * The `effect` modules a file names: `import { Effect, Array as Arr } from
 * "effect"` or `import * as Effect from "effect/Effect"`, by local name.
 * `flow` imported on its own is recorded under the name it takes.
 */
interface EffectNames {
  readonly modules: Map<string, string>;
  readonly flow: Set<string>;
}

function collectNames(
  source: string,
  specifiers: readonly ImportSpecifier[],
  names: EffectNames,
): void {
  const submodule = source.startsWith("effect/")
    ? source.slice("effect/".length)
    : undefined;
  for (const specifier of specifiers) {
    if (specifier.importKind === "type") continue;
    const imported = specifier.imported?.name ?? specifier.imported?.value;
    const local = specifier.local.name;
    if (specifier.type === "ImportNamespaceSpecifier" && submodule)
      names.modules.set(local, submodule);
    else if (specifier.type !== "ImportSpecifier") continue;
    else if (
      imported === "flow" &&
      (source === "effect" || submodule === FUNCTION_MODULE)
    )
      names.flow.add(local);
    else if (source === "effect" && typeof imported === "string")
      names.modules.set(local, imported);
  }
}

/** `<module>.<name>` when `callee` is a member of a named `effect` module. */
function combinator(
  callee: AstNode | undefined,
  names: EffectNames,
): string | undefined {
  if (
    callee?.type !== "MemberExpression" ||
    callee.computed ||
    callee.object?.type !== "Identifier" ||
    callee.property?.type !== "Identifier"
  )
    return undefined;
  const module = names.modules.get(callee.object.name as string);
  return module && `${module}.${callee.property.name as string}`;
}

/** The argument in the callback's place: the last, before an options literal. */
function callbackArgument(
  name: string,
  args: readonly AstNode[],
): AstNode | undefined {
  const last = args.at(-1);
  if (last?.type === "ObjectExpression" && OPTIONS_AFTER.has(name))
    return args.at(-2);
  return last;
}

/** A function passed by name: `fn`, `service.method`, `Effect.fail`. */
function isReference(node: AstNode | undefined): boolean {
  return node?.type === "Identifier" || node?.type === "MemberExpression";
}

/**
 * The Effect v4 code style asks for `Effect.map((x) => fn(x))`, not
 * `Effect.map(fn)` (code-style guidelines → Avoid Tacit Usage). A function
 * passed by name gets every argument the combinator passes, so an optional
 * parameter can take an index or an AbortSignal it was not written for; an
 * overloaded or generic function loses its generics; and the stack trace
 * loses the call site. The explicit lambda passes only the arguments it
 * names. `flow` builds the same tacit pipeline; `pipe` with lambdas replaces
 * it.
 */
export const noTacit: Rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Pass an explicit lambda, not a function by name, to an Effect combinator.",
    },
    messages: {
      tacit:
        "Pass an explicit lambda, `(x) => {{name}}(x)`, to {{combinator}}: a function passed by name gets every argument the combinator passes, and loses its generics and its stack frame.",
      flow: "Write `(x) => pipe(x, f, g)` or call the steps in a lambda instead of `flow`: a tacit pipeline loses its generics and its stack frames.",
    },
    schema: [],
  },
  create(context) {
    const names: EffectNames = { modules: new Map(), flow: new Set() };
    return {
      ImportDeclaration(node) {
        if (node.importKind === "type") return;
        collectNames(
          node.source.value,
          node.specifiers as readonly ImportSpecifier[],
          names,
        );
      },
      CallExpression(node) {
        const callee = node.callee as AstNode;
        if (
          (callee.type === "Identifier" &&
            names.flow.has(callee.name as string)) ||
          combinator(callee, names) === `${FUNCTION_MODULE}.flow`
        ) {
          context.report({ node, messageId: "flow" });
          return;
        }
        const name = combinator(callee, names);
        if (!name) return;
        const [module, member] = name.split(".") as [string, string];
        if (!CALLBACK_LAST[module]?.has(member)) return;
        const argument = callbackArgument(
          name,
          node.arguments as unknown as readonly AstNode[],
        );
        if (!argument || !isReference(argument)) return;
        context.report({
          node: argument as never,
          messageId: "tacit",
          data: {
            name: context.sourceCode.getText(argument as never),
            combinator: name,
          },
        });
      },
    };
  },
};

export default {
  meta: { name: "zotlit-effect-style" },
  rules: { "no-tacit": noTacit },
};
