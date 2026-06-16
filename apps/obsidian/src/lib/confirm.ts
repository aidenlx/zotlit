import { type App, ConfirmationModal } from "obsidian";

import * as m from "@/paraglide/messages";

export function confirm(
  {
    action,
    cancel,
    title,
    content,
    destructive,
  }: {
    title: string;
    content?: string;
    action: string;
    cancel?: string;
    destructive?: boolean;
  },
  app: App,
): Promise<boolean> {
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
  });
  modal.addCancelButton(cancel ?? m.modal_cancel());
  modal.setCloseCallback(() => resolve(false));

  modal.open();
  return promise;
}
