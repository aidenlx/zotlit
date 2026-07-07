import { type App, ConfirmationModal, requireApiVersion } from "obsidian";

import * as m from "@/paraglide/messages";

export interface ConfirmOptions {
  title: string;
  content?: string;
  action: string;
  cancel?: string;
  destructive?: boolean;
}

export function confirm(options: ConfirmOptions, app: App): Promise<boolean> {
  // ConfirmationModal was added in Obsidian 1.13.0; older builds fall back to window.confirm.
  if (!requireApiVersion("1.13.0")) {
    const message = options.content
      ? `${options.title}\n\n${options.content}`
      : options.title;
    return Promise.resolve(window.confirm(message));
  }

  const { action, cancel, title, content, destructive } = options;
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
