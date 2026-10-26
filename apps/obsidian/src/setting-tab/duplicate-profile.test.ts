// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import type { App } from "obsidian";
import { describe, expect, vi } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId, ProfileSelector } from "@/lib/profile-stamp";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { Profile } from "@/services/profile/service";
import type { LiteratureNoteProfile } from "@/services/profile/service";

import type { SettingTabContext } from "./context";
import { duplicateProfileToWorkbench } from "./duplicate-profile";

const COPY: LiteratureNoteProfile = {
  id: "Jk6Lm8Np2Qr4" as ProfileId,
  label: "Reading copy",
  document: "zotlit-profile.reading-copy.md",
  path: "templates/zotlit-profile.reading-copy.md",
  bindings: {},
  match: { state: "absent", summary: m.profile_match_absent() },
};

describe("Duplicate Profile workbench handoff", () => {
  it.effect.each(["default", "Bk3Qn7XvT2Lp"])(
    "opens the new copy from %s through the shared workbench flow",
    (id) =>
      Effect.gen(function* () {
        const close = vi.fn<() => void>();
        const customize = vi.fn<SettingTabContext["customize"]>(async () => {
          expect(close).toHaveBeenCalledOnce();
        });
        const duplicate = vi.fn(() => Effect.succeed(COPY));
        const notifier = testNotifier();
        const ctx = stubService<Pick<SettingTabContext, "app" | "customize">>(
          "SettingTabContext",
          {
            app: stubService<App>("App", {
              setting: stubService<App["setting"]>("SettingsModal", { close }),
            }),
            customize,
          },
        );

        yield* duplicateProfileToWorkbench(ctx, id as ProfileSelector).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.mock(Profile, {
                resolveProfile: () =>
                  Effect.succeed({
                    ...profileReader().resolveProfile("default")!,
                    label: "Reading",
                  }),
                duplicate,
              }),
              notifier.layer,
            ),
          ),
        );

        expect(duplicate).toHaveBeenCalledWith(id, {});
        expect(customize).toHaveBeenCalledExactlyOnceWith({
          profileId: COPY.id,
        });
        expect(notifier.notices.map(({ messages: [text] }) => text)).toEqual([
          m.notice_profile_duplicated({ label: "Reading" }),
        ]);
      }),
  );
});
