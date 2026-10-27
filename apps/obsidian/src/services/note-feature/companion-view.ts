// Companion navigation decides whether to open, update, or ask before creation.
import { Effect } from "effect";
import type { App, PaneType } from "obsidian";

import type { ItemRef } from "@zotlit/db";
import type { ProtocolAction } from "@zotlit/protocol";

import * as m from "@/lib/i18n/generated/messages";
import { Notifier } from "@/lib/notifier";
import type { ProfileSelector } from "@/lib/profile-stamp";

import type { InteractiveCreationPorts } from "./creation-view";
import type { CompanionNoteTarget, UpdateScope } from "./operations";
import { noteOperationDiagnosticContent } from "./update-single";

export type { LiteratureNoteOutcome as CompanionLinkOutcome } from "./navigation";
import type { LiteratureNoteOutcome as CompanionLinkOutcome } from "./navigation";
import { openLiteratureNote } from "./navigation";

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
export const followCompanionLink = Effect.fn("CompanionLink.follow")(
  (
    deps: InteractiveCreationPorts,
    ref: ItemRef,
    options: CompanionLinkOptions,
  ) =>
    openLiteratureNote(deps, ref.indexedKey, {
      source: "companion",
      ...options,
    }),
);

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
