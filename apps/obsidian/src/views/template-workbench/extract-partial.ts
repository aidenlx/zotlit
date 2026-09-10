// The context menu a Template editor opens over a selection: the standard
// clipboard actions, and "Extract to partial…".
//
// @see docs/adr/0050-the-citation-template-is-one-document-and-partials-are-files.md

import { isolateHistory } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Menu } from "obsidian";

import type { TemplateLanguage } from "@zotlit/templates/facade";
import type { SuggestionSource } from "@zotlit/workbench/language";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";

const logger = getLogger(["views", "template-workbench"]);

/**
 * Move `source` into a new Shared Partial: the host asks a name, writes the
 * file under the document's language, and opens it beside this editor.
 *
 * @returns the call that replaces the selection, or `null` when the reader
 *   dismisses the prompt or the file is not written.
 */
export type ExtractPartial = (source: string) => Promise<string | null>;

/**
 * The call one Template Document writes to render `name`. Both forms hand the
 * partial the caller's own root, which is what the shipped defaults and the
 * syntax reference write: Liquid's `render` opens an isolated scope, so `zt`
 * travels by name.
 */
export function partialCall(name: string, language: TemplateLanguage): string {
  return language === "eta"
    ? `<%~ include("${name}", zt) %>`
    : `{% render "${name}" with zt as zt %}`;
}

/**
 * The context menu a Template editor opens over its selection. An empty
 * selection offers no action at all, and neither does a region that renders
 * no partial — a Property expression or a JSON-e value.
 *
 * The menu carries the clipboard actions itself: showing it suppresses the
 * gesture's default action, which is the Electron menu that otherwise offers
 * cut, copy, and paste over a plugin-owned editor.
 */
export function extractPartialMenu(
  read: SuggestionSource,
  extract: ExtractPartial,
): Extension {
  return EditorView.domEventHandlers({
    contextmenu(event, view) {
      const { from, to } = view.state.selection.main;
      if (from === to || view.state.readOnly) return false;
      const config = read(from);
      if (
        !config ||
        config.mode === "expression" ||
        config.language === "json-e"
      )
        return false;
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle(m.template_workbench_cut())
          .setIcon("scissors")
          .onClick(() => void cutSelection(view)),
      );
      menu.addItem((item) =>
        item
          .setTitle(m.template_workbench_copy())
          .setIcon("copy")
          .onClick(() => void copySelection(view)),
      );
      menu.addItem((item) =>
        item
          .setTitle(m.template_workbench_paste())
          .setIcon("clipboard-paste")
          .onClick(() => void pasteOverSelection(view)),
      );
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle(m.template_workbench_extract_partial())
          .setIcon("file-output")
          .onClick(() => void extractSelection(view, extract)),
      );
      menu.showAtMouseEvent(event);
      event.preventDefault();
      return true;
    },
  });
}

async function copySelection(view: EditorView): Promise<void> {
  const { from, to } = view.state.selection.main;
  await navigator.clipboard.writeText(view.state.sliceDoc(from, to));
}

async function cutSelection(view: EditorView): Promise<void> {
  const { from, to } = view.state.selection.main;
  await navigator.clipboard.writeText(view.state.sliceDoc(from, to));
  view.dispatch({
    changes: { from, to },
    selection: { anchor: from },
    userEvent: "delete.cut",
  });
}

async function pasteOverSelection(view: EditorView): Promise<void> {
  const insert = await navigator.clipboard.readText();
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    userEvent: "input.paste",
  });
}

/**
 * Replace the selection with the call the host answers with, as one isolated
 * history event: undo brings the whole selection back in one step and leaves
 * the created file where it is.
 */
async function extractSelection(
  view: EditorView,
  extract: ExtractPartial,
): Promise<void> {
  const { from, to } = view.state.selection.main;
  const source = view.state.doc.toString();
  const call = await extract(source.slice(from, to));
  if (call === null) return;
  // The prompt lasts as long as the reader takes, and an edit that lands while
  // it is open moves every offset measured before it, so a changed document
  // keeps its text and the created partial stands on its own.
  if (view.state.doc.toString() !== source) {
    logger.debug("Dropped an extraction onto a changed document", { call });
    new BaseNotice(m.notice_partial_extract_stale());
    return;
  }
  view.dispatch({
    changes: { from, to, insert: call },
    selection: { anchor: from + call.length },
    annotations: isolateHistory.of("full"),
    userEvent: "input.extract-partial",
  });
}
