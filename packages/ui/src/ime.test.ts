import { describe, expect, it } from "vitest";

import { composing } from "./ime";

/** The fields `composing` reads, as a keydown reports them. */
const key = (isComposing: boolean, keyCode: number) =>
  ({ isComposing, keyCode }) as KeyboardEvent;

describe("composing", () => {
  it("leaves a key to the input method while it composes", () => {
    expect(composing(key(true, 13))).toBe(true);
  });

  it("leaves the keystroke Chromium reports as 229 to the input method", () => {
    expect(composing(key(false, 229))).toBe(true);
  });

  it("hands a plain key to the field", () => {
    expect(composing(key(false, 13))).toBe(false);
  });

  it("reads a React event through its native one", () => {
    expect(composing({ nativeEvent: key(true, 27) })).toBe(true);
  });
});
