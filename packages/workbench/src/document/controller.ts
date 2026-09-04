// Headless master state for one Profile document: the only undo history, the
// slice ranges every pane edits through, and the validation Problems reads.

import {
  history,
  isolateHistory,
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

import { ANNOTATION_HEADER } from "@zotlit/templates/constants";
import {
  LiteratureNoteTemplateError,
  parseLiteratureNoteTemplate,
} from "@zotlit/templates/facade";
import type {
  LiteratureNoteTemplateDocument,
  LiteratureNoteTemplateErrorCode,
} from "@zotlit/templates/facade";
import { literatureNoteTemplateDependencies } from "@zotlit/templates/literature-note-pack";

import {
  managedEntryEdit,
  managedFrontmatterEntries,
  manifestKeyEdit,
  manifestNodeRange,
  manifestScalarSlice,
  manifestValueEdit,
} from "./manifest-patch";
import type {
  ManagedEntryAction,
  ManagedEntrySource,
  ManifestScalar,
  WorkbenchSliceRange,
} from "./manifest-patch";
import { noteRegions } from "./regions";
import type { NoteRegions } from "./regions";

/** The pane that edits one Managed Frontmatter entry's expression. */
export type WorkbenchEntrySliceId = `entry:${number}`;

/**
 * A pane a problem is repaired in. Every id but `details` is an editor over one
 * region of the master document; `details` is the Name and folder form, which
 * writes the manifest scalars it shows through controls of its own.
 */
export type WorkbenchSliceId =
  | "note"
  | "annotation"
  | "filename"
  | "advanced"
  | "details"
  | WorkbenchEntrySliceId;

/** The Annotation Section as its two panes address it, in master offsets. */
export interface WorkbenchAnnotationSection {
  /** The `--- zotlit:annotation ---` line, which Advanced highlights. */
  readonly header: WorkbenchSliceRange;
  /** The source under it, which the highlight box edits. */
  readonly source: WorkbenchSliceRange;
}

export type { WorkbenchSliceRange } from "./manifest-patch";

/** The slice one Managed Frontmatter entry's expression is edited through. */
export function entrySlice(position: number): WorkbenchEntrySliceId {
  return `entry:${position}`;
}

/** The entry a slice belongs to, or null when the slice is not a row. */
export function entryPosition(id: WorkbenchSliceId): number | null {
  const [name, position] = id.split(":");
  return name === "entry" ? Number(position) : null;
}

/** Why a draft is refused: the parser's own codes, plus the web host's three. */
export type WorkbenchProblemCode =
  | LiteratureNoteTemplateErrorCode
  | "unsupported-js"
  | "unsupported-language"
  | "unsupported-partial-language";

export interface WorkbenchProblem {
  /** One code is one sentence, which each host writes in the reader's own language. */
  readonly code: WorkbenchProblemCode;
  /** The values a host's own message for `code` reads. */
  readonly params?: Readonly<Record<string, string>>;
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
  #entries: readonly ManagedEntrySource[] | null = null;
  #dependencies: readonly string[] = [];
  #regions: NoteRegions = { annotationCalls: [], managedBlock: null };
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

  /**
   * The Managed Frontmatter entries the manifest authors, in list order, or
   * null while the list is one no form can patch — a flow list, an entry that
   * is not a block mapping — which leaves it to Advanced. A draft whose
   * manifest stopped parsing keeps the last list that did, so the rows stay on
   * screen while the reader repairs the text inside one of them.
   */
  get managedEntries(): readonly ManagedEntrySource[] | null {
    return this.#entries;
  }

  /**
   * The partial names this draft calls, sorted, which is what a Local Bridge
   * bundles for the preview. A draft that does not parse keeps the last list
   * that did, so a repair in progress never drops the bundle it needs.
   */
  get dependencies(): readonly string[] {
    return this.#dependencies;
  }

  /**
   * The note-name template's own text, or null while the manifest writes it in
   * a form one line cannot hold, which leaves that value to Advanced.
   */
  get filenameSlice(): WorkbenchSliceRange | null {
    return this.#ranges.get("filename") ?? null;
  }

  /**
   * The boxes the note body carries: every annotation render call, and the
   * Managed Block. Both are read from the source, so a draft mid-repair keeps
   * the boxes the reader is working in.
   */
  get noteRegions(): NoteRegions {
    return this.#regions;
  }

  /**
   * The Annotation Section's header line and the source under it, or null while
   * the document has never carried a section. The header is the line the
   * section's source starts after, so it survives a draft the parser refuses.
   */
  get annotationSection(): WorkbenchAnnotationSection | null {
    const source = this.#ranges.get("annotation");
    if (!source) return null;
    const line = this.#state.doc.lineAt(Math.max(source.from - 1, 0));
    return { header: { from: line.from, to: line.to }, source };
  }

  get canUndo(): boolean {
    return undoDepth(this.#state) > 0;
  }

  get canRedo(): boolean {
    return redoDepth(this.#state) > 0;
  }

  /**
   * The region `id` covers. An entry removed while its editor is still mounted
   * takes its range with it, so that editor reads an empty region for the one
   * update it sees before the host drops the row.
   */
  sliceRange(id: WorkbenchSliceId): WorkbenchSliceRange {
    return this.#ranges.get(id) ?? { from: 0, to: 0 };
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
   * Writes one top-level manifest key, or removes it when `value` is undefined.
   * Override and Use default are the two calls, and each lands as its own undo
   * step; every other manifest byte stays where the author put it.
   * @returns false when the manifest does not parse, or the key holds a node no
   * form can patch.
   */
  setManifestKey(key: string, value: ManifestScalar | undefined): boolean {
    const edit = manifestKeyEdit(this.#text, key, value);
    if (!edit) return false;
    this.dispatch({
      changes: edit,
      userEvent: "input.form",
      annotations: isolateHistory.of("full"),
    });
    return true;
  }

  /**
   * Writes the Annotation Section header a document without one is missing, as
   * a line of its own at the end of the file. It inserts that header and the
   * line break that ends it and nothing else, so the section it opens is empty
   * until the reader writes in it.
   * @returns false when the document is not missing its section.
   */
  repairAnnotationSection(): boolean {
    if (
      !this.#problems.some(({ code }) => code === "missing-annotation-section")
    ) {
      return false;
    }
    const { doc } = this.#state;
    // The header counts as one only on a line of its own, so a file whose last
    // line still holds text is given the break that ends that line.
    const start = doc.line(doc.lines).length === 0 ? "" : "\n";
    this.dispatch({
      changes: { from: doc.length, insert: `${start}${ANNOTATION_HEADER}\n` },
      userEvent: "input.form",
      annotations: isolateHistory.of("full"),
    });
    return true;
  }

  /**
   * Applies one Properties action — add, remove, reorder, change language,
   * change merge or key — as a targeted edit of the entry's own YAML lines, in
   * one undo step.
   * @returns false when the action names no entry the form can patch.
   */
  editManagedEntry(action: ManagedEntryAction): boolean {
    const edit = managedEntryEdit(this.#text, action);
    if (!edit) return false;
    // A structural action rewrites the very lines the focused row is editing,
    // so it goes to the master whole instead of being quarantined and replayed;
    // the row that survives it picks its focus back up from the DOM.
    this.setFocusedSlice(null);
    this.dispatch({
      changes: edit,
      userEvent: "input.form",
      annotations: isolateHistory.of("full"),
    });
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
    const range = focused === null ? undefined : this.#ranges.get(focused);
    if (
      focused === null ||
      editor === undefined ||
      range === undefined ||
      transaction.annotation(sliceEdit) === focused ||
      transaction.isUserEvent("undo") ||
      transaction.isUserEvent("redo")
    ) {
      return null;
    }
    return { id: focused, editor, range };
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
   * Re-reads the regions the manifest owns: the note-name value and the
   * Managed Frontmatter rows, with the slice each one is edited through. A
   * manifest that stopped parsing keeps the regions it had, whose ranges the
   * change set already remapped, so the reader repairs the text in the editor
   * they are already in; a list or a value that parses into a shape no form can
   * patch takes its region with it, so nothing points at text no pane owns.
   */
  #readManifest(source: string): void {
    const list = managedFrontmatterEntries(source);
    if (list.status === "unparsed") return;
    const filename = manifestScalarSlice(source, ["filename"]);
    if (filename) this.#ranges.set("filename", filename);
    else this.#ranges.delete("filename");
    const entries = list.status === "rows" ? list.entries : null;
    this.#entries = entries;
    for (const id of this.#ranges.keys()) {
      if (id.startsWith("entry:")) this.#ranges.delete(id);
    }
    for (const entry of entries ?? []) {
      this.#ranges.set(entrySlice(entry.position), entry.expression);
    }
  }

  /**
   * Re-derives the slice ranges and the Problems list from the current source.
   * A draft that does not parse keeps the ranges the change set remapped, so
   * the reader can repair the text in the editor they are already in.
   */
  #analyze(): void {
    const source = this.#text;
    this.#ranges.set("advanced", { from: 0, to: source.length });
    this.#readManifest(source);
    try {
      const document = parseLiteratureNoteTemplate(source);
      this.#document = document;
      this.#ranges.set("note", {
        from: document.bodyStart,
        to: document.annotationSection.headerStart,
      });
      this.#ranges.set("annotation", {
        from: document.annotationSection.start,
        to: document.annotationSection.end,
      });
      this.#dependencies = literatureNoteTemplateDependencies(document);
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
          ...(error.manifestPath
            ? { params: { field: error.manifestPath.join(".") } }
            : {}),
          slice: this.#sliceFor(error),
          ...(range ? { range } : {}),
        },
      ];
    }
    this.#regions = noteRegions(source, this.sliceRange("note"));
  }

  /**
   * The pane a problem is repaired in: the row that owns the entry the parser
   * named, the note name for the manifest value that holds it, the Name and
   * folder form for the manifest fields it writes, the note body for a problem
   * in the text that pane already shows, and Advanced for every error no pane
   * can name.
   */
  #sliceFor(error: LiteratureNoteTemplateError): WorkbenchSliceId {
    const path = error.manifestPath;
    const index = path?.[0] === "frontmatter" ? path[1] : undefined;
    if (typeof index === "number") {
      const position = index + 1;
      return this.#entries?.some((entry) => entry.position === position)
        ? entrySlice(position)
        : "advanced";
    }
    if (path?.[0] === "filename" && this.filenameSlice) return "filename";
    if (typeof path?.[0] === "string" && DETAIL_KEYS.has(path[0])) {
      return "details";
    }
    return this.#inNoteBody(error) ? "note" : "advanced";
  }

  /**
   * Whether the note pane already holds the text the parser pointed at. The
   * ranges belong to the last parse the change set remapped, so a code about
   * the document's own structure — a missing or duplicated section header —
   * stays with Advanced, where that structure is repaired.
   */
  #inNoteBody({ code, offset }: LiteratureNoteTemplateError): boolean {
    if (offset === undefined || !NOTE_BODY_ERRORS.has(code)) return false;
    const note = this.#ranges.get("note");
    // The note slice stops before the section header, so a problem sitting on
    // that line is the document's own structure rather than the note's text.
    return note !== undefined && offset >= note.from && offset < note.to;
  }
}

