// The menus ZotLit builds itself, raised on the workspace the way Obsidian
// raises `file-menu` and `editor-menu`.
//
// ZotLit fills each menu with its own entries, then raises its event; a
// listener — another plugin, or a ZotLit feature — adds entries to the same
// menu before it shows. Each menu registers its sections first, so a listener's
// entry joins the group it names rather than sorting after "Delete".
//
// A listener runs synchronously, as Obsidian builds a menu in one tick; only an
// entry's `onClick` may await.
//
//   app.workspace.on("zotlit:annotation-menu", (menu, { annotations }) => {
//     menu.addItem((item) =>
//       item.setSection("clipboard").setTitle("Copy as …").setIcon("copy"),
//     );
//   });
import type { EditorView } from "@codemirror/view";
import type { Menu, Workspace } from "obsidian";

import type { AnnotationRecord } from "@/services/annotation-repository/service";
import type { ObsidianOpenableAttachment } from "@/services/attachment-open/resolve";
import type { CitekeyResolution } from "@/services/citation-index/service";
import type { ZoteroOpenableAttachment } from "@/services/citation-index/sources";
import type { CitedWork } from "@/services/citekey-navigation/intent";
import type { MarkTool } from "@/services/pdf-annotation-editor/tools";
import type { EditorSurface } from "@/views/annot-view/editor-sheet";

/** What each ZotLit menu event hands its listeners beside the menu. */
export interface ZotLitMenuEvents {
  /**
   * An annotation card's menu in the Annotation View: one card, or every
   * Selected Card when the user opened it over several.
   */
  "zotlit:annotation-menu": {
    source: "annotation-view";
    annotations: readonly AnnotationRecord[];
  };
  /**
   * Zotero's annotation colours: for annotations already made, or for the
   * tool that makes the next one in the PDF reader.
   */
  "zotlit:annotation-color-menu":
    | {
        /** An annotation card, the card menu's colour submenu, or a mark's popup. */
        source: "annotation-view" | "pdf-mark";
        annotations: readonly AnnotationRecord[];
      }
    | { source: "pdf-tool"; tool: MarkTool };
  /** The context menu of the editor that writes an annotation's comment or text. */
  "zotlit:comment-editor-menu": {
    /** Where the editor stands: a card, an excerpt, or a mark's popup. */
    surface: EditorSurface;
    editor: EditorView;
  };
  /** The picker over an Item's Attachments, when there is more than one. */
  "zotlit:attachments-menu": {
    attachments: readonly (
      | ObsidianOpenableAttachment
      | ZoteroOpenableAttachment
    )[];
  };
  /** The picker over the works one Rendered Citation names, when it names several. */
  "zotlit:cited-works-menu": { works: readonly CitedWork[] };
  /** A Cited Work Node's menu in the graph: the citekey the node stands for. */
  "zotlit:graph-cited-work-menu": {
    citekey: string;
    /** What the citekey names; `null` while the resolution snapshot is cold. */
    resolution: CitekeyResolution | null;
  };
}

export type ZotLitMenuEvent = keyof ZotLitMenuEvents;

/**
 * Each menu's sections, in the order it shows them. `""` is the unnamed
 * section; `danger` holds what cannot be undone.
 */
export const MENU_EVENT_SECTIONS = {
  "zotlit:annotation-menu": [
    "action",
    "clipboard",
    "insert",
    "view",
    "",
    "danger",
  ],
  "zotlit:annotation-color-menu": ["color", "ink-width", "font-size", ""],
  "zotlit:comment-editor-menu": ["selection", "clipboard", ""],
  "zotlit:attachments-menu": ["open", ""],
  "zotlit:cited-works-menu": ["open", ""],
  "zotlit:graph-cited-work-menu": ["open", "clipboard", ""],
} as const satisfies Record<ZotLitMenuEvent, readonly string[]>;

/** The named sections of `E`'s menu: everything but the unnamed `""`. */
export type MenuEventSection<E extends ZotLitMenuEvent> = Exclude<
  (typeof MENU_EVENT_SECTIONS)[E][number],
  ""
>;

/**
 * `E`'s sections by name, for the entries ZotLit itself puts in that menu, so
 * an entry and the menu's registered order read one list.
 */
export function menuSections<E extends ZotLitMenuEvent>(
  name: E,
): { readonly [S in MenuEventSection<E>]: S } {
  return Object.fromEntries(
    MENU_EVENT_SECTIONS[name]
      .filter((section) => section !== "")
      .map((section) => [section, section]),
  ) as { readonly [S in MenuEventSection<E>]: S };
}

/**
 * Register the event's sections on `menu`, then raise the event so listeners
 * add their entries. Call it once ZotLit's own entries are in, and before the
 * menu shows.
 */
export function raiseMenu<E extends ZotLitMenuEvent>(
  menu: Menu,
  {
    workspace,
    name,
    info,
  }: {
    workspace: Pick<Workspace, "trigger">;
    name: E;
    info: ZotLitMenuEvents[E];
  },
): void {
  menu.addSections(MENU_EVENT_SECTIONS[name]);
  workspace.trigger(name, menu, info);
}
