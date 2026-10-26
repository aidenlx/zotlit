import { Context, Effect, Exit, Scope } from "effect";
// The tab service over a test's own services, for builders and the tab class.
import { onTestFinished } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { Notifier } from "@/lib/notifier";
import { Vault } from "@/lib/obsidian-vault";
import { Profile } from "@/services/profile/service";
import { Template } from "@/services/template/service";

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

/**
 * The Profile, Template and Vault reads of the Profile and Template rows:
 * a loaded registry with no Profile, no excluded document, no partial and no
 * saved Default document, unless a test overrides a member.
 */
export function profileRowServices(
  overrides: {
    profile?: Partial<Profile["Service"]>;
    template?: Partial<Template["Service"]>;
    vault?: Partial<Vault["Service"]>;
  } = {},
) {
  return Context.make(
    Profile,
    stubService<Profile["Service"]>("Profile", {
      loaded: Effect.succeed(true),
      profiles: Effect.succeed([]),
      diagnostics: Effect.succeed([]),
      defaultDocumentPath: Effect.succeed(
        "templates/zotlit-profile.default.md",
      ),
      ...overrides.profile,
    }),
  ).pipe(
    Context.add(
      Template,
      stubService<Template["Service"]>("Template", {
        loaded: Effect.succeed(true),
        javascriptTemplatesEnabled: Effect.succeed(false),
        getPartialDocuments: Effect.succeed([]),
        getReservedPartialFiles: Effect.succeed([]),
        getUnrecognizedFiles: Effect.succeed([]),
        ...overrides.template,
      }),
    ),
    Context.add(
      Vault,
      stubService<Vault["Service"]>("Vault", {
        getFileByPath: () => Effect.succeed(null),
        ...overrides.vault,
      }),
    ),
  );
}
