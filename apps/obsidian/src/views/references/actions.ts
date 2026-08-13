// What a References Sidebar entry can do: navigate the document, and reach the Item in Zotero.

import { Menu } from "obsidian";
import type { App } from "obsidian";
import { createContext, useContext } from "react";
import type { MouseEvent } from "react";

import { attachmentOpenUri, itemSelectUri } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { revealMarkdownOccurrence } from "@/views/reveal-occurrence";

import { toCopiedBibliography } from "./copied-bibliography";
import type { CopiedBibliographyEntry } from "./copied-bibliography";
import type {
  OpenableAttachment,
  ReferenceEntry,
  ReferenceSource,
} from "./entries";

const logger = getLogger(["views", "references"]);

/** The completed bibliography one copy is taken from, and what it answers for. */
export interface CopyBibliographySnapshot {
  /** Path of the Markdown note whose Document Citation Set the entries cover. */
  path: string;
  /** The completed render generation the entries came from. */
  generation: number;
  entries: readonly CopiedBibliographyEntry[];
}

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
  /** Reveal the Citation and References Style row in settings. */
  onChangeStyle: () => void;
  /** Dismiss the install hint for good. */
  onDismissEngineHint: () => void;
  /** Put the current bibliography on the clipboard as a Copied Bibliography. */
  onCopyBibliography: () => Promise<void>;
}

export interface ReferenceActionDeps {
  app: App;
  /** Path of the document the listed references were scanned from. */
  getSourcePath: () => string | null;
  /** Open the Literature Note of the Item a citekey names, creating it first when it has none. */
  openCitekey: (citekey: string) => void;
  onOpenEngineSettings: () => void;
  onChangeStyle: () => void;
  onDismissEngineHint: () => void;
  /** The bibliography a copy would take, or `null` while copy is unavailable. */
  getCopySnapshot: () => CopyBibliographySnapshot | null;
  /** Hand the serialized snapshot to the platform clipboard. */
  writeClipboard: (text: string) => Promise<void>;
  /** Show one transient message; the seam that owns notices supplies it. */
  notify: (message: string) => void;
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
      revealMarkdownOccurrence({
        app: deps.app,
        sourcePath,
        occurrence: entry.occurrences[next]!,
      });
    },
    onOpenNote(entry) {
      // An unresolved citekey reaches no note, and a missing entry's Item
      // could not be read at all; both keep their row's action disabled.
      if (
        entry.kind === "unresolved" ||
        entry.kind === "missing" ||
        entry.kind === "malformed"
      ) {
        return;
      }
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
    onChangeStyle: deps.onChangeStyle,
    onDismissEngineHint: deps.onDismissEngineHint,
    async onCopyBibliography() {
      const snapshot = deps.getCopySnapshot();
      if (!snapshot) return;
      const { text } = toCopiedBibliography(snapshot.entries);

      // Read the snapshot again at the commit point: preparing the payload
      // leaves the pane free to follow another note or finish a newer render,
      // and a write that lands after that would copy a bibliography the
      // sidebar no longer shows.
      const current = deps.getCopySnapshot();
      if (
        !current ||
        current.path !== snapshot.path ||
        current.generation !== snapshot.generation
      ) {
        logger.debug("Bibliography snapshot changed before the copy", {
          path: snapshot.path,
          generation: snapshot.generation,
        });
        deps.notify(m.references_copy_changed());
        return;
      }

      try {
        await deps.writeClipboard(text);
      } catch (error) {
        logger.error("Cannot copy the bibliography snapshot", {
          path: snapshot.path,
          error,
        });
        deps.notify(m.references_copy_failed());
        return;
      }
      logger.debug("Bibliography snapshot copied", {
        path: snapshot.path,
        generation: snapshot.generation,
        count: snapshot.entries.length,
      });
      deps.notify(m.references_copy_copied());
    },
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
