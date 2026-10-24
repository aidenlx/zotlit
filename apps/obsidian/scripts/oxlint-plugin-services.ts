// zotlit-services: the mechanical part of the Obsidian service architecture
// (policies/services.md, policies/events.md): Effect services over legacy
// classes, tag ids, Scope-owned resources, CLI registration, workers on
// effect/rpc, and Effect-native events. Rule tests: src/lint/services.test.ts.
import { isMemberOf } from "./oxlint-ast.ts";
import type { AstNode, Rule } from "./oxlint-ast.ts";

const EFFECT_GENERATOR_CALLEES = new Set(["gen", "fn", "fnUntraced"]);

const EFFECT = new Set(["Effect"]);

/** `Effect.<name>`, where `name` is one of `names`. */
function isEffectMember(
  node: AstNode | undefined,
  names: ReadonlySet<string>,
): boolean {
  return isMemberOf(node, EFFECT, (name) => names.has(name));
}

/**
 * A generator handed to `Effect.gen(…)`, `Effect.fnUntraced(…)`, or
 * `Effect.fn("name")(…)`: its body runs as Effect.
 */
function isEffectGenerator(node: AstNode): boolean {
  if (node.type !== "FunctionExpression" || !node.generator) return false;
  const call = node.parent;
  if (call?.type !== "CallExpression" || !call.arguments?.includes(node))
    return false;
  const { callee } = call;
  return (
    isEffectMember(callee, EFFECT_GENERATOR_CALLEES) ||
    (callee?.type === "CallExpression" &&
      isEffectMember(callee.callee, EFFECT_GENERATOR_CALLEES))
  );
}

/** `x[Symbol.dispose]` or `x[Symbol.asyncDispose]`. */
function isDisposeKey(node: AstNode | undefined): boolean {
  const key = node?.computed ? node.property : undefined;
  return (
    node?.type === "MemberExpression" &&
    key?.type === "MemberExpression" &&
    key.object?.type === "Identifier" &&
    key.object.name === "Symbol" &&
    (key.property?.name === "dispose" || key.property?.name === "asyncDispose")
  );
}

/**
 * Inside Effect, a resource's lifetime is its Scope (policies/resource-disposal.md
 * → Effect code). Checks the generator's own body; a callback nested in it,
 * such as the release of `Effect.acquireRelease`, is its own function.
 */
export const effectNativeResources: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require Scope-managed resources in Effect generators.",
    },
    messages: {
      stack:
        "Acquire with Effect.acquireRelease or Effect.addFinalizer; the generator's Scope owns its resources.",
      using:
        "Acquire with Effect.acquireRelease, or acquireDisposable from @/lib/effect-scope for a Disposable; the generator's Scope owns its resources.",
      dispose:
        "Release through the Scope: Effect.acquireRelease, Effect.addFinalizer, or acquireDisposable from @/lib/effect-scope.",
    },
    schema: [],
  },
  create(context) {
    const functions: boolean[] = [];
    const inEffect = () => functions.at(-1) === true;
    const enter = (node: unknown) =>
      functions.push(isEffectGenerator(node as AstNode));
    const exit = () => functions.pop();
    return {
      FunctionDeclaration: enter,
      "FunctionDeclaration:exit": exit,
      FunctionExpression: enter,
      "FunctionExpression:exit": exit,
      ArrowFunctionExpression: enter,
      "ArrowFunctionExpression:exit": exit,
      VariableDeclaration(node) {
        if (
          inEffect() &&
          (node.kind === "using" || node.kind === "await using")
        )
          context.report({ node, messageId: "using" });
      },
      NewExpression(node) {
        if (
          inEffect() &&
          node.callee.type === "Identifier" &&
          (node.callee.name === "DisposableStack" ||
            node.callee.name === "AsyncDisposableStack")
        )
          context.report({ node, messageId: "stack" });
      },
      CallExpression(node) {
        if (inEffect() && isDisposeKey(node.callee as AstNode))
          context.report({ node, messageId: "dispose" });
      },
    };
  },
};

/**
 * New services are Effect services (`/obsidian-services`). A legacy service
 * keeps its class until it converts; oxlint.config.ts lists those files.
 */
export const noLegacyService: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require new services to be Effect services.",
    },
    messages: {
      legacy:
        "Build a new service as a Context.Service tag with a scoped Layer in pluginLayer (/obsidian-services → Effect services).",
    },
    schema: [],
  },
  create(context) {
    const check = ({ superClass }: { superClass?: AstNode | null }) => {
      if (superClass?.type === "Identifier" && superClass.name === "Service")
        context.report({ node: superClass as never, messageId: "legacy" });
    };
    return { ClassDeclaration: check, ClassExpression: check };
  },
};

