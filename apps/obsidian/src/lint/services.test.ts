import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import {
  cliCommandRegistration,
  effectNativeResources,
  noLegacyService,
  serviceTagId,
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
    `Effect.fnUntraced(function* () { yield* acquireDisposable(() => registerEvent(ref)); })`,
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
