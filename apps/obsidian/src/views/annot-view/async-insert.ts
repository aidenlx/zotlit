import { isolateHistory } from "@codemirror/commands";
import {
  Compartment,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import type { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Editor, MarkdownFileInfo, Workspace } from "obsidian";

/** `text` without the line breaks at its edges. */
const trimLineBreaks = (text: string) => text.replaceAll(/^\n+|\n+$/g, "");

/**
 * Whether `text` lands as a block: multi-line text, such as a rendered
 * callout, once the line breaks at its edges are set aside. One-line text
 * lands inline.
 */
function isBlockText(text: string): boolean {
  return trimLineBreaks(text).includes("\n");
}

/**
 * Characters inline text may run straight into: punctuation that closes the
 * sentence or the bracket the text sits in.
 */
const CLOSERS = new Set(".,;:!?)]}。，、；：！？）】」』》");

/**
 * Inline text with the space it needs after it, and where the cursor goes in
 * it, as an offset from its start. A space follows where the character after
 * the range would otherwise be glued to the text; a space already there is
 * reused, and the cursor rests past it, so typing goes on after the space.
 * A line end, closing punctuation, or text that ends in a space needs none.
 */
function placeInline(
  text: string,
  next: string,
): { insert: string; cursor: number } {
  if (/\s$/u.test(text)) return { insert: text, cursor: text.length };
  if (next === " ") return { insert: text, cursor: text.length + 1 };
  const glued = next !== "" && !/\s/u.test(next) && !CLOSERS.has(next);
  const insert = glued ? `${text} ` : text;
  return { insert, cursor: insert.length };
}

/**
 * The text that lands over `{ from, to }` of `doc`, and where the cursor goes
 * in it, as an offset from its start. One-line text lands inline (see
 * {@link placeInline}). A block gets the line breaks it needs to stand apart
 * from the text around the range: without them a callout dropped at the end
 * of a sentence joins that sentence's line. The cursor rests at its end.
 */
function placeText(
  doc: Text,
  { from, to }: { from: number; to: number },
  text: string,
): { insert: string; cursor: number } {
  if (!isBlockText(text)) return placeInline(text, doc.sliceString(to, to + 1));
  const block = trimLineBreaks(text);
  const isBlank = (line: number) =>
    line < 1 || line > doc.lines || doc.line(line).text.trim() === "";
  const start = doc.lineAt(from);
  const end = doc.lineAt(to);
  const before =
    doc.sliceString(start.from, from).trim() !== ""
      ? "\n\n"
      : isBlank(start.number - 1)
        ? ""
        : "\n";
  const after =
    doc.sliceString(to, end.to).trim() !== ""
      ? "\n\n"
      : isBlank(end.number + 1)
        ? ""
        : "\n";
  const insert = `${before}${block}${after}`;
  return { insert, cursor: insert.length };
}

/**
 * Holds one destination across asynchronous preparation, independently of the
 * cursor. A switch of note cancels it for good: once a workspace change leaves
 * the destination no longer current, returning to the note does not revive it.
 */
export function captureInsertion(options: {
  editor: Editor;
  info: MarkdownFileInfo;
  isCurrent: () => boolean;
  range?: { from: number; to: number };
  /** Whose leaf and layout changes the destination is checked on. */
  workspace: Pick<Workspace, "on" | "offref">;
}) {
  const { editor, info, workspace } = options;
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
  const validate = () => {
    if (!valid()) cancel();
  };
  const workspaceRefs = [
    workspace.on("active-leaf-change", validate),
    workspace.on("layout-change", validate),
  ];
  const dispose = () => {
    if (settled) return;
    settled = true;
    cancel();
    win?.removeEventListener("keydown", onKey);
    for (const ref of workspaceRefs) workspace.offref(ref);
    if (cm.dom.isConnected)
      cm.dispatch({ effects: compartment.reconfigure([]) });
  };
  return {
    signal: controller.signal,
    valid,
    cancel,
    /** The held range as edits since the capture moved it; `null` once one touched it. */
    range: (): { from: number; to: number } | null =>
      cm.state.field(marker, false) ?? null,
    /**
     * Land `text` over the held range, placed against the note as it stands
     * now: a block on lines of its own, inline text kept from gluing to what
     * follows (see {@link placeText}). Answers whether it landed.
     */
    commit(text: string): boolean {
      if (!valid()) return false;
      const range = cm.state.field(marker)!;
      const { insert, cursor } = placeText(cm.state.doc, range, text);
      cm.dispatch({
        changes: { ...range, insert },
        selection: { anchor: range.from + cursor },
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
