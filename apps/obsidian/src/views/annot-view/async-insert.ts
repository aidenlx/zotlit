import { isolateHistory } from "@codemirror/commands";
import {
  Compartment,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Editor, MarkdownFileInfo } from "obsidian";

/** Holds one destination across asynchronous preparation, independently of the cursor. */
export function captureInsertion(options: {
  editor: Editor;
  info: MarkdownFileInfo;
  isCurrent: () => boolean;
  range?: { from: number; to: number };
}) {
  const { editor, info } = options;
  const cm = editor.cm;
  const file = info.file;
  const path = file?.path;
  const initial = options.range ?? cm.state.selection.main;
  const controller = new AbortController();
  const compartment = new Compartment();
  const marker = StateField.define<{ from: number; to: number } | null>({
    create: () => ({ from: initial.from, to: initial.to }),
    update(range, transaction) {
      if (!range || !transaction.docChanged) return range;
      let touched = false;
      transaction.changes.iterChangedRanges((from, to) => {
        if (
          range.from === range.to
            ? from <= range.from && to >= range.from
            : from < range.to && to > range.from
        )
          touched = true;
      });
      if (touched) return null;
      return {
        from: transaction.changes.mapPos(range.from, 1),
        to: transaction.changes.mapPos(
          range.to,
          range.from === range.to ? 1 : -1,
        ),
      };
    },
  });
  const cancelOnOverlap = EditorView.updateListener.of((update) => {
    if (update.state.field(marker, false) === null) controller.abort();
  });
  cm.dispatch({
    effects: StateEffect.appendConfig.of(
      compartment.of([marker, cancelOnOverlap]),
    ),
  });
  let settled = false;
  const valid = () =>
    !settled &&
    !controller.signal.aborted &&
    !!file &&
    info.file === file &&
    file.path === path &&
    info.editor === editor &&
    editor.cm === cm &&
    cm.dom.isConnected &&
    options.isCurrent() &&
    cm.state.field(marker, false) != null;
  const cancel = () => controller.abort();
  const win = cm.dom.ownerDocument.defaultView;
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") cancel();
  };
  win?.addEventListener("keydown", onKey);
  const dispose = () => {
    if (settled) return;
    settled = true;
    cancel();
    win?.removeEventListener("keydown", onKey);
    if (cm.dom.isConnected)
      cm.dispatch({ effects: compartment.reconfigure([]) });
  };
  return {
    signal: controller.signal,
    valid,
    cancel,
    commit(text: string): boolean {
      if (!valid()) return false;
      const range = cm.state.field(marker)!;
      cm.dispatch({
        changes: { ...range, insert: text },
        selection: { anchor: range.from + text.length },
        annotations: [
          Transaction.userEvent.of("input.zotlit"),
          isolateHistory.of("full"),
        ],
      });
      dispose();
      return true;
    },
    [Symbol.dispose]: dispose,
  };
}
