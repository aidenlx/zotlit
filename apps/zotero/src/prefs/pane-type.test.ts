import { afterEach, expect, it, vi } from "vitest";

// `./index` pulls in `@/lib/l10n`, which constructs a `Localization` at module
// scope. Hoisted so the stub exists before the import graph is evaluated.
vi.hoisted(() => {
  (globalThis as { Localization?: unknown }).Localization = class {};
});

import { preferredPaneType } from "./pane-type";

/** Stand in for the Zotero global the `prefs` wrapper reads through. */
function storePref(value: unknown): void {
  Object.assign(globalThis, {
    Zotero: { Prefs: { get: () => value } },
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "Zotero");
});

it.each(["tab", "split", "window"] as const)(
  "names the %s pane the link should carry",
  (paneType) => {
    storePref(paneType);
    expect(preferredPaneType()).toBe(paneType);
  },
);

it.each([
  ["the active-tab choice", "active"],
  ["an unset pref", undefined],
  ["a hand-edited value Obsidian has no pane for", "popout"],
  ["a non-string value", 3],
])("leaves the pane unnamed for %s", (_label, stored) => {
  storePref(stored);
  expect(preferredPaneType()).toBeUndefined();
});
