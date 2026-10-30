// Profile import has one shared UI entry from the command palette.
import { Effect, Layer } from "effect";

import { scopedBridge } from "@/lib/effect-bridge";
import * as m from "@/lib/i18n/generated/messages";
import { PluginHost } from "@/lib/plugin-host";
import { importProfileDialog } from "@/setting-tab/profile-dialogs";
import type { ProfileDialogServices } from "@/setting-tab/profile-dialogs";

/**
 * Register Import profile. The import dialog runs on the layer's Scope and
 * reports its own outcome; unload closes a dialog still open.
 */
export const layerProfileActions: Layer.Layer<
  never,
  never,
  PluginHost | ProfileDialogServices
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const bridge = yield* scopedBridge;
    const context = yield* Effect.context<ProfileDialogServices>();
    yield* host.addCommand({
      id: "import-profile",
      name: m.command_import_profile_name(),
      callback: () =>
        bridge.runAndForget(
          Effect.provideContext(importProfileDialog(host.app), context),
        ),
    });
  }),
);
