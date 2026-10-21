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
 * it, as an offset from its start. One space follows the text, so neither the
 * word after it nor what the researcher types next is glued to it: a space
 * already there is reused, and the cursor rests past the space either way.
 * Closing punctuation after the range, or text that ends in a space, needs
 * none.
 */
function placeInline(
  text: string,
  next: string,
): { insert: string; cursor: number } {
  if (/\s$/u.test(text)) return { insert: text, cursor: text.length };
  if (next === " ") return { insert: text, cursor: text.length + 1 };
  const insert = CLOSERS.has(next) ? text : `${text} `;
  return { insert, cursor: insert.length };
}

/** The characters a citation may follow directly: it opens what it is in. */
const OPENERS = new Set("([{“‘\"'「『（【");

/**
 * Whether `char` closes a bracketed citation: where a placed citation ends
 * with no space after it, and where a Citation Suggester trigger stops.
 */
export function isCitationCloser(char: string | undefined): boolean {
  return char === "]" || char === "】";
}

/**
 * A citation with the spaces it needs around it, and where the cursor goes in
 * it, as an offset from its start.
 *
 * After it: one space, reusing a space already there with the cursor past
 * it. The space keeps an alternate-format `@key` from re-matching a trigger.
 * A bracketed citation ends at its closing bracket instead, which no trigger
 * matches, so punctuation typed next follows it directly: `[@key].`
 *
 * Before it: one space where it would stick to a word or punctuation
 * (`source. [@key]`). A line start, whitespace, or an opening bracket or
 * quote needs none, and neither does a trigger the researcher typed there.
 */
function placeCitation(
  citation: string,
  around: { previous: string | null; next: string },
): { insert: string; cursor: number } {
  const lead =
    around.previous !== null &&
    around.previous.trim() !== "" &&
    !OPENERS.has(around.previous)
      ? " "
      : "";
  if (isCitationCloser(citation.at(-1))) {
    const insert = `${lead}${citation}`;
    return { insert, cursor: insert.length };
  }
  return {
    insert: `${lead}${citation}${around.next === " " ? "" : " "}`,
    cursor: lead.length + citation.length + 1,
  };
}

/**
 * What the inserted text is, which decides how it is placed: an annotation
 * or quote by default, or a citation. A citation over a trigger the
 * researcher typed (`replacesTrigger`) takes no space before it.
 */
export type Placement =
  | { kind?: "annotation" }
  | { kind: "citation"; replacesTrigger?: boolean };

/**
 * The text that lands over `range` of `doc`, and where the cursor goes in it,
 * as an offset from its start. A citation is placed by its own rule (see
 * {@link placeCitation}). Other one-line text lands inline (see
 * {@link placeInline}). A block gets the line breaks it needs to stand apart
 * from the text around the range: without them a callout dropped at the end
 * of a sentence joins that sentence's line. The cursor rests at its end.
 *
 * The one owner of placement: {@link captureInsertion} commits through it,
 * and an editor that writes synchronously calls it directly.
 */
export function placeInsertion(
  text: string,
  options: { doc: Text; range: { from: number; to: number } } & Placement,
): { insert: string; cursor: number } {
  const { doc, range } = options;
  const { from, to } = range;
  const next = doc.sliceString(to, to + 1);
  if (options.kind === "citation")
    return placeCitation(text, {
      previous: options.replacesTrigger
        ? null
        : from === doc.lineAt(from).from
          ? ""
          : doc.sliceString(from - 1, from),
      next,
    });
  if (!isBlockText(text)) return placeInline(text, next);
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
     * now, by the rule for what it is (see {@link placeInsertion}). Answers
     * whether it landed.
     */
    commit(text: string, placement: Placement = {}): boolean {
      if (!valid()) return false;
      const range = cm.state.field(marker)!;
      const { insert, cursor } = placeInsertion(text, {
        ...placement,
        doc: cm.state.doc,
        range,
      });
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
