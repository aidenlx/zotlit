/**
 * Whether a keystroke belongs to an in-flight IME composition, which a text
 * field leaves to the input method: Enter that takes a candidate, Escape that
 * drops one. Obsidian's keymap offers no such guard, so each handler asks.
 * `keyCode` 229 is the keystroke Chromium reports before `isComposing` turns
 * true. A React event is read through its native one.
 */
export function composing(
  event: KeyboardEvent | { readonly nativeEvent: KeyboardEvent },
): boolean {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229;
}
