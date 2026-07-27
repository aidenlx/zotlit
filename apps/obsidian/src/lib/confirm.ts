import { type App, ConfirmationModal, requireApiVersion } from "obsidian";

import * as m from "@/paraglide/messages";

import { CompatConfirmationModal } from "./confirm-modal-compat";

// ConfirmationModal was added in Obsidian 1.13.0; older builds get the
// standalone polyfill. Drop this line and its import once minAppVersion is 1.13.0.
const ConfirmationModalImpl: typeof ConfirmationModal = requireApiVersion(
  "1.13.0",
)
  ? ConfirmationModal
  : (CompatConfirmationModal as unknown as typeof ConfirmationModal);

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
  const modal = new ConfirmationModalImpl(app);
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
