import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber } from "effect";
import { ButtonComponent, ConfirmationModal, TFile } from "obsidian";
import type { App } from "obsidian";
import { afterEach, expect, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";

import { awaitUpdateNotesChoice } from "./update-notes-view";
import type { ActiveNote } from "./update-notes-view";

const activeNote = (): ActiveNote => ({
  file: new TFile(),
  itemKey: "1:ABCD2345",
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The open dialog: its buttons by label, and its checkbox's change handler. */
const openDialog = Effect.fnUntraced(function* (note?: ActiveNote) {
  const shown = Deferred.makeUnsafe<void>();
  const labels = vi.spyOn(ButtonComponent.prototype, "setButtonText");
  const clicks = vi.spyOn(ButtonComponent.prototype, "onClick");
  const checkbox = vi.spyOn(ConfirmationModal.prototype, "addCheckbox");
  const opened = vi
    .spyOn(ConfirmationModal.prototype, "open")
    .mockImplementation(() => {
      Deferred.doneUnsafe(shown, Exit.void);
    });
  const fiber = yield* Effect.forkChild(
    awaitUpdateNotesChoice(stubService<App>("App", {}), note),
  );
  yield* Deferred.await(shown);
  return {
    fiber,
    labels: labels.mock.calls.map(([label]) => label),
    press: (label: string) => {
      const index = labels.mock.calls.findIndex(([text]) => text === label);
      clicks.mock.calls[index]![0]({} as MouseEvent);
    },
    tick: (checked: boolean) => checkbox.mock.calls[0]![1](checked),
    close: () => (opened.mock.instances[0] as ConfirmationModal).close(),
  };
});

it.effect("updates the active note from its own button", () =>
  Effect.gen(function* () {
    const note = activeNote();
    const dialog = yield* openDialog(note);
    dialog.press(m.modal_update_notes_active());
    expect(yield* Fiber.join(dialog.fiber)).toEqual({ target: "note", note });
  }),
);

it.effect("leaves note creation off until the user asks for it", () =>
  Effect.gen(function* () {
    const dialog = yield* openDialog(activeNote());
    dialog.press(m.modal_update_notes_all());
    expect(yield* Fiber.join(dialog.fiber)).toEqual({
      target: "all",
      create: false,
    });
  }),
);

it.effect("creates missing notes when the user asks for it", () =>
  Effect.gen(function* () {
    const dialog = yield* openDialog(activeNote());
    dialog.tick(true);
    dialog.press(m.modal_update_notes_all());
    expect(yield* Fiber.join(dialog.fiber)).toEqual({
      target: "all",
      create: true,
    });
  }),
);

it.effect("offers only all notes when no literature note is active", () =>
  Effect.gen(function* () {
    const dialog = yield* openDialog();
    expect(dialog.labels).toEqual([m.modal_update_notes_all()]);
    dialog.close();
    yield* Fiber.join(dialog.fiber);
  }),
);

it.effect("answers null when the dialog closes", () =>
  Effect.gen(function* () {
    const dialog = yield* openDialog(activeNote());
    dialog.close();
    expect(yield* Fiber.join(dialog.fiber)).toBeNull();
  }),
);
