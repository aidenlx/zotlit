// The user's answer to `confirm` / `awaitConfirm` dialogs in a test.
import { ButtonComponent, ConfirmationModal } from "obsidian";
import { vi } from "vitest";

/**
 * Answer every confirmation dialog the way the user would: take the action
 * when `confirmed`, else close it. `opened` records each dialog; dispose to
 * restore the dialog.
 */
export function answerConfirmation(confirmed: boolean) {
  const clicked = vi.spyOn(ButtonComponent.prototype, "onClick");
  const opened = vi
    .spyOn(ConfirmationModal.prototype, "open")
    .mockImplementation(function (this: ConfirmationModal) {
      if (!confirmed) return this.close();
      const press = clicked.mock.calls.at(-1)![0];
      press(new MouseEvent("click"));
    });
  return {
    opened,
    [Symbol.dispose]() {
      opened.mockRestore();
      clicked.mockRestore();
    },
  };
}
