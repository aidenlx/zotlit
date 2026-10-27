// The note import commands: each import runs behind the Notifier's progress
// notice and ends with the import's own outcome.
import { Effect, Layer } from "effect";
import type { App } from "obsidian";

import { scopedBridge } from "@/lib/effect-bridge";
import * as m from "@/lib/i18n/generated/messages";
import { withProgress } from "@/lib/notifier";
import type { Notifier } from "@/lib/notifier";
import { PluginHost } from "@/lib/plugin-host";
import { withLiteratureNote } from "@/services/note-feature/actions";

import { runBatchImportAll, runChildImportByKey } from "./batch-import";
import type { BatchImportPorts, BatchImportServices } from "./batch-import";
import {
  batchImportAllToast,
  childImportToast,
  importNotices,
} from "./batch-import-notices";
import type { NoteImportView } from "./view";

/**
 * Import all child and standalone notes in the Library Scope. Answers the
 * import's outcome, or fails with what failed; the notice reports either.
 * An interrupt (unload) ends it with no outcome and no notice.
 */
export const importAllNotes = Effect.fn("importAllNotes")(function* (
  ports: BatchImportPorts,
  app: App,
) {
  return yield* withProgress(runBatchImportAll(ports), {
    loading: m.batch_import_loading(),
    ...importNotices(batchImportAllToast({ app })),
  });
});

/**
 * Import the child notes of the item `indexedKey` names, as
 * {@link importAllNotes} does: `null` when the key names no live item.
 */
export const importChildNotes = Effect.fn("importChildNotes")(function* (
  ports: BatchImportPorts,
  app: App,
  indexedKey: string,
) {
  return yield* withProgress(runChildImportByKey(ports, indexedKey), {
    loading: m.batch_import_loading(),
    ...importNotices(childImportToast({ app })),
  });
});

/**
 * Register Import all notes and Import child notes. Each runs on the layer's
 * Scope behind its progress notice, which reports the outcome; unload
 * interrupts a run still going.
 */
export const layerNoteImportCommands = (ports: {
  readonly view: NoteImportView;
}): Layer.Layer<never, never, PluginHost | BatchImportServices | Notifier> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const host = yield* PluginHost;
      const bridge = yield* scopedBridge;
      const context = yield* Effect.context<BatchImportServices | Notifier>();
      const importPorts = { view: ports.view, bridge };
      // The notice reported a failure; a defect still surfaces.
      const start = <A, E>(
        command: Effect.Effect<A, E, BatchImportServices | Notifier>,
      ) =>
        bridge.runAndForget(
          Effect.ignore(Effect.provideContext(command, context)),
        );
      yield* host.addCommand({
        id: "import-child-notes",
        name: m.command_import_child_notes_name(),
        editorCheckCallback(checking, _editor, ctx) {
          return withLiteratureNote(host, { ctx, checking }, (_file, itemKey) =>
            start(importChildNotes(importPorts, host.app, itemKey)),
          );
        },
      });
      yield* host.addCommand({
        id: "import-all-notes",
        name: m.command_import_all_notes_name(),
        callback: () => start(importAllNotes(importPorts, host.app)),
      });
    }),
  );
