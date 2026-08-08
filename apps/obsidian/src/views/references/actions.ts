// What a References Sidebar entry can do: navigate the document, and reach the Item in Zotero.

import { MarkdownView, Menu } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { createContext, useContext } from "react";
import type { MouseEvent } from "react";

import { attachmentOpenUri, itemSelectUri } from "@zotlit/db";

import type { CitationOccurrence } from "@/services/citation-index/service";

import type {
  OpenableAttachment,
  ReferenceEntry,
  ReferenceSource,
} from "./entries";

export interface ReferenceActions {
  /** Move the editor to the entry's next occurrence, wrapping at the end. */
  onSelect: (entry: ReferenceEntry) => void;
  onOpenNote: (entry: ReferenceEntry) => void;
  onOpenInZotero: (source: ReferenceSource) => void;
  /**
   * Open the Item's Attachment in Zotero's reader. A single Attachment opens
   * straight away; several offer a menu at the click.
   */
  onOpenAttachment: (source: ReferenceSource, event: MouseEvent) => void;
  /** Open the settings page the engine install lives on. */
  onOpenEngineSettings: () => void;
  /** Dismiss the install hint for good. */
  onDismissEngineHint: () => void;
}

export interface ReferenceActionDeps {
  app: App;
  /** Path of the document the listed references were scanned from. */
  getSourcePath: () => string | null;
  /** Open the Literature Note of the Item a citekey names, creating it first when it has none. */
  openCitekey: (citekey: string) => void;
  onOpenEngineSettings: () => void;
  onDismissEngineHint: () => void;
}

export function createReferenceActions(
  deps: ReferenceActionDeps,
): ReferenceActions {
  const cursors = new Map<string, number>();

  return {
    onSelect(entry) {
      const sourcePath = deps.getSourcePath();
      if (!sourcePath || entry.occurrences.length === 0) return;
      const next =
        ((cursors.get(entry.id) ?? -1) + 1) % entry.occurrences.length;
      cursors.set(entry.id, next);
      revealOccurrence(deps.app, sourcePath, entry.occurrences[next]!);
    },
    onOpenNote(entry) {
      // An unresolved citekey reaches no note, and a missing entry's Item
      // could not be read at all; both keep their row's action disabled.
      if (entry.kind === "unresolved" || entry.kind === "missing") return;
      // No Literature Note yet — the citekey editor's one create-then-open
      // flow makes it, then opens it.
      if (entry.linkpath === null) {
        deps.openCitekey(entry.occurrences[0]!.raw);
        return;
      }
      void deps.app.workspace.openLinkText(
        entry.linkpath,
        deps.getSourcePath() ?? "",
        false,
      );
    },
    onOpenInZotero(source) {
      window.open(itemSelectUri(source.itemKey, source.groupID));
    },
    onOpenAttachment(source, event) {
      const [first, ...rest] = source.attachments;
      if (!first) return;
      if (rest.length === 0) {
        openAttachment(first);
        return;
      }
      showAttachmentMenu(source.attachments, event);
    },
    onOpenEngineSettings: deps.onOpenEngineSettings,
    onDismissEngineHint: deps.onDismissEngineHint,
  };
}

function openAttachment({ key, groupID }: OpenableAttachment): void {
  window.open(attachmentOpenUri(key, groupID));
}

/**
 * Offer one row per Attachment. A keyboard click carries no pointer position
 * (`detail` of `0`), so the menu takes the button's own corner instead of the
 * window's.
 */
function showAttachmentMenu(
  attachments: readonly OpenableAttachment[],
  event: MouseEvent,
): void {
  const menu = new Menu();
  for (const attachment of attachments) {
    menu.addItem((item) =>
      item
        .setTitle(attachment.label)
        .setIcon("paperclip")
        .onClick(() => openAttachment(attachment)),
    );
  }

  if (event.detail === 0) {
    const { left, bottom } = event.currentTarget.getBoundingClientRect();
    menu.showAtPosition({ x: left, y: bottom });
    return;
  }
  menu.showAtMouseEvent(event.nativeEvent);
}

/**
 * Scroll one citation into view and flash it, in the document the references
 * were scanned from. `setEphemeralState` is the same path search results and
 * the core Outline plugin take; the method is public but the state fields are
 * not (read from the Obsidian 1.13 runtime). One object serves both modes:
 * editing mode reads `startLoc`/`endLoc` and flashes the exact range as an
 * `is-flashing` CM6 decoration that stays until Escape, a click, or the next
 * flash; reading view reads only `line` and flashes the enclosing block for
 * 3 s. `endLoc` must accompany `startLoc` (`null` means to end of document),
 * and `match` must stay out when `line` is set — reading view would queue two
 * scrolls. A document no editor holds open has nothing to reveal.
 */
function revealOccurrence(
  app: App,
  sourcePath: string,
  occurrence: CitationOccurrence,
): void {
  const leaf = app.workspace
    .getLeavesOfType("markdown")
    .find((candidate) => markdownViewOf(candidate)?.file?.path === sourcePath);
  const view = leaf && markdownViewOf(leaf);
  if (!leaf || !view) return;

  const { start, end } = occurrence.position;
  app.workspace.setActiveLeaf(leaf, { focus: true });
  view.setEphemeralState({
    startLoc: start,
    endLoc: end,
    line: start.line,
  });
}

function markdownViewOf(leaf: WorkspaceLeaf): MarkdownView | null {
  return leaf.view instanceof MarkdownView ? leaf.view : null;
}

export const ReferenceActionsContext = createContext<ReferenceActions | null>(
  null,
);

export function useReferenceActions(): ReferenceActions {
  const actions = useContext(ReferenceActionsContext);
  if (!actions) {
    throw new Error(
      "useReferenceActions must be used within ReferenceActionsContext",
    );
  }
  return actions;
}