/**
 * The manifest keys the Name and folder form writes, so an error the parser
 * pinned to one of them opens the field that holds it. The keys that form
 * shows read-only — `id`, `contract`, `minAppVersion` — stay with Advanced.
 */
const DETAIL_KEYS = new Set([
  "name",
  "description",
  "version",
  "author",
  "folder",
  "citationStyle",
  "importFolder",
  "importColoredHighlights",
  "importAnnotationsAsTemplate",
  "language",
  "sampleItemType",
]);

/** The parser codes that name text the note pane owns rather than structure. */
const NOTE_BODY_ERRORS = new Set<LiteratureNoteTemplateErrorCode>([
  "invalid-managed-block",
  "duplicate-managed-block",
  "unknown-section-header",
]);

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
      slice: "advanced",
      ...at(source, ["language"]),
    });
  }
  for (const [index, partial] of (manifest.partials ?? []).entries()) {
    if (partial.language === "eta") {
      problems.push({
        code: "unsupported-partial-language",
        params: { name: partial.name },
        slice: "advanced",
        ...at(source, ["partials", index, "language"]),
      });
    }
  }
  for (const [index, entry] of (manifest.frontmatter ?? []).entries()) {
    if ("js" in entry) {
      problems.push({
        code: "unsupported-js",
        ...(entry.key === undefined ? {} : { params: { key: entry.key } }),
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
