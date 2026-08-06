// Obsidian's renderer runs in a real browser window where `window` and
// `globalThis` are the same object; the `node` test environment has no
// `window` global, so source code that calls `window.setTimeout()` /
// `window.clearInterval()` etc. (for popout-window compatibility, see
// AGENTS.md → Obsidian guideline review) throws `ReferenceError: window is
// not defined` under Vitest without this stub.
globalThis.window ??= globalThis as unknown as typeof globalThis & Window;