const TAG_ID = /^zotlit\/[a-z0-9-]+\/[A-Z][A-Za-z0-9]*$/;

/** `Context.Service<…>()("id")`: the id names the module and the service. */
export const serviceTagId: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require Context.Service ids of the form zotlit/<module>/<Name>.",
    },
    messages: {
      id: 'Name the tag "zotlit/<module>/<Name>": the module it belongs to, then its class.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const inner = node.callee;
        if (
          inner.type !== "CallExpression" ||
          inner.callee.type !== "MemberExpression" ||
          inner.callee.object.type !== "Identifier" ||
          inner.callee.object.name !== "Context" ||
          inner.callee.property.type !== "Identifier" ||
          inner.callee.property.name !== "Service"
        )
          return;
        const [id] = node.arguments;
        if (
          id?.type !== "Literal" ||
          typeof id.value !== "string" ||
          !TAG_ID.test(id.value)
        )
          context.report({ node: id ?? node, messageId: "id" });
      },
    };
  },
};

/**
 * `<plugin>.registerCliHandler(…)`: a zotlit:* command registers an Effect
 * handler through `registerCliCommand`, which the plugin runs on its runtime.
 * The plugin's own `this`/`super` calls are the boundary itself.
 */
export const cliCommandRegistration: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Register a zotlit:* command through registerCliCommand, not registerCliHandler.",
    },
    messages: {
      handler:
        "Register the command with host.registerCliCommand and an Effect handler (src/lib/cli-command.ts).",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.property.type === "Identifier" &&
          callee.property.name === "registerCliHandler" &&
          callee.object.type !== "Super" &&
          callee.object.type !== "ThisExpression"
        )
          context.report({ node: callee.property, messageId: "handler" });
      },
    };
  },
};

interface WorkerNode extends AstNode {
  readonly expression?: WorkerNode;
  readonly typeAnnotation?: WorkerNode;
  readonly typeName?: WorkerNode;
}

function memberName(node: AstNode): unknown {
  return node.computed ? node.property?.value : node.property?.name;
}

function workerType(node: WorkerNode | undefined): boolean {
  if (!node) return false;
  if (node.type === "TSTypeAnnotation") return workerType(node.typeAnnotation);
  return (
    node.type === "TSTypeReference" &&
    ["Worker", "DedicatedWorkerGlobalScope", "WorkerGlobalScope"].includes(
      String(node.typeName?.name),
    )
  );
}

/** Worker transports follow ZoteroReads; file exceptions live in oxlint.config.ts. */
export const workerRpc: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Run workers on effect/rpc." },
    messages: {
      rpc: "Run the worker on effect/rpc; follow src/services/zotero-reads/{rpc,worker,worker-launch,worker-host,in-process}.ts.",
    },
    schema: [],
  },
  create(context) {
    const isConstructor = (node: AstNode) =>
      (node.type === "Identifier" && node.name === "Worker") ||
      (node.type === "MemberExpression" && memberName(node) === "Worker");
    const isWorker = (
      node: WorkerNode | undefined,
      seen = new Set<AstNode>(),
    ): boolean => {
      if (!node || seen.has(node)) return false;
      seen.add(node);
      if (workerType(node.typeAnnotation)) return true;
      if (
        node.type === "TSAsExpression" ||
        node.type === "TSNonNullExpression" ||
        node.type === "ChainExpression"
      )
        return isWorker(node.expression, seen);
      if (node.type === "NewExpression")
        return !!node.callee && isConstructor(node.callee);
      if (node.type === "MemberExpression")
        return (
          String(memberName(node)).toLowerCase().endsWith("worker") ||
          memberName(node) === "self"
        );
      if (node.type !== "Identifier" || typeof node.name !== "string")
        return false;
      for (
        let scope = context.sourceCode.getScope(node as never);
        scope;
        scope = scope.upper!
      ) {
        const variable = scope.set.get(node.name);
        if (!variable) continue;
        for (const definition of variable.defs) {
          if (workerType((definition.name as WorkerNode).typeAnnotation))
            return true;
          if (
            definition.node.type === "VariableDeclarator" &&
            isWorker(definition.node.init as WorkerNode, seen)
          )
            return true;
        }
        break;
      }
      return node.name === "self" || node.name.toLowerCase().endsWith("worker");
    };
    return {
      NewExpression(node) {
        if (isConstructor(node.callee as AstNode))
          context.report({ node, messageId: "rpc" });
      },
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== "MemberExpression" ||
          !isWorker(callee.object as WorkerNode)
        )
          return;
        const method = memberName(callee as AstNode);
        if (
          method === "postMessage" ||
          ((method === "addEventListener" ||
            method === "on" ||
            method === "once") &&
            node.arguments[0]?.type === "Literal" &&
            node.arguments[0].value === "message")
        )
          context.report({ node, messageId: "rpc" });
      },
      AssignmentExpression(node) {
        if (
          node.left.type === "MemberExpression" &&
          memberName(node.left as AstNode) === "onmessage" &&
          isWorker(node.left.object as WorkerNode)
        )
          context.report({ node, messageId: "rpc" });
      },
    };
  },
};

