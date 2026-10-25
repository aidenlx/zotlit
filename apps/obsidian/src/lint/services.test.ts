import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import {
  cliCommandRegistration,
  clockTime,
  effectNativeResources,
  interruptPredicate,
  noDefaultRuntime,
  noLegacyService,
  noNanoevents,
  layerStreamConsumer,
  obsidianCapabilities,
  plainAdapterStreams,
  scopeClosed,
  serviceTagId,
  temporalInEffect,
  workerRpc,
} from "../../scripts/oxlint-plugin-services";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

tester.run("effect-native-resources", effectNativeResources, {
  valid: [
    // The release callback is its own function, not the generator's body.
    `Effect.gen(function* () {
      yield* Effect.acquireRelease(acquire, (d) => Effect.sync(() => d[Symbol.dispose]()));
    })`,
    // Outside Effect, stacks are the house pattern.
    `async function load() {
      await using stack = new AsyncDisposableStack();
      stack.defer(close);
    }`,
    // A generator Effect does not run.
    `function* items() { using lock = take(); yield lock; }`,
    `Effect.fnUntraced(function* () { yield* Effect.acquireDisposable(Effect.sync(() => registerEvent(ref))); })`,
  ],
  invalid: [
    {
      code: "Effect.gen(function* () { using sub = registerEvent(ref); })",
      errors: [{ messageId: "using" }],
    },
    {
      code: "Effect.fnUntraced(function* () { const stack = new AsyncDisposableStack(); })",
      errors: [{ messageId: "stack" }],
    },
    {
      code: 'Effect.fn("load")(function* () { sub[Symbol.dispose](); })',
      errors: [{ messageId: "dispose" }],
    },
    {
      code: "Effect.gen(function* () { yield* Effect.promise(() => 0); service[Symbol.asyncDispose](); })",
      errors: [{ messageId: "dispose" }],
    },
  ],
});

tester.run("no-legacy-service", noLegacyService, {
  valid: [
    'class UseLedger extends Context.Service<UseLedger, Shape>()("zotlit/use-ledger/UseLedger") {}',
    "class Panel extends ItemView {}",
  ],
  invalid: [
    {
      code: "class Thing extends Service {}",
      errors: [{ messageId: "legacy" }],
    },
    {
      code: "const Thing = class extends Service<State> {};",
      errors: [{ messageId: "legacy" }],
    },
  ],
});

tester.run("service-tag-id", serviceTagId, {
  valid: [
    'class Connection extends Context.Service<Connection, Shape>()("zotlit/zotero-reads/Connection") {}',
    'class ObsidianApp extends Context.Service<ObsidianApp, App>()("zotlit/obsidian/ObsidianApp") {}',
  ],
  invalid: [
    {
      code: 'class Probe extends Context.Service<Probe, Shape>()("test/Probe") {}',
      errors: [{ messageId: "id" }],
    },
    {
      code: 'class Probe extends Context.Service<Probe, Shape>()("zotlit/UseLedger") {}',
      errors: [{ messageId: "id" }],
    },
  ],
});

tester.run("cli-command-registration", cliCommandRegistration, {
  valid: [
    `host.registerCliCommand("zotlit:a", "A", null, handler)`,
    // ZotLitPlugin's own boundary.
    `class P { registerCliHandler() { super.registerCliHandler(a, b, c, d); } }`,
    `class P { run() { this.registerCliHandler(a, b, c, d); } }`,
  ],
  invalid: [
    {
      code: `plugin.registerCliHandler("zotlit:a", "A", null, handler)`,
      errors: [{ messageId: "handler" }],
    },
  ],
});

tester.run("worker-rpc", workerRpc, {
  valid: [
    'window.postMessage(data, "*")',
    "port.postMessage(data)",
    'port.addEventListener("message", receive)',
    "port.onmessage = receive",
    'worker.addEventListener("error", fail)',
    'worker.removeEventListener("message", receive)',
    "const task = new MessageChannel(); task.port2.postMessage(null)",
  ],
  invalid: [
    { code: "new Worker(url)", errors: [{ messageId: "rpc" }] },
    { code: "new globalThis.Worker(url)", errors: [{ messageId: "rpc" }] },
    { code: "worker.postMessage(data)", errors: [{ messageId: "rpc" }] },
    { code: "self.postMessage(data)", errors: [{ messageId: "rpc" }] },
    { code: "this.worker.postMessage(data)", errors: [{ messageId: "rpc" }] },
    { code: 'worker?.["postMessage"](data)', errors: [{ messageId: "rpc" }] },
    {
      code: "function send(endpoint: Worker) { endpoint.postMessage(data) }",
      errors: [{ messageId: "rpc" }],
    },
    {
      code: "const task: Worker = getTask(); const endpoint = task; endpoint.postMessage(data)",
      errors: [{ messageId: "rpc" }],
    },
    {
      code: "const endpoint = new Worker(url); endpoint.postMessage(data)",
      errors: [{ messageId: "rpc" }, { messageId: "rpc" }],
    },
    {
      code: 'worker.addEventListener("message", receive)',
      errors: [{ messageId: "rpc" }],
    },
    {
      code: 'self["addEventListener"]("message", receive)',
      errors: [{ messageId: "rpc" }],
    },
    { code: "self.onmessage = receive", errors: [{ messageId: "rpc" }] },
    { code: 'worker["onmessage"] = receive', errors: [{ messageId: "rpc" }] },
  ],
});

