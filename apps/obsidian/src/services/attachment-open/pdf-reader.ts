// Obsidian's own PDF view, as the Target Opener opens a file in it.
import { Effect } from "effect";

import { createObsidianAttachmentReader } from "@/lib/attachment-open";
import { ObsidianApp } from "@/lib/obsidian-app";
import { PluginSettings } from "@/services/settings/service";
import { activateAnnotView } from "@/views/annot-view/register";

import type { TargetReader } from "./open-target";

/**
 * Obsidian's PDF view as the Target Opener drives it: the file opens, and the
 * annotation view comes forward beside it so the Item's Annotations are on
 * screen. `reader.focus-annot-view` drops the second step for a user who
 * keeps the sidebar arranged their own way.
 */
export const pdfReader: Effect.Effect<
  TargetReader,
  never,
  ObsidianApp | PluginSettings
> = Effect.gen(function* () {
  const app = yield* ObsidianApp;
  const settings = yield* PluginSettings;
  // The reader's `onOpened` is a callback from Obsidian's open.
  const run = Effect.runSyncWith(yield* Effect.context<never>());
  return createObsidianAttachmentReader(app, {
    onOpened: () => {
      if (run(settings.current)["reader.focus-annot-view"]) {
        void activateAnnotView(app);
      }
    },
  });
});
