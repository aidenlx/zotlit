import { ConfirmationModal } from "obsidian";
import type { App } from "obsidian";

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

export interface ConfirmWithCheckboxOptions extends ConfirmOptions {
  checkbox: string;
}

export interface CheckboxConfirmation {
  confirmed: boolean;
  checked: boolean;
}

/** Confirm one action with an unchecked, explicit opt-in beside it. */
export function confirmWithCheckbox(
  options: ConfirmWithCheckboxOptions,
  app: App,
): Promise<CheckboxConfirmation> {
  const { action, cancel, title, content, destructive, cta, checkbox } =
    options;
  const { resolve, promise } = Promise.withResolvers<CheckboxConfirmation>();
  const modal = new ConfirmationModal(app);
  let checked = false;
  modal.setTitle(title);
  if (content) modal.setContent(content);
  modal.addCheckbox(checkbox, (value) => {
    checked = value;
  });
  modal.addButton((btn) => {
    btn
      .setButtonText(action)
      .onClick(() => resolve({ confirmed: true, checked }));
    if (destructive) btn.setDestructive();
    if (cta) btn.setCta();
  });
  modal.addCancelButton(cancel ?? m.modal_cancel());
  modal.setCloseCallback(() => resolve({ confirmed: false, checked: false }));
  modal.open();
  return promise;
}
