// What a References Sidebar entry can do: navigate the document, and reach the Item in Zotero.

import { MarkdownView, Menu, type App, type WorkspaceLeaf } from "obsidian";
import { createContext, useContext, type MouseEvent } from "react";

import { attachmentOpenUri, itemSelectUri } from "@zotlit/db";

import { type CitationOccurrence } from "@/services/citation-scan/service";

import {
  type OpenableAttachment,
  type ReferenceEntry,
  type ReferenceSource,
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
        ((cursors.get(entry.indexedKey) ?? -1) + 1) % entry.occurrences.length;
      cursors.set(entry.indexedKey, next);
      revealOccurrence(deps.app, sourcePath, entry.occurrences[next]!);
    },
    onOpenNote(entry) {
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
 * Put the cursor on one citation in the document the references were scanned
 * from. A document no editor holds open has nothing to reveal.
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

  app.workspace.setActiveLeaf(leaf, { focus: true });
  const position = { line: occurrence.line, ch: occurrence.col };
  view.editor.setCursor(position);
  view.editor.scrollIntoView({ from: position, to: position }, true);
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