tester.run("no-nanoevents", noNanoevents, {
  valid: [
    'import { PubSub, SubscriptionRef } from "effect";',
    'import { subscribe } from "@/lib/effect-stream";',
  ],
  invalid: [
    {
      code: 'import { createNanoEvents } from "@zotlit/shared/nanoevents";',
      errors: [{ messageId: "nanoevents" }],
    },
    {
      code: 'import { createNanoEvents } from "nanoevents";',
      errors: [{ messageId: "nanoevents" }],
    },
    {
      code: 'export { createNanoEvents } from "@zotlit/shared/nanoevents";',
      errors: [{ messageId: "nanoevents" }],
    },
    {
      code: 'const events = await import("nanoevents");',
      errors: [{ messageId: "nanoevents" }],
    },
  ],
});

tester.run("plain-adapter-streams", plainAdapterStreams, {
  valid: [
    // The adapter hands out the Stream; plain code subscribes through the helper.
    `export function plainProfile(runtime) {
      return { changes: Profile.changes, current: () => runtime.runSync(Profile.current) };
    }`,
    `const stop = subscribe(runtime, adapter.changes, refresh);`,
    "interface PlainProfile { readonly changes: Stream.Stream<Snapshot>; }",
  ],
  invalid: [
    {
      code: "const adapter = { on(event, callback) { return () => {}; } };",
      errors: [{ messageId: "emitter" }],
    },
    {
      code: "const adapter = { subscribe: (callback) => () => {} };",
      errors: [{ messageId: "emitter" }],
    },
    {
      code: 'interface PlainIndex { on(event: "changed", callback: () => void): () => void; }',
      errors: [{ messageId: "emitter" }],
    },
    {
      code: "interface PlainSettings { subscribe: (callback: () => void) => () => void; }",
      errors: [{ messageId: "emitter" }],
    },
    {
      code: "class PlainLookup { on() {} }",
      errors: [{ messageId: "emitter" }],
    },
  ],
});

tester.run("layer-stream-consumer", layerStreamConsumer, {
  valid: [
    `Effect.gen(function* () { yield* forkEach(settings.changes, apply); })`,
    // Plain code bridges into the runtime.
    `function attach(runtime) { return subscribe(runtime, changes, apply); }`,
    // A per-call observer returns its unsubscribe to a plain caller.
    `Effect.gen(function* () {
      return { observe: (cb) => subscribe(runner, changes, cb) };
    })`,
  ],
  invalid: [
    {
      code: `Effect.gen(function* () { subscribe(runner, settings.changes, apply); })`,
      errors: [{ messageId: "forkEach" }],
    },
    {
      code: `Effect.fn("layer")(function* () {
        const off = subscribe(runner, changes, apply);
      })`,
      errors: [{ messageId: "forkEach" }],
    },
  ],
});

tester.run("interrupt-predicate", interruptPredicate, {
  valid: [
    "const quiet = Cause.hasInterruptsOnly(cause);",
    "if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) return;",
  ],
  invalid: [
    {
      code: "Effect.catchCause((cause) => Cause.hasInterrupts(cause) ? Effect.interrupt : log(cause));",
      errors: [{ messageId: "only" }],
    },
    {
      code: "if (Exit.hasInterrupts(exit)) return;",
      errors: [{ messageId: "only" }],
    },
  ],
});

tester.run("scope-closed", scopeClosed, {
  valid: [
    "if (isScopeClosed(runtime.scope)) return;",
    'if (status._tag === "Closed") return;',
  ],
  invalid: [
    {
      code: 'const closed = () => runtime.scope.state._tag === "Closed";',
      errors: [{ messageId: "helper" }],
    },
    {
      code: 'if ("Closed" === scope.state._tag) return;',
      errors: [{ messageId: "helper" }],
    },
  ],
});

