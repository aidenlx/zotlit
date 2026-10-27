// The note import commands: the Notifier reports each import's outcome, and
// the import ends with that outcome.
import { Effect, Layer } from "effect";
import type { Context } from "effect";
import type { App } from "obsidian";

import { scopedBridge } from "@/lib/effect-bridge";
import type { EffectBridge } from "@/lib/effect-bridge";
import * as m from "@/lib/i18n/generated/messages";
import { withOutcome } from "@/lib/notifier";
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

/** The services a note import command reads. */
type ImportCommandServices = BatchImportServices | Notifier;

/**
 * Import all child and standalone notes in the Library Scope. Answers the
 * import's outcome, or fails with what failed; the notice reports either.
 * An interrupt (unload) ends it with no outcome and no notice.
 */
export const importAllNotes = Effect.fn("NoteImport.importAllNotes")(function* (
  ports: BatchImportPorts,
  app: App,
) {
  return yield* withOutcome(
    runBatchImportAll(ports),
    importNotices(batchImportAllToast({ app })),
  );
});

/**
 * Import the child notes of the item `indexedKey` names, as
 * {@link importAllNotes} does: `null` when the key names no live item.
 */
export const importChildNotes = Effect.fn("NoteImport.importChildNotes")(
  function* (ports: BatchImportPorts, app: App, indexedKey: string) {
    return yield* withOutcome(
      runChildImportByKey(ports, indexedKey),
      importNotices(childImportToast({ app })),
    );
  },
);

/**
 * Start a note import command from a callback over `context`. Its notice
 * reported a failure; a defect still surfaces.
 */
export const importStarter =
  (
    bridge: Pick<EffectBridge, "runAndForget">,
    context: Context.Context<ImportCommandServices>,
  ) =>
  <A, E>(command: Effect.Effect<A, E, ImportCommandServices>): void =>
    bridge.runAndForget(Effect.ignore(Effect.provideContext(command, context)));

/**
 * Register Import all notes and Import child notes. Each runs on the layer's
 * Scope, and its notice reports the outcome; unload
 * interrupts a run still going.
 */
export const layerNoteImportCommands = (ports: {
  readonly view: NoteImportView;
}): Layer.Layer<never, never, PluginHost | ImportCommandServices> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const host = yield* PluginHost;
      const bridge = yield* scopedBridge;
      const start = importStarter(
        bridge,
        yield* Effect.context<ImportCommandServices>(),
      );
      const importPorts = { view: ports.view, bridge };
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
