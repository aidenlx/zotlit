// What a Citation Popover entry can do: reach its Literature Note, its Zotero Item, and its Attachments.

import { Keymap } from "obsidian";
import type { App } from "obsidian";
import type { MouseEvent } from "react";

import { itemSelectUri } from "@zotlit/db";

import { openAttachments, zoteroAttachmentReader } from "@/lib/attachment-open";
import { getLogger } from "@/lib/log";
import type { MenuAnchor } from "@/lib/menu";
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
  /** Hosts the Attachment picker. */
  app: App;
  /** The open-or-create flow the hovering surface carries. */
  open: (block: CitationEntryBlock, pane: NavigationPane) => void;
  /** Hide the popover the entries are shown in. */
  hide: () => void;
  switchProfile: (path: string) => void;
  /** Refresh source-less Item availability before any action. */
  prepare?: (block: CitationEntryBlock) => Promise<CitationEntryBlock | null>;
}

export function createCitationPopoverActions({
  app,
  open,
  hide,
  switchProfile,
  prepare,
}: CitationPopoverActionDeps): CitationPopoverActions {
  /** Whether the last action ran; `onDone` hides only after one that did. */
  let completed: boolean | Promise<boolean> = true;
  /**
   * Run `action` on the block as it stands now. Without `prepare` the action
   * runs at once; with it, once the fresh read settles.
   */
  const act = (
    block: CitationEntryBlock,
    action: (current: CitationEntryBlock) => void,
  ): void => {
    if (!prepare) {
      action(block);
      completed = true;
      return;
    }
    completed = prepare(block).then((current) => {
      if (current) action(current);
      return current !== null;
    });
  };
  return {
    onOpenNote(block, event) {
      const pane = navigationPaneOf(event);
      act(block, (current) => {
        logger.debug("Citation popover opens note", {
          citekey: block.citekey,
          pane,
        });
        open(current, pane);
      });
    },
    onOpenInZotero(block) {
      act(block, (current) => {
        logger.debug("Citation popover selects in Zotero", {
          itemKey: block.itemKey,
        });
        window.open(itemSelectUri(current.itemKey, current.groupID));
      });
    },
    onOpenAttachment(block, event) {
      // With `prepare` the picker opens after the fresh read, when the button
      // is no longer the event's target, so its box is read while dispatch is
      // live. Without it the picker opens at once, on the button itself.
      const button = event.currentTarget as HTMLElement;
      const anchor: MenuAnchor | undefined = prepare
        ? { rect: button.getBoundingClientRect(), doc: button.ownerDocument }
        : undefined;
      act(block, (current) => {
        logger.debug("Citation popover opens an attachment", {
          itemKey: block.itemKey,
          attachments: block.attachments.length,
        });
        openAttachments(current.attachments, {
          reader: zoteroAttachmentReader,
          app,
          event,
          anchor,
        });
      });
    },
    onDone: () => {
      if (typeof completed === "boolean") {
        if (completed) hide();
        return;
      }
      void completed.then((done) => {
        if (done) hide();
      });
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
