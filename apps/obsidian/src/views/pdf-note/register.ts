// The Literature Note of the Item a PDF view shows, opened or written from
// that view: a view-header action, a "More options" entry and a command. Each
// stands on an Obsidian PDF view bound to a Zotero Attachment with a parent
// Item, and on no other view. The note opens beside the PDF, so the reader
// keeps both on screen; a tab that already shows the note comes forward.
import { FileView, setIcon, setTooltip } from "obsidian";
import type { App, Plugin, View, WorkspaceLeaf } from "obsidian";

import type { EffectBridge } from "@/lib/effect-bridge";
import * as m from "@/lib/i18n/generated/messages";
import { MENU_SECTION } from "@/lib/menu-section";
import type { ViewRegistryHandle } from "@/lib/view-atoms";
import type { FileMenuSegment } from "@/services/file-menu";
import type { InteractiveCreationPorts } from "@/services/note-feature/creation-view";
import type { ReaderSession } from "@/services/reader-session/session";
import type { LiteratureNotes } from "@/views/query-view/table-notes";

import { openNoteBeside, pdfNoteCommand } from "./open-note";
import type { PdfSessions } from "./open-note";

export interface PdfNoteDeps {
  app: App;
  bridge: Pick<EffectBridge, "subscribe">;
  /** The Reader Session of each bound PDF view. */
  sessions: PdfSessions;
  literatureNotes: Pick<LiteratureNotes, "find" | "on">;
  registry: ViewRegistryHandle;
  creation: InteractiveCreationPorts;
}

/** The header action of one bound PDF view. */
interface HeaderAction {
  readonly session: ReaderSession;
  readonly el: HTMLElement;
  readonly off: () => void;
}

/**
 * Add the PDF view's literature note controls: the header action on each
 * bound PDF view and the `open-pdf-literature-note` command.
 *
 * @returns the "More options" entry, for the file menu's ordered list.
 */
export function registerPdfNote(
  plugin: Pick<Plugin, "addCommand" | "register">,
  deps: PdfNoteDeps,
): FileMenuSegment {
  const { app } = deps;
  // An open can outlive the PDF view that started it.
  plugin.register(deps.registry.mount(pdfNoteCommand));
  let sessions: ReadonlyMap<View, ReaderSession> = new Map();
  const actions = new Map<View, HeaderAction>();

  /** The parent Item of the Attachment `view` shows; `null` where it has none. */
  const itemKeyOf = (view: View | null | undefined): string | null =>
    (view && sessions.get(view)?.target?.itemKey) ?? null;

  const label = (itemKey: string) =>
    deps.literatureNotes.find(itemKey)
      ? { title: m.library_view_menu_open_note(), icon: "notebook-pen" }
      : { title: m.library_view_menu_write_note(), icon: "file-plus" };

  const openNote = (leaf: WorkspaceLeaf, itemKey: string) =>
    deps.registry.set(
      pdfNoteCommand,
      openNoteBeside(deps.creation, leaf, itemKey),
    );

  const render = (view: View, { el }: HeaderAction) => {
    const itemKey = itemKeyOf(view);
    el.toggle(itemKey !== null);
    if (itemKey === null) return;
    const { title, icon } = label(itemKey);
    setIcon(el, icon);
    setTooltip(el, title);
  };

  const detach = (view: View, action: HeaderAction) => {
    action.off();
    action.el.remove();
    actions.delete(view);
  };

  const sync = (next: ReadonlyMap<View, ReaderSession>) => {
    sessions = next;
    for (const [view, action] of actions)
      if (next.get(view) !== action.session) detach(view, action);
    for (const [view, session] of next) {
      if (actions.has(view) || !(view instanceof FileView)) continue;
      const el = view.addAction("file-plus", "", () => {
        const itemKey = itemKeyOf(view);
        if (itemKey) openNote(view.leaf, itemKey);
      });
      const action: HeaderAction = {
        session,
        el,
        off: session.on("target-changed", () => render(view, action)),
      };
      actions.set(view, action);
      render(view, action);
    }
  };

  const unsubscribe = deps.bridge.subscribe(deps.sessions, sync);
  const offNotes = deps.literatureNotes.on("changed", () => {
    for (const [view, action] of actions) render(view, action);
  });
  plugin.register(() => {
    unsubscribe();
    offNotes();
    for (const [view, action] of actions) detach(view, action);
  });

  plugin.addCommand({
    id: "open-pdf-literature-note",
    name: m.command_open_pdf_literature_note_name(),
    checkCallback(checking) {
      const view = app.workspace.getActiveViewOfType(FileView);
      const itemKey = itemKeyOf(view);
      if (!view || itemKey === null) return false;
      if (!checking) openNote(view.leaf, itemKey);
      return true;
    },
  });

  return (menu, { source, leaf }) => {
    if (source !== "more-options" || !leaf) return;
    const itemKey = itemKeyOf(leaf.view);
    if (itemKey === null) return;
    const { title, icon } = label(itemKey);
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.open)
        .setTitle(title)
        .setIcon(icon)
        .onClick(() => openNote(leaf, itemKey)),
    );
  };
}
