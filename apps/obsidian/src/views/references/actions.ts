// What a References Sidebar entry can do: navigate the document, and reach the Item in Zotero.

import { MarkdownView, type App, type WorkspaceLeaf } from "obsidian";
import { createContext, useContext } from "react";

import {
  attachmentOpenUri,
  getAttachmentsByParents,
  itemSelectUri,
} from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { type CitationOccurrence } from "@/services/citation-scan/service";
import { type DatabaseService } from "@/services/database/service";

import { type ReferenceEntry, type ReferenceSource } from "./entries";

const logger = getLogger(["views", "references"]);

const PDF_CONTENT_TYPE = "application/pdf";

export interface ReferenceActions {
  /** Move the editor to the entry's next occurrence, wrapping at the end. */
  onSelect: (entry: ReferenceEntry) => void;
  onOpenNote: (entry: ReferenceEntry) => void;
  onOpenInZotero: (source: ReferenceSource) => void;
  onOpenAttachment: (source: ReferenceSource) => void;
  /** Open the settings page the engine install lives on. */
  onOpenEngineSettings: () => void;
  /** Dismiss the install hint for good. */
  onDismissEngineHint: () => void;
}

export interface ReferenceActionDeps {
  app: App;
  db: Pick<DatabaseService, "state" | "client">;
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
    onOpenAttachment(source) {
      const uri = pdfAttachmentUri(deps.db, source);
      if (!uri) {
        new BaseNotice(m.references_no_pdf_attachment());
        return;
      }
      window.open(uri);
    },
    onOpenEngineSettings: deps.onOpenEngineSettings,
    onDismissEngineHint: deps.onDismissEngineHint,
  };
}

/**
 * The `zotero://open` link to the Item's first PDF attachment, or `null` when
 * the Item carries none — or when the database is out of reach.
 */
function pdfAttachmentUri(
  db: ReferenceActionDeps["db"],
  source: ReferenceSource,
): string | null {
  if (db.state !== "ready") return null;
  try {
    const attachment = getAttachmentsByParents(db.client, [source.itemID]).find(
      (candidate) => candidate.contentType === PDF_CONTENT_TYPE,
    );
    if (!attachment) return null;
    return attachmentOpenUri(attachment.key, attachment.groupID);
  } catch (error) {
    logger.warn("Cannot read the attachments of {itemKey}", {
      itemKey: source.itemKey,
      error,
    });
    return null;
  }
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
