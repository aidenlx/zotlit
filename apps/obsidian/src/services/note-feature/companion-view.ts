// Companion navigation decides whether to open, update, or ask before creation.
import { Effect } from "effect";
import type { App, PaneType, TFile } from "obsidian";

import type { Item, ItemRef } from "@zotlit/db";
import type { ProtocolAction } from "@zotlit/protocol";

import * as m from "@/lib/i18n/generated/messages";
import { Notifier } from "@/lib/notifier";
import { Workspace } from "@/lib/obsidian-workspace";
import type { ProfileSelector } from "@/lib/profile-stamp";
import * as toast from "@/lib/toast";
import { UseLedger } from "@/services/use-ledger/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { createNoteInteractively } from "./creation-view";
import type { InteractiveCreationDeps } from "./creation-view";
import type {
  CompanionNoteTarget,
  NoteFeature,
  UpdateScope,
} from "./operations";
import {
  noteOperationDiagnosticContent,
  resolveLiteratureNoteWithWarning,
  updateNoteToast,
} from "./update-single";

/**
 * The legacy values the Companion flow still holds. Note Feature and the
 * Profile factories convert in later slices; the flow reads the Zotero data
 * folder from the ZoteroPref tag.
 */
export interface CompanionNoteDeps extends Omit<
  InteractiveCreationDeps,
  "zoteroPref"
> {
  noteFeature: InteractiveCreationDeps["noteFeature"] &
    Pick<NoteFeature, "resolveCompanionNote" | "updateNote">;
}

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
  const open = (file: TFile) => {
    const navigate = workspace.openLinkText(file.path, "", {
      newLeaf: options.paneType ?? false,
      state: { active: true },
    });
    return options.action === "update"
      ? useLedger.withoutNoteUse(file, navigate)
      : navigate;
  };
  const target = yield* Effect.promise(() =>
    deps.noteFeature.resolveCompanionNote(ref.indexedKey, {
      profile: options.profile,
    }),
  );
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
      yield* Effect.promise(() =>
        toast.promise(
          deps.noteFeature.updateNote(file, {
            indexedKey: ref.indexedKey,
            scope,
          }),
          updateNoteToast(scope, { app: deps.app }),
        ),
      );
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
  const file = yield* Effect.promise(() =>
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