const effect = 'import { Effect } from "effect";\n';

tester.run("obsidian-capabilities", obsidianCapabilities, {
  valid: [
    // A legacy file, with no Effect import, keeps the App.
    "const file = app.vault.getFileByPath(path);",
    'stack.use(this.registerEvent(this.app.workspace.on("file-open", open)));',
    // A type-only import of the bridge names the seam a legacy file holds.
    'import type { EffectBridge } from "@/lib/effect-bridge";\nconst cache = app.metadataCache.getFileCache(file);',
    // Not the App: a tag, or another object's members.
    `${effect}Effect.gen(function* () {
      const vault = yield* Vault;
      const file = yield* vault.getFileByPath(path);
    })`,
    `${effect}settings.vault.getName(); emitter.on("change", run); app.workspace.getActiveFile();`,
    `${effect}app["vault"];`,
  ],
  invalid: [
    {
      code: `${effect}const file = app.vault.getFileByPath(path);`,
      errors: [{ messageId: "capability" }],
    },
    {
      code: 'import { Context } from "effect";\nclass X { #app; read(file) { return this.#app.metadataCache.getFileCache(file); } }',
      errors: [{ messageId: "capability" }],
    },
    {
      code: 'import * as Stream from "effect/Stream";\nconst { adapter } = plugin.app.vault;',
      errors: [{ messageId: "capability" }],
    },
    {
      // A type-only import of another Effect module counts.
      code: 'import type { ClosableModal } from "@/lib/effect-modal";\nctx.app.vault.create(path, data);',
      errors: [{ messageId: "capability" }],
    },
    {
      // The bridge is an Effect module when its values are imported.
      code: 'import { bridgeOf } from "@/lib/effect-bridge";\napp.metadataCache.getFirstLinkpathDest(link, path);',
      errors: [{ messageId: "capability" }],
    },
    {
      code: `${effect}const ref = app.workspace.on("layout-change", update);`,
      errors: [{ messageId: "event" }],
    },
    {
      code: `${effect}this.app.metadataCache.on("changed", update);`,
      errors: [{ messageId: "event" }],
    },
    {
      // One report for the registration, one for the raw event; none for app.vault.
      code: `${effect}this.registerEvent(this.app.vault.on("rename", move));`,
      errors: [{ messageId: "registerEvent" }, { messageId: "event" }],
    },
    {
      code: `${effect}Effect.gen(function* () { registerEvent(vault.on("rename", move)); })`,
      errors: [{ messageId: "registerEvent" }],
    },
  ],
});

tester.run("no-default-runtime", noDefaultRuntime, {
  valid: [
    'import { Effect } from "effect";\nruntime.runSync(x);',
    'import { Effect } from "effect";\nbridge.runPromise(x);',
    'import { Effect } from "effect";\nEffect.runSyncWith(ctx)(x);',
    'import { Effect } from "effect";\nEffect.runPromiseWith(ctx)(x);',
    // A local name that is not the Effect module.
    "const Effect = { runSync: () => 0 };\nEffect.runSync(x);",
    'import { Effect } from "./not-effect";\nEffect.runSync(x);',
    // Not the Effect namespace of this module.
    'import { Effect } from "effect";\nStream.runSync(x);',
  ],
  invalid: [
    {
      code: 'import { Effect } from "effect";\nEffect.runSync(x);',
      errors: [{ messageId: "empty" }],
    },
    {
      code: 'import { Effect } from "effect";\nEffect.runPromise(x);',
      errors: [{ messageId: "empty" }],
    },
    {
      code: 'import { Effect } from "effect";\nvoid Effect.runFork(x);',
      errors: [{ messageId: "empty" }],
    },
    {
      code: 'import { Effect as E } from "effect";\nawait E.runPromiseExit(x);',
      errors: [{ messageId: "empty" }],
    },
  ],
});

const services = "/repo/apps/obsidian/src/services/example/layer.ts";
const library = "/repo/apps/obsidian/src/lib/example.ts";
const effectImport = 'import { Effect } from "effect";\n';
const instantOption = { messageId: "option" };

