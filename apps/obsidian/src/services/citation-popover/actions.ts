// What a Citation Popover entry can do: reach its Literature Note, its Zotero Item, and its Attachments.

import { Keymap } from "obsidian";
import type { MouseEvent } from "react";

import { itemSelectUri } from "@zotlit/db";

import { openAttachments } from "@/lib/attachment-open";
import { getLogger } from "@/lib/log";
import type { NavigationPane } from "@/services/citekey-navigation";

import type { CitationEntryBlock } from "./blocks";

const logger = getLogger("citation-popover");

export interface CitationPopoverActions {
  /**
   * Open the work's Literature Note, creating it first when it has none. A
   * Mod-click and a middle-click open a new pane, as they do on every citation.
   */
  onOpenNote: (block: CitationEntryBlock, event: MouseEvent) => void;
  onOpenInZotero: (block: CitationEntryBlock) => void;
  /**
   * Open the work's Attachment in Zotero's reader: one opens straight away,
   * several offer a menu.
   */
  onOpenAttachment: (block: CitationEntryBlock, event: MouseEvent) => void;
  /** Every action leaves the popover closed over what it just opened. */
  onDone: () => void;
  onSwitchProfile: (path: string) => void;
}

export interface CitationPopoverActionDeps {
  /** The open-or-create flow the hovering surface carries. */
  open: (block: CitationEntryBlock, pane: NavigationPane) => void;
  /** Hide the popover the entries are shown in. */
  hide: () => void;
  switchProfile: (path: string) => void;
  /** Refresh source-less Item availability before any action. */
  prepare?: (block: CitationEntryBlock) => CitationEntryBlock | null;
}

export function createCitationPopoverActions({
  open,
  hide,
  switchProfile,
  prepare,
}: CitationPopoverActionDeps): CitationPopoverActions {
  let completed = true;
  const read = (block: CitationEntryBlock): CitationEntryBlock | null => {
    const current = prepare ? prepare(block) : block;
    completed = current !== null;
    return current;
  };
  return {
    onOpenNote(block, event) {
      const current = read(block);
      if (!current) return;
      const pane = navigationPaneOf(event);
      logger.debug("Citation popover opens note", {
        citekey: block.citekey,
        pane,
      });
      open(current, pane);
    },
    onOpenInZotero(block) {
      const current = read(block);
      if (!current) return;
      logger.debug("Citation popover selects in Zotero", {
        itemKey: block.itemKey,
      });
      window.open(itemSelectUri(current.itemKey, current.groupID));
    },
    onOpenAttachment(block, event) {
      const current = read(block);
      if (!current) return;
      logger.debug("Citation popover opens an attachment", {
        itemKey: block.itemKey,
        attachments: block.attachments.length,
      });
      openAttachments(current.attachments, event);
    },
    onDone: () => {
      if (completed) hide();
    },
    onSwitchProfile: switchProfile,
  };
}

/**
 * Obsidian owns the modifier-to-pane mapping, except for the middle click it
 * reads off `mousedown` and answers nothing for.
 */
function navigationPaneOf(event: MouseEvent): NavigationPane {
  return event.button === 1 ? "tab" : Keymap.isModEvent(event.nativeEvent);
}
