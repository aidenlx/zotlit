// zotlit-effect-tests: Effect tests run inside the test runtime
// (policies/testing-strategy.md, policies/test-timing.md). Rejects running an
// Effect by hand in a test, real timers in an Effect case, and fake services
// cast to `Tag["Service"]` instead of built with stubService, and notice
// modules mocked instead of observed through the Notifier. Rule tests:
// src/lint/effect-tests.test.ts.
import { isMemberOf } from "./oxlint-ast.ts";
import type { AstNode, Rule } from "./oxlint-ast.ts";

const TEST_FUNCTIONS = new Set(["it", "test"]);
/** `it.<name>` forms whose body is an Effect, run by @effect/vitest. */
const EFFECT_TESTERS = new Set(["effect", "live", "layer", "prop"]);
/** Waits on the event loop's real time. */
const REAL_TIMERS = new Set([
  "setTimeout",
  "setInterval",
  "setImmediate",
  "delay",
  "sleep",
  "yieldToMain",
]);
const REAL_TIME_HOSTS = new Set(["globalThis", "window", "activeWindow"]);
/** Vitest's fake timers, which the TestClock replaces. */
const isViTimer = (name: string) => /Timers|SystemTime/.test(name);
const VI = new Set(["vi"]);

/** Modules exporting the `Effect` namespace by that name. */
const EFFECT_NAMESPACE_MODULES = new Set(["effect"]);
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
 * How a Vitest case runs its body: `it(…)`, `test.only(…)`, `it.each(…)(…)`
 * are plain; `it.effect(…)` and the other Effect testers run an Effect, on
 * the TestClock unless `live`. `undefined` when `callee` is no case.
 */
function caseKind(
  callee: AstNode | undefined,
): "plain" | "effect" | "live" | undefined {
  let node = callee;
  let kind: "plain" | "effect" | "live" = "plain";
  while (node) {
    if (node.type === "Identifier")
      return TEST_FUNCTIONS.has(node.name as string) ? kind : undefined;
    if (node.type === "MemberExpression") {
      const name = node.property?.name as string;
      if (name === "live") kind = "live";
      else if (EFFECT_TESTERS.has(name) && kind === "plain") kind = "effect";
      node = node.object;
    } else if (node.type === "CallExpression") node = node.callee;
    else return undefined;
  }
  return undefined;
}

/** How the innermost test case around `node` runs, if any. */
function enclosingCase(node: AstNode): ReturnType<typeof caseKind> {
  for (let child = node, parent = node.parent; parent;) {
    if (parent.type === "CallExpression" && parent.arguments?.includes(child)) {
      const kind = caseKind(parent.callee);
      if (kind) return kind;
    }
    child = parent;
    parent = parent.parent;
  }
  return undefined;
}

/**
 * An Effect test runs through `it.effect` from `@effect/vitest`
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
      run: "Write this case with it.effect from @effect/vitest and yield* the Effect; it runs with the plugin's runtime services and TestClock.",
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
          enclosingCase(node as unknown as AstNode) === "plain"
        )
          context.report({ node, messageId: "run" });
      },
    };
  },
};

/** A call that waits on, or fakes, the event loop's real time. */
function isRealTimer(callee: AstNode | undefined): boolean {
  return (
    (callee?.type === "Identifier" && REAL_TIMERS.has(callee.name as string)) ||
    isMemberOf(callee, REAL_TIME_HOSTS, (name) => REAL_TIMERS.has(name)) ||
    isMemberOf(callee, VI, isViTimer)
  );
}

/**
 * An Effect case's time is the TestClock (policies/test-timing.md → Effect):
 * a real timer makes it slow and flaky, and Vitest's fake timers do not move
 * Effect's clock. `it.live` keeps real time for real external async.
 */
export const noRealTimerInEffectTest: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require the TestClock for time inside an it.effect case.",
    },
    messages: {
      timer:
        "An it.effect case runs on the TestClock: sleep with Effect.sleep and advance with TestClock.adjust, or await a Queue or Deferred the code signals. Real external async belongs in it.live.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          isRealTimer(node.callee as AstNode) &&
          enclosingCase(node as unknown as AstNode) === "effect"
        )
          context.report({ node, messageId: "timer" });
      },
    };
  },
};

/** The TypeScript cast and type nodes the service-stub rule walks. */
type TsNode = AstNode & {
  readonly expression?: TsNode;
  readonly typeAnnotation?: TsNode;
  readonly indexType?: TsNode;
  readonly literal?: TsNode;
};

/** `Tag["Service"]`: the implementation type of an Effect service tag. */
function isServiceType(node: TsNode | undefined): boolean {
  if (node?.type !== "TSIndexedAccessType") return false;
  const index = node.indexType;
  return index?.type === "TSLiteralType" && index.literal?.value === "Service";
}