tester.run("clock-time", clockTime, {
  valid: [
    // No Effect in the file: the legacy clock stays.
    { code: "const at = Date.now();", filename: library },
    { code: "const at = Temporal.Now.instant();", filename: library },
    { code: "const at = performance.now();", filename: library },
    {
      code: "const at = new Date();",
      filename: library,
    },
    // A type-only import of the bridge is not Effect code.
    {
      code: 'import type { EffectBridge } from "@/lib/effect-bridge";\nconst at = Date.now();\nconst instant = Temporal.Now.instant();',
      filename: library,
    },
    // Reading time through Clock, and building a Date from a value.
    {
      code: `${effectImport}const read = Effect.gen(function* () {\n  const at = yield* Clock.currentTimeMillis;\n  return new Date(at);\n});`,
      filename: library,
    },
    // Another object's `now`.
    { code: `${effectImport}const at = clock.now();`, filename: library },
    // A layer that reads Clock takes no `now`.
    {
      code: `${effectImport}export const layer = (options: { readonly root: string }) => Layer.empty;`,
      filename: services,
    },
    // `now` as a value, not a function, and a non-layer function.
    {
      code: `${effectImport}export const layerFor = (options: { readonly now: string }) => Layer.empty;`,
      filename: services,
    },
    {
      code: `${effectImport}export function build(options: { now?: () => Temporal.Instant }) {}`,
      filename: services,
    },
    // Outside src/services the option part does not apply.
    {
      code: `${effectImport}export const layer = (options: { now?: () => number }) => Layer.empty;`,
      filename: library,
    },
  ],
  invalid: [
    {
      code: `${effectImport}const at = Date.now();`,
      filename: library,
      errors: [{ messageId: "clock" }],
    },
    {
      code: 'import { Clock } from "effect";\nconst at = performance.now();',
      filename: library,
      errors: [{ messageId: "clock" }],
    },
    {
      code: `${effectImport}const at = new Date();`,
      filename: library,
      errors: [{ messageId: "clock" }],
    },
    {
      code: `${effectImport}export const layer = (options: { readonly now?: () => Temporal.Instant } = {}) => Layer.empty;`,
      filename: services,
      errors: [instantOption],
    },
    {
      code: `${effectImport}export function layerLive(options: { now: () => number }) { return Layer.empty; }`,
      filename: services,
      errors: [instantOption],
    },
    {
      // The options type is declared in the same file.
      code: `${effectImport}interface LayerOptions { readonly now?: () => Temporal.Instant }\nexport const layer = (options: LayerOptions = {}) => Layer.empty;`,
      filename: services,
      errors: [instantOption],
    },
    {
      code: `${effectImport}export type LayerOptions = Base & { now(): number };\nexport const layer = ({ now }: LayerOptions) => Layer.empty;`,
      filename: services,
      errors: [instantOption],
    },
    {
      // A plain parameter named `now`.
      code: `${effectImport}export const layerSessions = (now: () => Temporal.Instant = () => Temporal.Instant.from(zero)) => Layer.empty;`,
      filename: services,
      errors: [instantOption],
    },
  ],
});

const temporal = { messageId: "temporal" };

tester.run("temporal-in-effect", temporalInEffect, {
  valid: [
    // Outside Effect, Temporal is the date API.
    { code: "const at = Temporal.Instant.from(text);", filename: library },
    {
      code: "let at: Temporal.Instant | undefined;\nconst zone = Temporal.Now.timeZoneId();",
      filename: library,
    },
    // A type-only import of the bridge is not Effect code.
    {
      code: 'import type { EffectBridge } from "@/lib/effect-bridge";\nconst at = Temporal.Instant.from(text);',
      filename: library,
    },
    // Effect's DateTime, and a property that only shares the name.
    {
      code: `${effectImport}const at = DateTime.makeUnsafe(text);\nconst api = options.Temporal;\nconst names = { Temporal: 1 };`,
      filename: library,
    },
  ],
  invalid: [
    {
      code: `${effectImport}const at = Temporal.Instant.from(text);`,
      filename: library,
      errors: [temporal],
    },
    {
      code: `${effectImport}const at = Temporal.Now.instant();`,
      filename: library,
      errors: [temporal],
    },
    {
      code: `${effectImport}const wait = Temporal.Duration.from({ seconds: 5 });`,
      filename: library,
      errors: [temporal],
    },
    {
      code: `${effectImport}interface Use { readonly instant: Temporal.Instant }`,
      filename: library,
      errors: [temporal],
    },
    {
      code: `${effectImport}const is = (u: unknown) => u instanceof Temporal.Instant;`,
      filename: library,
      errors: [temporal],
    },
    {
      // An `@/lib/effect-*` module is Effect code too.
      code: 'import { instantClock } from "@/lib/effect-clock";\nconst spy = vi.spyOn(Temporal.Now, "instant");',
      filename: library,
      errors: [temporal],
    },
  ],
});
