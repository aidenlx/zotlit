// The context menu a Template editor opens over a selection: the standard
// clipboard actions, and "Extract to partial…".
//
// @see docs/adr/0055-the-citation-template-is-one-document-and-partials-are-files.md

import { isolateHistory } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Effect } from "effect";
import { Menu } from "obsidian";

import type { TemplateLanguage } from "@zotlit/templates/facade";
import type { SuggestionSource } from "@zotlit/workbench/language";
import { observeExit } from "@zotlit/workbench/ui";
import type { WorkbenchRunner } from "@zotlit/workbench/ui";

import { withLogCategory } from "@/lib/effect-log";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";

/**
 * Move `source` into a new Shared Partial: the host asks a name, writes the
 * file under the document's language, and opens it beside this editor.
 *
 * @returns the call that replaces the selection, or `null` when the reader
 *   dismisses the prompt or the file is not written.
 */
export type ExtractPartial = (source: string) => Effect.Effect<string | null>;

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
  run: WorkbenchRunner,
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
          .onClick(() =>
            observeExit(run(extractSelection(view, extract)), {
              onSuccess: reportExtraction,
            }),
          ),
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

/** What one Extract to partial gesture did with the editor's selection. */
export type ExtractOutcome = "extracted" | "dismissed" | "stale";

/**
 * Replace the selection with the call the host answers with, as one isolated
 * history event: undo brings the whole selection back in one step and leaves
 * the created file where it is.
 *
 * @returns `dismissed` when the reader closes the name prompt without a name,
 *   and `stale` when an edit landed while the prompt was open: the prompt
 *   lasts as long as the reader takes, and such an edit moves every offset
 *   measured before it, so the document keeps its text and the created partial
 *   stands on its own.
 */
export const extractSelection = (
  view: EditorView,
  extract: ExtractPartial,
): Effect.Effect<ExtractOutcome> =>
  Effect.suspend(() => {
    const { from, to } = view.state.selection.main;
    const source = view.state.doc.toString();
    return extract(source.slice(from, to)).pipe(
      Effect.flatMap((call) => {
        if (call === null) return Effect.succeed("dismissed" as const);
        if (view.state.doc.toString() !== source)
          return Effect.logDebug(
            "Dropped an extraction onto a changed document",
          ).pipe(Effect.annotateLogs({ call }), Effect.as("stale" as const));
        view.dispatch({
          changes: { from, to, insert: call },
          selection: { anchor: from + call.length },
          annotations: isolateHistory.of("full"),
          userEvent: "input.extract-partial",
        });
        return Effect.succeed("extracted" as const);
      }),
      withLogCategory("template-workbench"),
    );
  });

/** The seam that renders one {@link extractSelection} outcome. */
function reportExtraction(outcome: ExtractOutcome): void {
  if (outcome === "stale") new BaseNotice(m.notice_partial_extract_stale());
}
