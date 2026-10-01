# View cleanup

Every test in the End-to-end Run leaves the vault as it found it: the next test in the file opens the same views on the same files. This applies the root [test isolation](../../../policies/test-isolation.md) policy to Obsidian views.

- Register each cleanup on the eval's `await using` `AsyncDisposableStack` right after the state it undoes — the file restore and the view detach — before the first action that can throw. Assertions in the test file then read a vault already restored.
- Detach every leaf type the action opens, the plugin's side-effect views included: Customize opens the Template Workbench beside `zotlit-template-data-explorer` and `zotlit-note-preview`.
- Adopt a leaf the test opens itself with `cleanup.adopt(leaf, (leaf) => leaf.detach())`.

The reviewer checks each new `obEval` that opens a view or edits a file: every cleanup sits on the stack before the code that can fail, and the detach list names each view type the opened surface brings along.
