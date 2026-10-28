// The verbs over one Annotation or a group that both surfaces share: the
// Annotation View's menus and keys, and the Obsidian PDF view's keys and Mark
// Popup. A delete asks once, and a group names its count; one mark in the PDF
// is erased with no question.
import type { ConfirmOptions } from "@/lib/confirm";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import * as toast from "@/lib/toast";
import type { AnnotationRecord } from "@/services/annotation-repository/service";

import type { CardBlock } from "./card-controls";
import { copiedText } from "./copied-text";

/**
 * The confirmation a delete of `count` Annotations asks for. An erase leaves
 * Zotero holding nothing, and the Annotation History puts it back only under a
 * new key, so the delete asks once, and a group names its count.
 */
export function deleteConfirmation(count: number): ConfirmOptions {
  return {
    ...(count > 1
      ? {
          title: m.annot_view_delete_group_confirm_title({ count }),
          content: m.annot_view_delete_group_confirm_content(),
        }
      : {
          title: m.annot_view_delete_confirm_title(),
          content: m.annot_view_delete_confirm_content(),
        }),
    action: m.annot_view_delete_confirm_action(),
    destructive: true,
  };
}

/**
 * Put the text of these cards on the clipboard as `text/plain`, by the one
 * rule of {@link copiedText}.
 *
 * @param cards in list order.
 * @returns whether there was text to copy; nothing is written where none is.
 */
export function copyText(
  cards: readonly Pick<AnnotationRecord, "text" | "comment">[],
): boolean {
  const text = copiedText(cards);
  if (text === "") return false;
  void toast.promise(navigator.clipboard.writeText(text), {
    success: m.annot_view_copied_text(),
    error: m.annot_view_copy_failed(),
  });
  return true;
}

/**
 * The notice a press on a blocked control raises, on every press: the reason,
 * and "Allow editing" where the block is one the user can end.
 *
 * @param onAllowEditing runs from the notice's "Allow editing".
 */
export function blockedNotice(
  block: CardBlock,
  onAllowEditing: () => void,
): void {
  if (block.action === null) {
    new BaseNotice(block.reason);
    return;
  }
  const notice = new BaseNotice(
    BaseNotice.render((renderer) => {
      renderer.setTitle(block.reason);
      renderer.addAction((button) => {
        button.setButtonText(m.capability_enable_editing()).onClick(() => {
          notice.hide();
          onAllowEditing();
        });
      });
    }),
  );
}
