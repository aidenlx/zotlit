import type { Effect } from "effect";
import { ConfirmationModal } from "obsidian";
import type { App } from "obsidian";

import { awaitModal } from "@/lib/effect-modal";
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

/** @returns `true` once the user takes the action; `false` when the modal closes. */
export function confirm(options: ConfirmOptions, app: App): Promise<boolean> {
  return modalAnswer<boolean>((resolve) =>
    openConfirmation(options, app, resolve),
  );
}

/**
 * {@link confirm} for Effect code.
 *
 * @returns `true` once the user takes the action; `false` when the modal
 *   closes. An interrupt closes the modal.
 */
export function awaitConfirm(
  options: ConfirmOptions,
  app: App,
): Effect.Effect<boolean> {
  return awaitModal<boolean>((resolve) =>
    openConfirmation(options, app, resolve),
  );
}

/** Open the confirmation modal; `resolve` gets the user's answer. */
function openConfirmation(
  options: ConfirmOptions,
  app: App,
  resolve: (answer: boolean) => void,
): ConfirmationModal {
  const { action, cancel, title, content, destructive, cta } = options;
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
}
