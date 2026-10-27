// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect, vi } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { PluginHost } from "@/lib/plugin-host";
import type { ProfileId, ProfileSelector } from "@/lib/profile-stamp";
import { Customize } from "@/services/local-bridge/customize";
import type { CustomizeRequest } from "@/services/local-bridge/customize";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { Profile } from "@/services/profile/service";
import type { LiteratureNoteProfile } from "@/services/profile/service";

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
        const customize = vi.fn((_request: CustomizeRequest) => {
          expect(close).toHaveBeenCalledOnce();
        });
        const duplicate = vi.fn(() => Effect.succeed(COPY));

        yield* duplicateProfileToWorkbench(id as ProfileSelector).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.mock(Customize, {
                open: (request) => Effect.sync(() => customize(request)),
              }),
              Layer.mock(Profile, {
                resolveProfile: () =>
                  Effect.succeed(profileReader().resolveProfile("default")!),
                duplicate,
              }),
              Layer.succeed(
                PluginHost,
                stubService<PluginHost["Service"]>("PluginHost", {
                  closeSettings: Effect.sync(close),
                }),
              ),
              testNotifier().layer,
            ),
          ),
        );

        expect(duplicate).toHaveBeenCalledWith(id, {});
        expect(customize).toHaveBeenCalledExactlyOnceWith({
          profileId: COPY.id,
        });
      }),
  );
});
