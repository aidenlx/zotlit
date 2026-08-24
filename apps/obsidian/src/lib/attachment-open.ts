// Sending Zotero's reader to one Item's Attachments, shared by every surface that offers the action.

import { Menu } from "obsidian";
import type { MouseEvent } from "react";

import { attachmentOpenUri } from "@zotlit/db";

import type { OpenableAttachment } from "@/services/citation-index/service";

/**
 * Open the Item's Attachment in Zotero's reader: a single Attachment opens
 * straight away, several offer a menu, and none leaves the click inert — the
 * surface hides the action rather than showing a dead one.
 */
export function openAttachments(
  attachments: readonly OpenableAttachment[],
  event: MouseEvent,
): void {
  const [first, ...rest] = attachments;
  if (!first) return;
  if (rest.length === 0) {
    openAttachment(first);
    return;
  }
  showAttachmentMenu(attachments, event);
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
