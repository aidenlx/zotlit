import { ConfirmationModal } from "obsidian";
import type { App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { modalAnswer } from "@/lib/modal-answer";

export interface ConfirmOptions {
  title: string;
  content?: string;
  action: string;
  cancel?: string;
  destructive?: boolean;
  cta?: boolean;
}

/** `true` once the user takes the action; `false` when the modal closes. */
export function confirm(options: ConfirmOptions, app: App): Promise<boolean> {
  const { action, cancel, title, content, destructive, cta } = options;
  return modalAnswer<boolean>((resolve) => {
    const modal = new ConfirmationModal(app);
    modal.setTitle(title);
    if (content) {
      modal.setContent(content);
    }
    modal.addButton((btn) => {
      btn.setButtonText(action).onClick(() => resolve(true));
      if (destructive) {
        btn.setDestructive();
      }
      if (cta) {
        btn.setCta();
      }
    });
    modal.addCancelButton(cancel ?? m.modal_cancel());
    modal.setCloseCallback(() => resolve(false));

    modal.open();
    return modal;
  });
}
