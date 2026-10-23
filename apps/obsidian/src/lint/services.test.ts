import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import {
  effectNativeResources,
  noLegacyService,
  serviceTagId,
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
