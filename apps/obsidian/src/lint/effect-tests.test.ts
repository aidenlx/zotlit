import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noEffectRunInTest } from "../../scripts/oxlint-plugin-effect-tests";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const effect = 'import { Effect } from "@/lib/effect";\n';
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