/** Whether an object literal sits under any `as` / `satisfies` wrapping. */
function castObject(node: TsNode | undefined): boolean {
  let at = node;
  while (at?.type === "TSAsExpression" || at?.type === "TSSatisfiesExpression")
    at = at.expression;
  return at?.type === "ObjectExpression";
}

/**
 * A fake service built as `{ … } as Tag["Service"]` compiles while it lacks
 * members, and a consumer that reads a missing one fails as `undefined` far
 * from the stub, or not at all until an adapter reads it eagerly. The
 * `stubService` helper from `@/lib/__fixtures__/service-stub` type-checks
 * each member it is given and names any other member a consumer reads.
 */
export const serviceStub: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Build a fake service with stubService, not `as Tag["Service"]`.',
    },
    messages: {
      stub: 'Build the fake with stubService<Tag["Service"]>("Tag", { … }) from @/lib/__fixtures__/service-stub: it checks each member and names a missing one when read.',
    },
    schema: [],
  },
  create(context) {
    return {
      TSAsExpression(node) {
        const cast = node as unknown as TsNode;
        // Report the outermost cast once, not each layer of `as unknown as`.
        if (cast.parent?.type === "TSAsExpression") return;
        if (isServiceType(cast.typeAnnotation) && castObject(cast.expression))
          context.report({ node, messageId: "stub" });
      },
    };
  },
};

/** Whether service-stub reports this cast: a literal cast to `Tag["Service"]`. */
function isServiceStubCase(cast: TsNode): boolean {
  return isServiceType(cast.typeAnnotation) && castObject(cast.expression);
}

/** Modules whose exports are Obsidian's host types and capability tags. */
const isHostModule = (source: string) =>
  source === "obsidian" || source.startsWith("@/lib/obsidian-");

/** Calls that take a service implementation or a capability's source. */
function takesFake(
  callee: AstNode | undefined,
  names: { readonly layer: Set<string>; readonly effect: Set<string> },
): boolean {
  if (callee?.type === "CallExpression") return takesFake(callee.callee, names);
  if (callee?.type === "Identifier") {
    const name = callee.name as string;
    return (
      name === "layerHost" ||
      name === "layerHostApp" ||
      /^layer\w*From$/.test(name)
    );
  }
  return (
    isMemberOf(
      callee,
      names.layer,
      (name) => name === "succeed" || name === "mock",
    ) ||
    isMemberOf(callee, names.effect, (name) => name === "provideService") ||
    (callee?.type === "MemberExpression" &&
      callee.object?.type === "Identifier" &&
      /^[A-Z]/.test(callee.object.name as string) &&
      callee.property?.type === "Identifier" &&
      callee.property.name === "of")
  );
}

/** The innermost value under `as` / `satisfies` / parentheses. */
function castValue(node: TsNode | undefined): TsNode | undefined {
  let at = node;
  while (
    at?.type === "TSAsExpression" ||
    at?.type === "TSSatisfiesExpression" ||
    at?.type === "ParenthesizedExpression"
  )
    at = at.expression;
  return at;
}

/** Every type name a type annotation references, `Pick<A["Service"], …>` included. */
function typeNames(node: unknown, names: string[] = []): string[] {
  if (!node || typeof node !== "object") return names;
  if (Array.isArray(node)) {
    for (const child of node) typeNames(child, names);
    return names;
  }
  const type = node as TsNode & {
    readonly typeName?: TsNode & { readonly left?: TsNode };
    readonly exprName?: TsNode;
  };
  if (type.type === "TSTypeReference") {
    let id = type.typeName;
    while (id?.type === "TSQualifiedName") id = id.left;
    if (id?.type === "Identifier") names.push(id.name as string);
  }
  for (const [key, child] of Object.entries(type))
    if (key !== "parent" && child && typeof child === "object")
      typeNames(child, names);
  return names;
}

function hasServiceIndex(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some(hasServiceIndex);
  if (isServiceType(node as TsNode)) return true;
  return Object.entries(node).some(
    ([key, child]) =>
      key !== "parent" &&
      child &&
      typeof child === "object" &&
      hasServiceIndex(child),
  );
}

/**
 * A test fake built as `{ … } as never`, `{ … } as unknown as App` or
 * `reads as never` given to `Layer.succeed` compiles whatever the real API
 * becomes: when a member turns from a method into an `Effect` value (#1737),
 * the fake still compiles and the test runs against a shape no code has. A
 * typed fake keeps typecheck on it (policies/testing-strategy.md → Effect
 * code): `Layer.mock(Tag, { … })` or `Layer.succeed(Tag, Tag.of({ … }))` for
 * a layer, `stubService<T>(name, { … })` for a value that a legacy consumer
 * takes, the capability test layers for Obsidian's host, and a type
 * annotation for plain Obsidian data. Reports a cast given to a call that
 * takes a fake, or in a property of its object argument, and an object
 * literal cast to a type from `obsidian` or `@/lib/obsidian-*`, a service
 * type, a `…Deps` type, or `never`.
 */
