// Headless master state for one Profile document: the only undo history, the
// slice ranges every pane edits through, and the validation Problems reads.

import {
  history,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from "@codemirror/commands";
import { Annotation, ChangeSet, EditorState, Text } from "@codemirror/state";
import type {
  ChangeSpec,
  Transaction,
  TransactionSpec,
} from "@codemirror/state";

import {
  LiteratureNoteTemplateError,
  parseLiteratureNoteTemplate,
} from "@zotlit/templates/facade";
import type {
  LiteratureNoteTemplateDocument,
  LiteratureNoteTemplateErrorCode,
} from "@zotlit/templates/facade";

import { manifestNodeRange, manifestValueEdit } from "./manifest-patch";
import type { ManifestScalar } from "./manifest-patch";

/** A pane that edits one region of the master document. */
export type WorkbenchSliceId = "note" | "advanced";

export interface WorkbenchSliceRange {
  readonly from: number;
  readonly to: number;
}

/** Why a draft is refused: the parser's own codes, plus the web host's two. */
export type WorkbenchProblemCode =
  | LiteratureNoteTemplateErrorCode
  | "unsupported-language"
  | "unsupported-js";

export interface WorkbenchProblem {
  readonly code: WorkbenchProblemCode;
  readonly message: string;
  readonly recovery: string;
  /** Where the reader repairs it. */
  readonly slice: WorkbenchSliceId;
  /** The responsible text in master offsets, when the check can name it. */
  readonly range?: WorkbenchSliceRange;
}

/** The live editor over one slice, which owns that region while it has focus. */
export interface WorkbenchSliceEditor {
  /** Applies changes the master suppressed, in the slice's own offsets. */
  replay(changes: ChangeSpec, userEvent: string | undefined): void;
}

/** The editor holding one slice's live text, and the region it holds. */
interface Quarantine {
  readonly id: WorkbenchSliceId;
  readonly editor: WorkbenchSliceEditor;
  readonly range: WorkbenchSliceRange;
}

export interface WorkbenchUpdate {
  readonly transaction: Transaction;
  readonly docChanged: boolean;
}

/**
 * Marks a master transaction as one slice's own edit, so the change filter lets
 * the focused slice through and the other slices know where it came from.
 */
export const sliceEdit = Annotation.define<WorkbenchSliceId>();

export class WorkbenchDocumentController {
  #state: EditorState;
  #document: LiteratureNoteTemplateDocument | null = null;
  #problems: readonly WorkbenchProblem[] = [];
  #focused: WorkbenchSliceId | null = null;
  readonly #ranges = new Map<WorkbenchSliceId, WorkbenchSliceRange>([
    ["note", { from: 0, to: 0 }],
    ["advanced", { from: 0, to: 0 }],
  ]);
  readonly #slices = new Map<WorkbenchSliceId, WorkbenchSliceEditor>();
  readonly #listeners = new Set<(update: WorkbenchUpdate) => void>();

  constructor(source: string) {
    this.#state = EditorState.create({
      doc: source,
      extensions: [
        // Read as found: without this the state splits on any of the three
        // break forms and joins them all back as LF, silently rewriting a CRLF
        // document the first time it is edited.
        EditorState.lineSeparator.of(source.includes("\r\n") ? "\r\n" : "\n"),
        history(),
        // The focused slice holds the reader's live text, so a form or
        // structural edit computed elsewhere leaves that range alone and is
        // replayed into the editor that owns it. Undo and redo are exempt:
        // they are routed here from the slice on purpose.
        EditorState.changeFilter.of((transaction) => {
          const quarantine = this.#quarantine(transaction);
          if (quarantine === null) return true;
          const { from, to } = quarantine.range;
          return [from, to];
        }),
      ],
    });
    this.#analyze();
  }

  /**
   * The document's authored bytes, with the line break it was read with. The
   * state stores every break as LF so the slice offsets stay one character
   * wide; this is the text to render, save, or download.
   */
  get source(): string {
    const { doc } = this.#state;
    return doc.sliceString(0, doc.length, this.#state.lineBreak);
  }

  /** The offset space the slice ranges and the parser agree on. */
  get #text(): string {
    return this.#state.doc.toString();
  }

  get state(): EditorState {
    return this.#state;
  }

  /** The parsed document, or null while the draft does not parse. */
  get document(): LiteratureNoteTemplateDocument | null {
    return this.#document;
  }

  get problems(): readonly WorkbenchProblem[] {
    return this.#problems;
  }

  get canUndo(): boolean {
    return undoDepth(this.#state) > 0;
  }

  get canRedo(): boolean {
    return redoDepth(this.#state) > 0;
  }

  sliceRange(id: WorkbenchSliceId): WorkbenchSliceRange {
    return this.#ranges.get(id)!;
  }

  sliceText(id: WorkbenchSliceId): string {
    const { from, to } = this.sliceRange(id);
    return this.#state.doc.sliceString(from, to);
  }

  /** Records which slice holds the caret, so the change filter can quarantine it. */
  setFocusedSlice(id: WorkbenchSliceId | null): void {
    this.#focused = id;
  }

  /**
   * Registers the editor holding `id`'s live text. While it is focused the
   * master leaves that region to it, so registration is what makes a slice a
   * quarantine.
   * @returns the unregister function.
   */
  registerSlice(
    id: WorkbenchSliceId,
    editor: WorkbenchSliceEditor,
  ): () => void {
    this.#slices.set(id, editor);
    return () => {
      if (this.#slices.get(id) === editor) this.#slices.delete(id);
    };
  }

  subscribe(listener: (update: WorkbenchUpdate) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  dispatch(spec: TransactionSpec): void {
    const before = this.#state;
    const changes =
      spec.changes === undefined ? undefined : splitLineBreaks(spec.changes);
    const transaction = before.update(
      changes === undefined ? spec : { ...spec, changes },
    );
    const quarantine = this.#quarantine(transaction);
    const suppressed =
      quarantine === null || changes === undefined
        ? null
        : suppressedChanges(before.changes(changes), quarantine.range);
    this.#apply(transaction);
    // The master has moved on by the part the filter let through, so the
    // suppressed changes are rebased onto the document the slice now holds.
    if (quarantine && suppressed) {
      this.#replay(
        quarantine,
        suppressed.map(transaction.changes),
        spec.userEvent,
      );
    }
  }

  undo(): boolean {
    return undo(this.#target());
  }

  redo(): boolean {
    return redo(this.#target());
  }

  /**
   * Replaces one manifest value in place, preserving every other byte of the
   * manifest — comments, key order, quoting, and line endings included.
   * @returns false when the path names no node in the current draft.
   */
  setManifestValue(
    path: readonly (string | number)[],
    value: ManifestScalar,
  ): boolean {
    const edit = manifestValueEdit(this.#text, path, value);
    if (!edit) return false;
    this.dispatch({ changes: edit, userEvent: "input.form" });
    return true;
  }

  /**
   * The editor a transaction stays out of, with the region it holds right now,
   * or null when the transaction may touch the whole document. A slice with no
   * editor open holds no live text, so nothing is kept out of the master for
   * it.
   */
  #quarantine(transaction: Transaction): Quarantine | null {
    const focused = this.#focused;
    const editor = focused === null ? undefined : this.#slices.get(focused);
    if (
      focused === null ||
      editor === undefined ||
      transaction.annotation(sliceEdit) === focused ||
      transaction.isUserEvent("undo") ||
      transaction.isUserEvent("redo")
    ) {
      return null;
    }
    return { id: focused, editor, range: this.#ranges.get(focused)! };
  }

  /**
   * Hands the changes the filter kept out of the master to the editor that owns
   * that text, addressed in its own offsets. The child applies them as one of
   * its own edits, which comes straight back as a slice edit the filter lets
   * through, so the edit lands once and in order.
   */
  #replay(
    { id, editor }: Quarantine,
    changes: ChangeSet,
    userEvent: string | undefined,
  ): void {
    const { from, to } = this.sliceRange(id);
    const replay: ChangeSpec[] = [];
    // oxlint-disable-next-line max-params -- CM's iterChanges callback signature.
    changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      replay.push({
        from: clamp(fromA - from, to - from),
        to: clamp(toA - from, to - from),
        insert: inserted,
      });
    });
    if (replay.length > 0) editor.replay(replay, userEvent);
  }

  /** The line the offset sits on, so a problem selects the text it is about. */
  #lineAround(offset: number): WorkbenchSliceRange {
    const { doc } = this.#state;
    const line = doc.lineAt(clamp(offset, doc.length));
    return { from: line.from, to: line.to };
  }

  #target() {
    return {
      state: this.#state,
      dispatch: (transaction: Transaction) => this.#apply(transaction),
    };
  }

  #apply(transaction: Transaction): void {
    this.#state = transaction.state;
    if (transaction.docChanged) {
      for (const [id, range] of this.#ranges) {
        this.#ranges.set(id, {
          from: transaction.changes.mapPos(range.from, -1),
          to: transaction.changes.mapPos(range.to, 1),
        });
      }
      this.#analyze();
    }
    const update: WorkbenchUpdate = {
      transaction,
      docChanged: transaction.docChanged,
    };
    for (const listener of this.#listeners) listener(update);
  }

  /**
   * Re-derives the slice ranges and the Problems list from the current source.
   * A draft that does not parse keeps the ranges the change set remapped, so
   * the reader can repair the text in the editor they are already in.
   */
  #analyze(): void {
    const source = this.#text;
    this.#ranges.set("advanced", { from: 0, to: source.length });
    try {
      const document = parseLiteratureNoteTemplate(source);
      this.#document = document;
      this.#ranges.set("note", {
        from: document.bodyStart,
        to: document.annotationSection.headerStart,
      });
      this.#problems = webProblems(document, source);
    } catch (error) {
      if (!(error instanceof LiteratureNoteTemplateError)) throw error;
      this.#document = null;
      // A manifest field the parser can name beats the line its offset sits on,
      // which for a schema failure is the manifest's first line.
      const range =
        (error.manifestPath
          ? manifestNodeRange(source, error.manifestPath)
          : null) ??
        (error.offset === undefined ? null : this.#lineAround(error.offset));
      this.#problems = [
        {
          code: error.code,
          message: error.message,
          recovery: error.recovery,
          slice: "advanced",
          ...(range ? { range } : {}),
        },
      ];
    }
  }
}

