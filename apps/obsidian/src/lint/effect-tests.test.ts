import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import {
  noEffectRunInTest,
  noRealTimerInEffectTest,
  serviceStub,
  typedFake,
} from "../../scripts/oxlint-plugin-effect-tests";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const effect = 'import { Effect } from "effect";\n';
const run = [{ messageId: "run" }];

tester.run("no-effect-run-in-test", noEffectRunInTest, {
  valid: [
    `${effect}it.effect("reads", () => Effect.gen(function* () { yield* read; }))`,
    `${effect}it.live("waits", () => Effect.sleep(1))`,
    // A fixture runs outside any case.
    `${effect}export const ledger = () => Effect.runSync(make);`,
    `${effect}it("renders", () => { expect(render()).toBe("x"); })`,
    // A plain adapter's test drives the adapter through its runtime.
    `${effect}it("records", () => { runtime.runSync(Effect.void); })`,
    // Only Effect's own run entry points count.
    'import type { Effect } from "effect";\nit("reads", () => { Effect.runSync(read); })',
    'import { runSync } from "./worker";\nit("reads", () => { runSync(read); })',
  ],
  invalid: [
    {
      code: `${effect}it("reads", async () => { expect(await Effect.runPromise(read)).toBe(1); })`,
      errors: run,
    },
    {
      code: 'import { Effect } from "effect";\ntest.only("reads", () => { Effect.runSync(read); })',
      errors: run,
    },
    {
      code: `${effect}it.each([1, 2])("reads %i", async (n) => { await Effect.runPromiseExit(read(n)); })`,
      errors: run,
    },
    {
      code: `${effect}describe("x", () => { it("forks", () => { const f = Effect.runFork(read); }); })`,
      errors: run,
    },
    {
      code: 'import { Effect as E } from "effect";\nit("reads", () => { E.runSync(read); })',
      errors: run,
    },
    {
      code: 'import * as NativeEffect from "effect/Effect";\nit("reads", () => { NativeEffect.runSync(read); })',
      errors: run,
    },
    {
      code: 'import { runSyncWith } from "@/lib/effect-runtime";\nit("reads", () => { runSyncWith(context)(read); })',
      errors: run,
    },
    {
      code: 'import { runPromise as go } from "effect/Effect";\nit("reads", async () => { await go(read); })',
      errors: run,
    },
  ],
});

const timer = [{ messageId: "timer" }];

// Failure modes: an Effect case waits on real time and goes unflagged, or a
// plain or live case, which owns real time, is flagged.
tester.run("no-real-timer-in-effect-test", noRealTimerInEffectTest, {
  valid: [
    'it.effect("waits", () => Effect.gen(function* () { yield* Effect.sleep("1 second"); yield* TestClock.adjust("1 second"); }))',
    'it("waits", async () => { await delay(50); })',
    'it.live("waits", () => Effect.promise(() => delay(50)))',
    'it.effect.live("waits", () => Effect.promise(() => new Promise((r) => setTimeout(r, 5))))',
    // A fixture outside any case.
    "const wait = () => delay(5);",
  ],
  invalid: [
    {
      code: 'it.effect("waits", () => Effect.promise(() => delay(50)))',
      errors: timer,
    },
    {
      code: 'it.effect("waits", () => Effect.promise(() => new Promise((r) => setTimeout(r, 50))))',
      errors: timer,
    },
    {
      code: 'it.effect("yields", () => Effect.gen(function* () { yield* Effect.promise(() => yieldToMain()); }))',
      errors: timer,
    },
    {
      code: 'it.effect.each([1])("waits", () => Effect.sync(() => window.setTimeout(done, 5)))',
      errors: timer,
    },
    {
      code: 'it.effect("fakes", () => Effect.sync(() => { vi.useFakeTimers(); vi.advanceTimersByTime(50); }))',
      errors: [...timer, ...timer],
    },
    {
      code: 'layer(Probe)("probe", (it) => { it.effect("waits", () => Effect.promise(() => delay(5))); })',
      errors: timer,
    },
  ],
});

const stub = [{ messageId: "stub" }];

