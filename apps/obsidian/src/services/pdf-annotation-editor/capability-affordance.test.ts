// @vitest-environment happy-dom
import { expect, it } from "vitest";

import { isEditGesture } from "./capability-affordance";

it("reads the reader's edit keystrokes, and nothing else, as edit gestures", () => {
  const gesture = (init: KeyboardEventInit, target?: HTMLElement): boolean => {
    const event = new KeyboardEvent("keydown", init);
    if (target) target.dispatchEvent(event);
    return isEditGesture(event);
  };

  expect(["h", "u", "c", "1", "8", "H"].map((key) => gesture({ key }))).toEqual(
    [true, true, true, true, true, true],
  );
  // `9` is not one of the eight colours, and the rest are other people's keys.
  expect(["9", "0", "x", "Escape"].map((key) => gesture({ key }))).toEqual([
    false,
    false,
    false,
    false,
  ]);
  // A modified key belongs to Obsidian's own commands.
  expect(gesture({ key: "h", ctrlKey: true })).toBe(false);
  expect(gesture({ key: "h", metaKey: true })).toBe(false);
  expect(gesture({ key: "h", altKey: true })).toBe(false);

  // A keystroke inside a text field belongs to the field.
  const field = document.createElement("input");
  document.body.append(field);
  expect(gesture({ key: "h", bubbles: true }, field)).toBe(false);
  field.remove();
});
