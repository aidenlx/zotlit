import { Context, Effect, Exit, Scope } from "effect";
// The tab service over a test's own services, for builders and the tab class.
import { onTestFinished } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { Notifier } from "@/lib/notifier";

import { makeSettingTab } from "./effect-tab";
import type { SettingTab, SettingTabEnv, SettingTabShape } from "./effect-tab";

/**
 * A tab service whose Effects read `services`, with a recording Notifier
 * unless `services` brings one. Its fibers end when the test finishes. A test
 * gives only the services the rows under test read; reading any other fails
 * that Effect with a missing-service defect.
 */
export function testSettingTab(
  services: Context.Context<never> = Context.empty(),
  { update = () => {} }: { update?: () => void } = {},
) {
  const notifier = testNotifier();
  const scope = Scope.makeUnsafe();
  onTestFinished(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const context = Context.merge(
    Context.make(Notifier, notifier.service).pipe(
      Context.add(Scope.Scope, scope),
    ),
    services,
    // A test provides only what its rows read; the rest stays missing.
  ) as Context.Context<Exclude<SettingTabEnv, SettingTab> | Scope.Scope>;
  const tab: SettingTabShape = Effect.runSync(
    makeSettingTab(update).pipe(Effect.provideContext(context)),
  );
  return { tab, notices: notifier.notices };
}