tester.run("service-stub", serviceStub, {
  valid: [
    'Layer.succeed(Reads, stubService<Reads["Service"]>("Reads", { current }))',
    // A cast of a value that is not a literal fake.
    'const service = context.unsafeMap.get(key) as Reads["Service"];',
    'const options = { retry: 1 } as Options["retry"];',
  ],
  invalid: [
    {
      code: 'Layer.succeed(Reads, { current } as Reads["Service"])',
      errors: stub,
    },
    {
      code: 'Layer.succeed(Reads, { current } as unknown as Reads["Service"])',
      errors: stub,
    },
    {
      code: 'Layer.succeed(Reads, { current } satisfies Partial<Reads["Service"]> as unknown as Reads["Service"])',
      errors: stub,
    },
  ],
});

const layerFake = [{ messageId: "layer" }];
const hostFake = [{ messageId: "host" }];
const serviceFake = [{ messageId: "service" }];
const neverFake = [{ messageId: "never" }];
const layer = 'import { Effect, Layer } from "effect";\n';
const host = 'import type { App, CachedMetadata, TFile } from "obsidian";\n';

// Failure modes: a fake whose type a cast hides goes unflagged, or a typed
// fake, a cast of a value that is no fake, or a case service-stub reports is
// flagged.
tester.run("typed-fake", typedFake, {
  valid: [
    `${layer}Layer.mock(Reads, { current });`,
    `${layer}Layer.succeed(Reads, Reads.of({ current }));`,
    `${layer}Layer.succeed(Reads, stubService<Reads["Service"]>("Reads", { current }));`,
    `${host}const app = stubService<App>("App", { vault });`,
    `${host}const cache: CachedMetadata = { frontmatter: {} };`,
    // A cast of a value that is no literal fake, outside a layer.
    `${host}const app = host.app as unknown as App;`,
    `${layer}layerHost({ vault: host.vault });`,
    // A cast in a property of an object no layer takes.
    `${layer}const sources = { vault: host.vault as unknown as VaultSource };`,
    `${host}const target = event.target as HTMLElement;`,
    "const shape = { hoverEl } as unknown as { hoverEl: HTMLElement };",
    "const value = read() as never;",
    `${layer}const items = [1, 2] as const;`,
    // service-stub reports this one.
    `${layer}Layer.succeed(Reads, { current } as unknown as Reads["Service"]);`,
    // A name from another module.
    'import type { App } from "./app";\nconst app = { vault } as unknown as App;',
  ],
  invalid: [
    {
      code: `${layer}Layer.succeed(Reads, reads as never);`,
      errors: layerFake,
    },
    {
      code: `${layer}Layer.mock(Reads, { current } as never);`,
      errors: layerFake,
    },
    {
      code: `${layer}Layer.succeed(Reads)(reads as unknown as Reads);`,
      errors: layerFake,
    },
    {
      code: `${layer}Layer.succeed(Reads, Reads.of({ current } as never));`,
      errors: layerFake,
    },
    {
      code: `${layer}Effect.provideService(effect, Reads, reads as never);`,
      errors: layerFake,
    },
    {
      code: `${layer}layerVaultFrom(vault as unknown as VaultSource);`,
      errors: layerFake,
    },
    {
      code: `${layer}layerHostApp(host.app as unknown as App);`,
      errors: layerFake,
    },
    {
      code: `${layer}layerHost({ vault: host.vault as unknown as VaultSource });`,
      errors: layerFake,
    },
    {
      code: `${host}const app = { vault } as unknown as App;`,
      errors: hostFake,
    },
    { code: `${host}const app = { vault } as App;`, errors: hostFake },
    {
      code: `${host}const file = { path: "a.md" } as TFile;`,
      errors: hostFake,
    },
    {
      code: `${host}const files = [{ path: "a.md" } as unknown as TFile];`,
      errors: hostFake,
    },
    {
      code: 'import type { Vault } from "@/lib/obsidian-vault";\nconst vault = { read } as unknown as Vault["Service"] & {};',
      errors: hostFake,
    },
    {
      code: 'import type { Leaf } from "obsidian";\nconst leaf = { view } as unknown as Partial<Leaf>;',
      errors: hostFake,
    },
    {
      code: "const deps = { profile } as unknown as ViewDeps;",
      errors: serviceFake,
    },
    {
      code: 'const profile = { current } as unknown as ViewDeps["profile"];',
      errors: serviceFake,
    },
    {
      code: 'const settings = { current } as unknown as Pick<PluginSettings["Service"], "current">;',
      errors: serviceFake,
    },
    { code: "new View({ refresh: () => done } as never);", errors: neverFake },
    {
      code: "const deps = { refresh } as unknown as never;",
      errors: neverFake,
    },
  ],
});
