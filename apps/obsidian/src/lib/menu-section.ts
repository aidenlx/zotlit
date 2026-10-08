// Where ZotLit's entries sit in the menus Obsidian builds and lets plugins add
// to: the file menu, a tab header's menu, and a view's "More options".
//
// Obsidian registers its section order on each of those menus before plugins
// add to them; verified against Obsidian 1.14.4's `onFileContextMenu`,
// `onOpenTabHeaderMenu`, and `ViewHeader.onMoreOptions`. `Menu.sort` places a
// section the menu never registered after every registered one — below
// "Delete" — so each ZotLit entry in those menus takes one of these sections.

/**
 * The sections of Obsidian's host menus that ZotLit's entries join, named by
 * what goes in each. Each host menu shows them in the order it registered, each
 * set off from the next by a separator; the file explorer's menu has no `pane`.
 */
export const MENU_SECTION = {
  /** How the view on screen shows its content: checked display choices. */
  pane: "pane",
  /** Opening the file or its source somewhere else. */
  open: "open",
  /** Doing something to the file or with the view's subject. */
  action: "action",
  /** Reading out or copying what identifies the file. */
  info: "info",
  /** Opening a view about the file. */
  view: "view",
  /** Replacing what the user wrote; each entry also takes `setWarning`. */
  danger: "danger",
} as const;

export type MenuSection = (typeof MENU_SECTION)[keyof typeof MENU_SECTION];
