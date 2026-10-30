// The notice of a Zotero data folder this device does not have is the state
// "Zotero is not found": what each signal does to it.
import { expect, it } from "vitest";

import { notFoundNoticeChange } from "./not-found-notice";

it.each([
  // A miss shows the notice once, however often it comes.
  ["db-file-missing", { shown: false, libraryOpen: false }, "show"],
  ["db-file-missing", { shown: true, libraryOpen: false }, null],
  // An open Library View's not-found card says the same.
  ["db-file-missing", { shown: false, libraryOpen: true }, null],
  // The notice goes once Zotero's database reads again.
  ["changed", { shown: true, libraryOpen: false }, "hide"],
  ["changed", { shown: false, libraryOpen: false }, null],
  // A Library View opened another way takes over from the notice.
  ["layout-change", { shown: true, libraryOpen: true }, "hide"],
  ["layout-change", { shown: true, libraryOpen: false }, null],
  ["layout-change", { shown: false, libraryOpen: true }, null],
] as const)("on %s with %o the notice does %s", (signal, now, change) => {
  expect(notFoundNoticeChange(signal, now)).toBe(change);
});
