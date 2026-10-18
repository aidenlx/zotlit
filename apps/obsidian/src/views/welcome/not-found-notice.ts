// The notice of a Zotero data folder this device does not have is the state
// "Zotero is not found", not one per signal: at most one shows, it goes once
// the database reads again, and none shows while a Library View is open,
// whose not-found card says the same and offers to locate the folder.
//
// @see apps/obsidian/docs/adr/0077-the-library-view-is-the-first-screen.md

/**
 * What changes the notice: the database found no data folder, read again,
 * or the workspace changed its tabs.
 */
export type NotFoundSignal = "db-file-missing" | "changed" | "layout-change";

/**
 * What `signal` does to the notice: show it, hide it, or `null` for nothing.
 * `shown` says whether the notice still shows, as the researcher can dismiss
 * it; `libraryOpen` whether a Library View is open.
 */
export function notFoundNoticeChange(
  signal: NotFoundSignal,
  { shown, libraryOpen }: { shown: boolean; libraryOpen: boolean },
): "show" | "hide" | null {
  switch (signal) {
    case "db-file-missing":
      return shown || libraryOpen ? null : "show";
    case "changed":
      return shown ? "hide" : null;
    case "layout-change":
      return shown && libraryOpen ? "hide" : null;
  }
}
