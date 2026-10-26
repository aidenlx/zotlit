// The note commands and menu entries for callers outside Effect: the command
// callbacks, the file menu and the Workbench's saved notice.
import { Effect } from "effect";
import type { Context } from "effect";
import type { TFile } from "obsidian";

import type { EffectBridge } from "@/lib/effect-bridge";
import { settleAtEdge } from "@/lib/signal-edge";
import type { NoteImportView } from "@/services/note-import/view";

import {
  overwriteNote,
  reimportNote,
  switchProfile,
  updateAll,
  updateNote,
} from "./actions-view";
import type { NoteActionPorts, NoteActionServices } from "./actions-view";
import type { InteractiveCreationPorts } from "./creation-view";
import type { UpdateScope } from "./operations";
import type { BatchUpdateNotices } from "./update-single";

/** Each action asks, runs, and reports on a notice; it settles when it ends. */
export interface NoteActions {
  /** @see switchProfile */
  switchProfile(file: TFile): Promise<void>;
  /** @see updateNote */
  updateNote(
    file: TFile,
    options: { itemKey: string; scope: UpdateScope },
  ): Promise<void>;
  /** @see overwriteNote */
  overwriteNote(file: TFile, itemKey: string): Promise<void>;
  /** @see reimportNote */
  reimportNote(file: TFile, noteKey: string): Promise<void>;
  /** @see updateAll */
  updateAll(): Promise<void>;
}

/**
 * The note actions over `context`, run through `bridge`; the import and
 * update modals' callbacks run through `bridge` too. Unload interrupts an
 * action: its open dialog closes, and it resolves.
 */
export function bindNoteActions(
  bridge: Pick<EffectBridge, "runSync" | "runPromiseExit">,
  context: Context.Context<NoteActionServices>,
  ports: {
    creation: InteractiveCreationPorts;
    view: NoteImportView;
    notices: BatchUpdateNotices;
  },
): NoteActions {
  const actionPorts: NoteActionPorts = {
    ...ports.creation,
    batchImport: { view: ports.view, bridge },
    batchUpdate: { notices: ports.notices, view: ports.view, bridge },
  };
  const run = async <E>(effect: Effect.Effect<void, E, NoteActionServices>) =>
    settleAtEdge(
      await bridge.runPromiseExit(Effect.provideContext(effect, context)),
      undefined,
      () => undefined,
    );
  return {
    switchProfile: (file) => run(switchProfile(actionPorts, file)),
    updateNote: (file, options) => run(updateNote(actionPorts, file, options)),
    overwriteNote: (file, itemKey) =>
      run(overwriteNote(actionPorts, file, itemKey)),
    reimportNote: (file, noteKey) =>
      run(reimportNote(actionPorts, file, noteKey)),
    updateAll: () => run(updateAll(actionPorts)),
  };
}
