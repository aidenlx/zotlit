/**
 * Backward-compatibility stand-in for Obsidian 1.13.0's `ConfirmationModal`,
 * covering the surface {@link confirm} uses: `setTitle`/`setContent` (inherited
 * from `Modal`), `addButton`, `addCancelButton`, `setCloseCallback`, and the
 * button's `setButtonText`/`onClick`/`setCta`/`setDestructive`. Markup and class
 * names mirror the built-in modal, so the app's own styles apply unchanged.
 *
 * Standalone by design: once `minAppVersion` reaches 1.13.0, delete this file
 * and the branch selecting it in `confirm.ts`.
 */

import { type App, ButtonComponent, Modal } from "obsidian";

import * as m from "@/paraglide/messages";

/** The `ConfirmationButton` subset {@link confirm} touches. */
class CompatConfirmationButton extends ButtonComponent {
  readonly #modal: Modal;

  constructor(containerEl: HTMLElement, modal: Modal) {
    super(containerEl);
    this.#modal = modal;
    // Buttons close the modal on click; a handler installed via onClick can
    // keep it open by returning truthy.
    super.onClick(() => modal.close());
  }

  override onClick(handler: (evt: MouseEvent) => unknown): this {
    return super.onClick(async (evt) => {
      const keepOpen = await handler(evt);
      if (!keepOpen) this.#modal.close();
    });
  }

  /** `ButtonComponent.setDestructive` arrived with 1.13.0; `mod-warning` is
   * the styling it replaced. Set the class directly rather than calling
   * `setWarning()` — on 1.13 that method is a deprecated alias for
   * `setDestructive()`, which would recurse back into here. */
  setDestructive(): this {
    this.buttonEl.addClass("mod-warning");
    return this;
  }

  setCancel(): this {
    this.buttonEl.addClass("mod-cancel");
    return this;
  }
}

export class CompatConfirmationModal extends Modal {
  readonly #buttonContainerEl: HTMLElement;
  #closeCallback: (() => unknown) | undefined;

  constructor(app: App) {
    super(app);
    this.containerEl.addClass("mod-confirmation");
    this.#buttonContainerEl = this.modalEl.createDiv("modal-button-container");
  }

  addButton(cb: (btn: CompatConfirmationButton) => unknown): this {
    cb(new CompatConfirmationButton(this.#buttonContainerEl, this));
    return this;
  }

  addCancelButton(text?: string): this {
    return this.addButton((btn) =>
      btn.setButtonText(text ?? m.modal_cancel()).setCancel(),
    );
  }

  /** `Modal.setCloseCallback` arrived with 1.10.0; back it with `onClose`. */
  override setCloseCallback(callback: () => unknown): this {
    this.#closeCallback = callback;
    return this;
  }

  override onClose(): void {
    this.contentEl.empty();
    this.#closeCallback?.();
  }
}