/**
 * The parts of `changes` the change filter keeps out of the master, in the
 * master's own offsets. It mirrors the filter's boundary rule: an insertion
 * sitting exactly on a slice boundary goes to the master, and a change reaching
 * in from outside is split at the boundary, with its inserted text staying on
 * the side the change starts on.
 */
function suppressedChanges(
  changes: ChangeSet,
  { from, to }: WorkbenchSliceRange,
): ChangeSet {
  const suppressed: ChangeSpec[] = [];
  // oxlint-disable-next-line max-params -- CM's iterChanges callback signature.
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const start = Math.max(fromA, from);
    const end = Math.min(toA, to);
    if (fromA === toA ? fromA <= from || fromA >= to : start >= end) return;
    suppressed.push({
      from: start,
      to: end,
      ...(fromA >= from ? { insert: inserted } : {}),
    });
  });
  return ChangeSet.of(suppressed, changes.length);
}

/**
 * The web host's own restrictions on an otherwise valid document: it renders
 * Liquid and JSON-e only, and directs Eta and `js` Profiles to Obsidian.
 * @see docs/adr/0033-web-workbench-is-public-and-standalone.md
 */
function webProblems(
  document: LiteratureNoteTemplateDocument,
  source: string,
): readonly WorkbenchProblem[] {
  const { manifest } = document;
  const problems: WorkbenchProblem[] = [];
  if (manifest.language === "eta") {
    problems.push({
      code: "unsupported-language",
      message:
        "This profile is written in Eta, which the web workbench can't edit.",
      recovery: "Open the profile in Obsidian, or download it unchanged.",
      slice: "advanced",
      ...at(source, ["language"]),
    });
  }
  for (const [index, partial] of (manifest.partials ?? []).entries()) {
    if (partial.language === "eta") {
      problems.push({
        code: "unsupported-language",
        message: `The partial '${partial.name}' is written in Eta, which the web workbench can't render.`,
        recovery: "Open the profile in Obsidian, or download it unchanged.",
        slice: "advanced",
        ...at(source, ["partials", index, "language"]),
      });
    }
  }
  for (const [index, entry] of (manifest.frontmatter ?? []).entries()) {
    if ("js" in entry) {
      problems.push({
        code: "unsupported-js",
        message: `The property '${entry.key ?? "(unnamed)"}' runs JavaScript, which the web workbench can't evaluate.`,
        recovery: "Open the profile in Obsidian, or download it unchanged.",
        slice: "advanced",
        ...at(source, ["frontmatter", index, "js"]),
      });
    }
  }
  return problems;
}

/** The manifest node's own text, so a problem points at the value it is about. */
function at(
  source: string,
  path: readonly (string | number)[],
): { range?: WorkbenchSliceRange } {
  const range = manifestNodeRange(source, path);
  return range ? { range } : {};
}

/**
 * Splits every inserted string into lines, so a break written as LF lands as a
 * line break in a CRLF document instead of a literal character inside a line.
 */
function splitLineBreaks(changes: ChangeSpec): ChangeSpec {
  if (Array.isArray(changes)) return changes.map(splitLineBreaks);
  if (
    typeof changes !== "object" ||
    !("insert" in changes) ||
    typeof changes.insert !== "string"
  ) {
    return changes;
  }
  return { ...changes, insert: Text.of(changes.insert.split(/\r\n|[\n\r]/)) };
}

function clamp(offset: number, length: number): number {
  return Math.min(Math.max(offset, 0), length);
}