interface EventNode extends AstNode {
  readonly key?: AstNode;
  readonly source?: AstNode | null;
}

/**
 * Events are Streams and state: a `SubscriptionRef` for what consumers watch,
 * a `PubSub` Stream for occurrences (policies/events.md). Tests are checked
 * too, since a fake emitter keeps the legacy shape alive in its consumers.
 * Legacy emitters stay on a backlog list in oxlint.config.ts until each
 * service converts.
 */
export const noNanoevents: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Require Effect-native events over nanoevents." },
    messages: {
      nanoevents:
        "Expose events as Streams and state: a SubscriptionRef for watched state, a PubSub Stream for occurrences (policies/events.md).",
    },
    schema: [],
  },
  create(context) {
    const check = (node: unknown) => {
      const { source } = node as EventNode;
      if (
        source?.type === "Literal" &&
        typeof source.value === "string" &&
        /(^|\/)nanoevents$/.test(source.value)
      )
        context.report({ node: source as never, messageId: "nanoevents" });
    };
    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
    };
  },
};

const EMITTER_KEYS = new Set(["on", "subscribe"]);

/** The name of a non-computed property, method, or signature key. */
function keyName(node: EventNode): string | undefined {
  const key = node.computed ? undefined : node.key;
  if (key?.type === "Identifier") return String(key.name);
  if (key?.type === "Literal" && typeof key.value === "string")
    return key.value;
  return undefined;
}

/**
 * A plain adapter (`<service>/plain.ts`) hands out its service's Streams and
 * state. Plain code subscribes with `subscribe(runtime, stream, callback)`
 * from `@/lib/effect-stream`. The helper attaches before returning, isolates
 * each callback's failures, and goes quiet after runtime disposal. An
 * adapter's own `on`/`subscribe` would each have to re-earn those guarantees.
 */
export const plainAdapterStreams: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid emitter-shaped on/subscribe members on plain adapters.",
    },
    messages: {
      emitter:
        "Expose the Stream or state instead of `{{name}}`; plain code subscribes with subscribe(runtime, stream, callback) from @/lib/effect-stream (policies/events.md).",
    },
    schema: [],
  },
  create(context) {
    const check = (node: unknown) => {
      const member = node as EventNode;
      const name = keyName(member);
      if (name && EMITTER_KEYS.has(name))
        context.report({
          node: member.key as never,
          messageId: "emitter",
          data: { name },
        });
    };
    return {
      Property: check,
      MethodDefinition: check,
      PropertyDefinition: check,
      TSMethodSignature: check,
      TSPropertySignature: check,
    };
  },
};

/**
 * Inside a layer, Obsidian events enter through `obsidianEvents` from
 * `@/lib/effect-obsidian-events`, which gives one ordered intake and a failure
 * boundary per event. A bare `registerEvent` gives neither. A function nested
 * in an Effect generator counts too, such as the acquire callback of
 * `acquireDisposable`.
 */
export const obsidianEventsIntake: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require obsidianEvents for Obsidian events in a layer.",
    },
    messages: {
      intake:
        "Register Obsidian events through obsidianEvents from @/lib/effect-obsidian-events: one ordered intake with a failure boundary per event (policies/events.md).",
    },
    schema: [],
  },
  create(context) {
    const insideEffect = (node: AstNode) => {
      for (let at = node.parent; at; at = at.parent)
        if (isEffectGenerator(at)) return true;
      return false;
    };
    return {
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "registerEvent" &&
          insideEffect(node as AstNode)
        )
          context.report({ node, messageId: "intake" });
      },
    };
  },
};

export default {
  meta: { name: "zotlit-services" },
  rules: {
    "cli-command-registration": cliCommandRegistration,
    "effect-native-resources": effectNativeResources,
    "no-legacy-service": noLegacyService,
    "no-nanoevents": noNanoevents,
    "obsidian-events-intake": obsidianEventsIntake,
    "plain-adapter-streams": plainAdapterStreams,
    "service-tag-id": serviceTagId,
    "worker-rpc": workerRpc,
  },
};
