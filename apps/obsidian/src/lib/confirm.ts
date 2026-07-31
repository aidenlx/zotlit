import { type App, ConfirmationModal } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

export interface ConfirmOptions {
  title: string;
  content?: string;
  action: string;
  cancel?: string;
  destructive?: boolean;
  cta?: boolean;
}

export function confirm(options: ConfirmOptions, app: App): Promise<boolean> {
  const { action, cancel, title, content, destructive, cta } = options;
  const { resolve, promise } = Promise.withResolvers<boolean>();
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
  return promise;
}
