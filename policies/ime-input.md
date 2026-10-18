# IME input

- **Composition:** A key handler that commits, cancels, or moves on from text input returns early while `composing(event)` from `apps/obsidian/src/lib/ime.ts` holds, so Enter and Escape reach the input method that takes or drops a candidate. Check every `keydown` handler and `Scope` key registration on a text field, a contenteditable, or a suggest attached to one, including inline editors that render inside another control.
- **Tests:** happy-dom never composes, so a passing view test proves nothing here. The handler under review needs the guard by reading, and a test that sends `isComposing` or key 229 when it adds one.
