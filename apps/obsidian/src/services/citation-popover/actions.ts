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
  open: (citekey: string, pane: NavigationPane) => void;
  /** Hide the popover the entries are shown in. */
  hide: () => void;
  switchProfile: (path: string) => void;
}

export function createCitationPopoverActions({
  open,
  hide,
  switchProfile,
}: CitationPopoverActionDeps): CitationPopoverActions {
  return {
    onOpenNote(block, event) {
      const pane = navigationPaneOf(event);
      logger.debug("Citation popover opens note", {
        citekey: block.citekey,
        pane,
      });
      open(block.citekey, pane);
    },
    onOpenInZotero(block) {
      // No reachability guard: the entry only shows because the Item resolved,
      // and a Zotero-side deletion in between fails soft inside Zotero.
      logger.debug("Citation popover selects in Zotero", {
        itemKey: block.itemKey,
      });
      window.open(itemSelectUri(block.itemKey, block.groupID));
    },
    onOpenAttachment(block, event) {
      logger.debug("Citation popover opens an attachment", {
        itemKey: block.itemKey,
        attachments: block.attachments.length,
      });
      openAttachments(block.attachments, event);
    },
    onDone: hide,
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