export const typedFake: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Build a test fake with its real type, not behind a cast.",
    },
    messages: {
      layer:
        "Give the layer a typed fake: Layer.mock(Tag, { … }) or Layer.succeed(Tag, Tag.of({ … })); a capability layer takes its in-memory source (Memory…) or layerHostApp(app).",
      host: "Type this Obsidian fake: a capability test layer (layerHostApp, Memory…) for Effect code, stubService<T>(name, { … }) from @/lib/__fixtures__/service-stub for an object with members, or a type annotation for plain data.",
      service:
        "Build this fake with stubService<T>(name, { … }) from @/lib/__fixtures__/service-stub, or Layer.mock(Tag, { … }) where a layer takes it: typecheck holds each member to the real shape.",
      never:
        "`as never` hides the fake's type: build it with stubService<T>(name, { … }), Layer.mock(Tag, { … }) or a typed value, so typecheck holds it to the real shape.",
    },
    schema: [],
  },
  create(context) {
    const names = { layer: new Set<string>(), effect: new Set<string>() };
    const host = new Set<string>();
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        for (const specifier of node.specifiers as readonly ImportSpecifier[]) {
          const imported =
            specifier.imported?.name ?? specifier.imported?.value;
          if (isHostModule(source)) host.add(specifier.local.name);
          if (node.importKind === "type") continue;
          if (source === "effect" && imported === "Layer")
            names.layer.add(specifier.local.name);
          else if (source === "effect" && imported === "Effect")
            names.effect.add(specifier.local.name);
          else if (specifier.type === "ImportNamespaceSpecifier") {
            if (source === "effect/Layer")
              names.layer.add(specifier.local.name);
            if (source === "effect/Effect")
              names.effect.add(specifier.local.name);
          }
        }
      },
      TSAsExpression(node) {
        const cast = node as unknown as TsNode;
        // Report the outermost cast once, not each layer of `as unknown as`.
        if (cast.parent?.type === "TSAsExpression") return;
        const target = cast.typeAnnotation;
        if (
          target?.type === "TSUnknownKeyword" ||
          target?.type === "TSAnyKeyword" ||
          (target?.type === "TSTypeReference" &&
            (target as TsNode & { typeName?: TsNode }).typeName?.name ===
              "const")
        )
          return;
        if (isServiceStubCase(cast)) return;
        let argument: AstNode = cast;
        let parent = cast.parent;
        while (
          parent?.type === "ParenthesizedExpression" ||
          parent?.type === "TSSatisfiesExpression"
        ) {
          argument = parent;
          parent = parent.parent;
        }
        // A cast in a property of the argument, as `layerHost({ vault: … })`.
        if (
          parent?.type === "Property" &&
          parent.value === argument &&
          parent.parent
        ) {
          argument = parent.parent;
          parent = argument.parent;
        }
        if (
          parent?.type === "CallExpression" &&
          parent.arguments?.includes(argument) &&
          takesFake(parent.callee, names)
        )
          return context.report({ node, messageId: "layer" });
        if (castValue(cast.expression)?.type !== "ObjectExpression") return;
        const referenced = typeNames(target);
        if (referenced.some((name) => host.has(name)))
          return context.report({ node, messageId: "host" });
        if (
          hasServiceIndex(target) ||
          referenced.some((name) => name.endsWith("Deps"))
        )
          return context.report({ node, messageId: "service" });
        if (target?.type === "TSNeverKeyword")
          context.report({ node, messageId: "never" });
      },
    };
  },
};

/** The notice modules a test reaches only by mocking them. */
const NOTICE_MODULES = new Set(["@/lib/notice", "@/lib/toast"]);

/**
 * A test that mocks a notice module asserts what the seam renders, not what
 * the core returns (policies/ui-seams.md): the module behind it moves behind
 * the Notifier, and the test reads its calls through `testNotifier()`.
 */
export const noNoticeMock: Rule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Observe notices through the Notifier, not a module mock.",
    },
    messages: {
      mock: "Move the module behind the Notifier and observe its notices with testNotifier() from @/lib/__fixtures__/notifier (policies/ui-seams.md).",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const source = node.arguments?.[0] as AstNode | undefined;
        if (
          isMemberOf(
            node.callee as AstNode,
            VI,
            (name) => name === "mock" || name === "doMock",
          ) &&
          source?.type === "Literal" &&
          NOTICE_MODULES.has(source.value as string)
        )
          context.report({ node, messageId: "mock" });
      },
    };
  },
};

export default {
  meta: { name: "zotlit-effect-tests" },
  rules: {
    "no-effect-run-in-test": noEffectRunInTest,
    "no-notice-mock": noNoticeMock,
    "no-real-timer-in-effect-test": noRealTimerInEffectTest,
    "service-stub": serviceStub,
    "typed-fake": typedFake,
  },
};
