// Companion navigation decides whether to open, update, or ask before creation.
import { Effect } from "effect";
import type { App, PaneType, TFile } from "obsidian";

import type { Item, ItemRef } from "@zotlit/db";
import type { ProtocolAction } from "@zotlit/protocol";

import * as m from "@/lib/i18n/generated/messages";
import { portCall } from "@/lib/legacy-port";
import { Notifier, withProgress } from "@/lib/notifier";
import { Workspace } from "@/lib/obsidian-workspace";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { UseLedger } from "@/services/use-ledger/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { createNoteInteractively } from "./creation-view";
import type { InteractiveCreationDeps } from "./creation-view";
import { plainNoteError } from "./errors";
import type { CompanionNoteTarget, UpdateScope } from "./operations";
import { NoteFeature } from "./service";
import {
  noteOperationDiagnosticContent,
  resolveLiteratureNoteWithWarning,
  updateNoteToast,
} from "./update-single";

/**
 * The legacy values the Companion flow still holds: the interactive creation
 * and its Profile factories convert in a later slice. The flow reads the
 * Zotero data folder from the ZoteroPref tag.
 */
export type CompanionNoteDeps = Omit<InteractiveCreationDeps, "zoteroPref">;

export const openCompanionNote = Effect.fn("openCompanionNote")(function* (
  deps: CompanionNoteDeps,
  ref: ItemRef,
  options: {
    action: ProtocolAction;
    profile?: ProfileSelector;
    scope?: UpdateScope;
    /** Absent replaces the last active tab, as an Obsidian URI without one does. */
    paneType?: PaneType;
  },
) {
  const workspace = yield* Workspace;
  const useLedger = yield* UseLedger;
  const notifier = yield* Notifier;
  const noteFeature = yield* NoteFeature;
  const open = (file: TFile) => {
    const navigate = workspace.openLinkText(file.path, "", {
      newLeaf: options.paneType ?? false,
      state: { active: true },
    });
    return options.action === "update"
      ? useLedger.withoutNoteUse(file, navigate)
      : navigate;
  };
  const target = yield* noteFeature.resolveCompanionNote(ref.indexedKey, {
    profile: options.profile,
  });
  const notice = companionNoteNotice(deps.app, target);
  if (target.outcome === "refused") {
    yield* notifier.show(notice!);
    return;
  }
  if (target.outcome === "existing") {
    const file = resolveLiteratureNoteWithWarning(target.files)!;
    yield* open(file);
    if (target.keptProfile || target.diagnostic) {
      yield* notifier.show(notice!);
    } else if (options.action === "update") {
      const scope = options.scope ?? "full";
      const copy = updateNoteToast(scope, { app: deps.app });
      // The notice tells the user how the update failed.
      yield* withProgress(
        noteFeature.updateNote(file, { indexedKey: ref.indexedKey, scope }),
        {
          loading: copy.loading,
          success: copy.success,
          error: (error) => copy.error("", plainNoteError(error)),
        },
      ).pipe(Effect.ignore);
    }
    return;
  }
  if (options.action === "update" && options.scope === "metadata") {
    yield* notifier.show(m.notice_update_metadata_no_note());
    return;
  }
  const { reads } = yield* ZoteroReads;
  const item: Item | undefined = (yield* reads.ItemsByIndexedKeys({
    indexedKeys: [ref.indexedKey],
  })).get(ref.indexedKey);
  if (!item) return;
  const { dataDir } = yield* (yield* ZoteroPref).current;
  const file = yield* portCall("create-note-interactively", () =>
    createNoteInteractively({ ...deps, zoteroPref: { dataDir } }, item, {
      headless: options.profile,
      direct: true,
    }),
  );
  if (file) {
    yield* open(file);
  }
});

export function companionNoteNotice(
  app: App,
  target: CompanionNoteTarget,
): string | DocumentFragment | undefined {
  if (target.outcome !== "create" && target.diagnostic)
    return noteOperationDiagnosticContent(app, target.diagnostic);
  if (target.outcome === "existing" && target.keptProfile)
    return m.notice_literature_note_profile_kept({
      label: target.keptProfile.label ?? m.settings_profile_default_name(),
    });
  return undefined;
}
