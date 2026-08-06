// Obsidian's renderer runs in a real browser window where `window` and
// `globalThis` are the same object; the `node` test environment has no
// `window` global, so source code that calls `window.setTimeout()` /
// `window.clearInterval()` etc. (for popout-window compatibility, see
// AGENTS.md → Obsidian guideline review) throws `ReferenceError: window is
// not defined` under Vitest without this stub.
globalThis.window ??= globalThis as unknown as typeof globalThis & Window;

// Obsidian's `createFragment()` global, which the plugin uses over
// `document.createDocumentFragment()` (see AGENTS.md → Obsidian guideline
// review). It reads `document` only when called, so a `node`-environment test
// that never builds a fragment stays unaffected.
const globals = globalThis as typeof globalThis & {
  createFragment?: (
    callback?: (el: DocumentFragment) => void,
  ) => DocumentFragment;
};
globals.createFragment ??= (callback) => {
  const fragment = document.createDocumentFragment();
  callback?.(fragment);
  return fragment;
};
