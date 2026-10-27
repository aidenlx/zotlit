// Companion navigation decides whether to open, update, or ask before creation.
import { Effect } from "effect";
import type { App, PaneType, TFile } from "obsidian";

import type { Item, ItemRef } from "@zotlit/db";
import type { ProtocolAction } from "@zotlit/protocol";

import * as m from "@/lib/i18n/generated/messages";
import { Notifier } from "@/lib/notifier";
import { Workspace } from "@/lib/obsidian-workspace";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { UseLedger } from "@/services/use-ledger/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { createNoteInteractively } from "./creation-view";
import type { InteractiveCreationPorts } from "./creation-view";
import type { CompanionNoteTarget, UpdateScope } from "./operations";
import { NoteFeature } from "./service";
import {
  noteOperationDiagnosticContent,
  resolveLiteratureNoteWithWarning,
  updateNoteToast,
  updateWithNotice,
} from "./update-single";

/** How a Companion link's open or update ended. */
export type CompanionLinkOutcome =
  /** The note resolution refused the link; nothing opened. */
  | { readonly outcome: "refused"; readonly target: CompanionNoteTarget }
  /**
   * An existing note opened and stayed as it was: its Profile stamp was kept
   * or carries a diagnostic.
   */
  | { readonly outcome: "opened-as-is"; readonly target: CompanionNoteTarget }
  /** An existing note opened, and updated when the link asked for it. */
  | { readonly outcome: "opened"; readonly file: TFile }
  /** A metadata-only update found no note, so it created none. */
  | { readonly outcome: "metadata-no-note" }
  /** The database holds no Item for the link. */
  | { readonly outcome: "item-not-found" }
  /** A note was created and opened. */
  | { readonly outcome: "created"; readonly file: TFile }
  /** The creation wrote no note: the user cancelled, or the create failed. */
  | { readonly outcome: "not-created" };

/** Open or update the Companion link's note, and tell the outcome on a notice. */
export const openCompanionNote = Effect.fn("openCompanionNote")(function* (
  deps: InteractiveCreationPorts,
  ref: ItemRef,
  options: CompanionLinkOptions,
) {
  const outcome = yield* followCompanionLink(deps, ref, options);
  const notice = companionLinkNotice(deps.app, outcome);
  if (notice) yield* (yield* Notifier).show(notice);
});

/** What a Companion link asks for. */
export interface CompanionLinkOptions {
  action: ProtocolAction;
  profile?: ProfileSelector;
  scope?: UpdateScope;
  /** Absent replaces the last active tab, as an Obsidian URI without one does. */
  paneType?: PaneType;
}

/**
 * Open the Companion link's existing note, updating it when the link asks, or
 * create one through the Profile selection. Returns how it ended.
 */
export const followCompanionLink = Effect.fn("followCompanionLink")(function* (
  deps: InteractiveCreationPorts,
  ref: ItemRef,
  options: CompanionLinkOptions,
) {
  const workspace = yield* Workspace;
  const useLedger = yield* UseLedger;
  const noteFeature = yield* NoteFeature;
  const ended = (outcome: CompanionLinkOutcome) => outcome;
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
  if (target.outcome === "refused")
    return ended({ outcome: "refused", target });
  if (target.outcome === "existing") {
    const file = resolveLiteratureNoteWithWarning(target.files)!;
    yield* open(file);
    if (target.keptProfile || target.diagnostic)
      return ended({ outcome: "opened-as-is", target });
    if (options.action === "update") {
      const scope = options.scope ?? "full";
      yield* updateWithNotice(
        file,
        { indexedKey: ref.indexedKey, scope },
        updateNoteToast(scope, { app: deps.app }),
      );
    }
    return ended({ outcome: "opened", file });
  }
  if (options.action === "update" && options.scope === "metadata")
    return ended({ outcome: "metadata-no-note" });
  const { reads } = yield* ZoteroReads;
  const item: Item | undefined = (yield* reads.ItemsByIndexedKeys({
    indexedKeys: [ref.indexedKey],
  })).get(ref.indexedKey);
  if (!item) return ended({ outcome: "item-not-found" });
  const file = yield* createNoteInteractively(deps, item, {
    headless: options.profile,
    direct: true,
  });
  if (!file) return ended({ outcome: "not-created" });
  yield* open(file);
  return ended({ outcome: "created", file });
});

/** The notice a Companion link's outcome shows, or none. */
export function companionLinkNotice(
  app: App,
  outcome: CompanionLinkOutcome,
): string | DocumentFragment | undefined {
  switch (outcome.outcome) {
    case "refused":
    case "opened-as-is":
      return companionNoteNotice(app, outcome.target);
    case "metadata-no-note":
      return m.notice_update_metadata_no_note();
    default:
      return undefined;
  }
}

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
