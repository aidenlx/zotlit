// The controls every surface that edits an Annotation's text fields draws:
// the editor sheet (the field editor, its status line and its Save button),
// the held-draft panel, and the Write Conflict panel. Each takes the
// wording of the field it stands for: the comment or the Quoted Text.
//
// Vanilla builders, which the Preact wrappers in `comment-parts.tsx` mount on
// the Annotation Card and the reader's Mark Popup alike. What differs between
// the two is the surface's spacing and corners, never which controls stand or
// what they do.
import { setIcon } from "obsidian";
import type { App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { themeHook } from "@/lib/theme-hooks";
import { claimClick } from "@/lib/utils";

import type { ConflictPanel, ConflictVerb } from "./card-conflict";
import type {
  fieldEditorControls,
  HeldDraft,
  HeldDraftAction,
  HeldTags,
} from "./card-controls";
import { createFieldEditor } from "./field-editor";
import type { FieldEditor, FieldEditorWording } from "./field-editor";
import { tagChipVariants } from "./tag-chip";

/**
 * Where the controls stand: an Annotation Card's comment, its Excerpt Block,
 * or the reader's Mark Popup.
 */
export type EditorSurface = "card" | "excerpt" | "popup";

/**
 * The open field: a quiet tint under the text, with no ring, as Zotero's own
 * comment field is, and an accent hairline at its start edge. The tint alone
 * is the resting field's hover too, and too faint against the surface to
 * mark the focus; the hairline is what tells the open field from the one
 * under the pointer. It is drawn over the field's padding, so the text keeps
 * its place (ADR 0066).
 */
const FIELD =
  "zt-annot-comment-editor zt:relative zt:bg-(--background-modifier-hover) zt:text-foreground zt:before:pointer-events-none zt:before:absolute zt:before:inset-y-1 zt:before:start-0 zt:before:w-px zt:before:bg-(--interactive-accent)";

/** The tint fades in under text that stays where it stood. */
const FIELD_ENTER =
  "zt:motion-safe:transition-[background-color] zt:motion-safe:duration-150 zt:starting:bg-transparent";

/**
 * The resting comment where a click opens its editor: the open field's tint
 * under the pointer, and the text cursor, so the comment says it takes typing
 * before it does.
 */
const EDITABLE =
  "zt:cursor-text zt:hover:bg-(--background-modifier-hover) zt:motion-safe:transition-[background-color] zt:motion-safe:duration-150";

/** Where the popup's comment text stands, read or edited. */
const POPUP_TEXT = "zt:px-1.5 zt:py-1 zt:text-sm";

/**
 * The card's field box: its inset taken back out of the margin on every side,
 * so the text keeps the place the rendered text held.
 */
const CARD_BOX =
  "zt:-mx-1.5 zt:-my-1 zt:rounded-(--input-radius) zt:px-1.5 zt:py-1";

/** The popup's panels and its rendered comment take the row's width, as the sheet does. */
const POPUP_WIDTH = "zt:w-0 zt:min-w-[max(100%,12em)]";

/**
 * Each surface's own spacing, corners and width, its sheet's theme hook, and
 * the inset the element a sheet or a panel is drawn into takes from the
 * surface's border. `field` and `view` share one box, so the resting tint, the
 * open field's tint and the text all stand in one place, and opening the
 * editor over the rendered comment moves nothing.
 */
const SURFACE: Record<
  EditorSurface,
  {
    sheet: string;
    inset: string;
    field: string;
    view: string;
    viewFrame: string;
    panel: string;
  }
> = {
  // A panel runs to the card's edges.
  card: {
    sheet: "",
    inset: "",
    field: `${CARD_BOX} zt:text-xs ${FIELD_ENTER}`,
    view: `${CARD_BOX} zt:text-xs`,
    viewFrame: "",
    panel: "zt:-mx-3 zt:px-3 zt:py-1.5",
  },
  // The card's Excerpt Block, beside the colour rule: a panel fills from the
  // rule to the card's end edge, so the rule still marks the excerpt it holds.
  excerpt: {
    sheet: "",
    inset: "",
    field: `${CARD_BOX} zt:text-xs ${FIELD_ENTER}`,
    view: `${CARD_BOX} zt:text-xs`,
    viewFrame: "",
    panel: "zt:-ms-2 zt:-me-3 zt:ps-2 zt:pe-3 zt:py-1.5",
  },
  // The popover's padding is the row's, which leaves a field or a panel under
  // it close to the border, so what stands under the row keeps its own inset.
  // The rendered comment is plain text in the field's box and corners, so
  // opening the editor tints that box without moving the text.
  popup: {
    sheet: themeHook.pdfCommentSheet,
    inset: "zt:px-1.5 zt:pb-1.5",
    field: `zt:rounded-(--radius-s) ${POPUP_TEXT} ${FIELD_ENTER}`,
    view: `zt:rounded-(--radius-s) ${POPUP_TEXT}`,
    viewFrame: POPUP_WIDTH,
    panel: `${POPUP_WIDTH} zt:rounded-(--radius-s) zt:px-2 zt:py-1.5`,
  },
};

/**
 * The rendered comment's classes. `markdown-rendered` is what buys the theme's
 * own prose styling: Obsidian declares those rules unlayered, so they outrank
 * the scoped Tailwind preflight. `zt-annot-comment` is the hook the view
 * stylesheet compacts them through.
 */
export function commentViewClass(
  surface: EditorSurface,
  editable = false,
): string {
  return `markdown-rendered zt-annot-comment zt:overflow-x-auto zt:break-words zt:text-foreground zt:select-text ${SURFACE[surface].view}${editable ? ` ${EDITABLE}` : ""}`;
}

/**
 * The classes of the element a surface stands the rendered comment in: the
 * popup's inset and width, where the card takes none.
 */
export function commentFrameClass(surface: EditorSurface): string {
  const look = SURFACE[surface];
  return `${look.viewFrame} ${look.inset}`.trim();
}

/**
 * What the editor sheet says about the field it edits: the editor's own
 * wording, and the Save button's. The status line's wording names no field;
 * it comes from {@link fieldEditorControls}.
 */
export interface EditorField extends FieldEditorWording {
  /** The Save button, shown while the save is manual. */
  save: string;
}

/** What the sheet says under its editor, and whether it takes a write. */
export type EditorSheetStatus = Pick<
  ReturnType<typeof fieldEditorControls>,
  "hint" | "manual" | "readOnly" | "saveDisabled"
>;

export interface EditorSheetProps {
  app: App;
  surface: EditorSurface;
  /** The field the sheet edits: its placeholder, name and Save wording. */
  field: EditorField;
  /** What the editor opens with. */
  value: string;
  /** Every change the user makes, as the whole field. */
  onChange?: (text: string) => void;
  /** Ctrl/Command+Enter: store the field and keep editing. */
  onSubmit: () => void;
  /** The Save button, shown while the save is manual. */
  onSave?: () => void;
  /** Escape. */
  onCancel: () => void;
  /**
   * The one call-to-action a sheet may carry: a creation's commit, named for
   * what it creates. An edit carries none, since it saves as the user types.
   */
  commit?: SheetCommit;
  /**
   * Focus left the sheet while the save is automatic and the editor takes a
   * write: store the field. The surface decides whether the sheet closes
   * with it. Absent where leaving saves nothing.
   */
  onLeave?: () => void;
  /** What focus may move within without leaving; the sheet itself by default. */
  within?: HTMLElement;
  /**
   * Where the click that opened the editor landed, over the text the editor
   * now stands on; the caret goes to the end where it is absent.
   */
  caretAt?: CaretPoint;
}

/** Where in the viewport a click that opens an editor landed. */
export interface CaretPoint {
  x: number;
  y: number;
}

/** What a resting field, or its held text, does when the user reaches for it. */
export interface CommentEntry {
  /**
   * A write in flight refuses the press outright; it ends by itself, so the
   * field rests as text and says nothing more.
   */
  disabled: boolean;
  /**
   * The Editing Capability refuses a write: the field rests as plain text,
   * and a press spends itself on the notice that says why.
   */
  blocked: boolean;
  /**
   * Opens the editor, or raises the notice while blocked. A click on the
   * rendered comment passes where it landed, so the caret goes there.
   */
  onPress: (at?: CaretPoint) => void;
}

/** A sheet's call-to-action: its label and what its press runs. */
export interface SheetCommit {
  label: string;
  run: () => void;
}

export interface EditorSheet extends Disposable {
  readonly editor: FieldEditor;
  /** The field as it stands in the editor. */
  text(): string;
  /** Redraws the status line, the Save button and the editor's read-only state. */
  update(status: EditorSheetStatus): void;
}

/**
 * The editor sheet: the field editor, then a footer row with the status line,
 * a Save button while the save is manual, and the commit a creation carries.
 * The footer takes no room while it has nothing to show. The editor takes the
 * caret where the opening click landed, and otherwise at the end.
 *
 * @param sheet the element the sheet is drawn into, replacing what it held.
 * @see {@link createFieldEditor}
 */
export function renderEditorSheet(
  sheet: HTMLElement,
  {
    app,
    surface,
    field,
    value,
    onChange,
    onSubmit,
    onSave,
    onCancel,
    commit,
    onLeave,
    within = sheet,
    caretAt,
  }: EditorSheetProps,
  status: EditorSheetStatus,
): EditorSheet {
  const look = SURFACE[surface];
  sheet.empty();
  sheet.addClasses(`${look.sheet} ${look.inset}`.split(" ").filter(Boolean));
  const frame = sheet.createDiv({ cls: `${FIELD} ${look.field}` });
  const footer = sheet.createDiv({
    cls: "zt:flex zt:flex-wrap zt:items-center zt:gap-2",
  });
  // The live region stays mounted and shown through the quiet case, so a
  // status it announces is a change inside it rather than a new node.
  const hint = footer.createSpan({
    // The hint keeps a readable measure and puts the buttons on a line of
    // their own where they do not fit side by side. An empty hint takes no
    // measure, so a button stands at the row's end beside it.
    cls: "zt:min-w-0 zt:grow zt:basis-[12em] zt:empty:basis-0 zt:text-xs zt:text-pretty zt:text-muted-foreground",
    attr: { role: "status" },
  });
  const save = footer.createEl("button", {
    text: field.save,
    attr: { type: "button" },
  });
  if (onSave) save.addEventListener("click", onSave);
  if (commit) {
    // The commit keeps the caret in the editor through its press, so the
    // press is what commits rather than the blur before it.
    const button = footer.createEl("button", {
      cls: "mod-cta",
      text: commit.label,
      attr: { type: "button" },
    });
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", commit.run);
  }
  let current = status;
  // Tearing the editor down takes its focus away, which is no user leaving.
  let disposed = false;
  const editor = createFieldEditor({
    app,
    parent: frame,
    wording: field,
    text: value,
    readOnly: status.readOnly,
    onChange: (text) => onChange?.(text),
    onEscape: onCancel,
    onSubmit,
    onBlur: (next) => {
      if (disposed || within.contains(next)) return;
      if (!current.manual && !current.readOnly) onLeave?.();
    },
  });
  const update = (next: EditorSheetStatus): void => {
    current = next;
    editor.setReadOnly(next.readOnly);
    hint.textContent = next.hint ?? "";
    const saves = next.manual && onSave !== undefined;
    save.toggle(saves);
    save.disabled = next.saveDisabled;
    // The footer stands off the field only while it shows something; the
    // empty live region stays mounted, so what it announces is a change.
    footer.toggleClass(
      "zt:mt-1.5",
      Boolean(next.hint) || saves || commit !== undefined,
    );
  };
  update(status);
  const { view } = editor;
  view.focus();
  // The editor opens on the box the rendered text stood in, so the point the
  // click landed on is over the same words.
  const clicked = caretAt ? view.posAtCoords(caretAt) : null;
  view.dispatch({ selection: { anchor: clicked ?? view.state.doc.length } });
  return {
    editor,
    text: () => view.state.doc.toString(),
    update,
    [Symbol.dispose]: () => {
      disposed = true;
      editor[Symbol.dispose]();
    },
  };
}

/**
 * Whether a click on resting text is a request to edit it. A click that
 * followed a link, or that ended a drag which selected text in the resting
 * text, is reading: the editor would take the selection away before it could
 * be copied. A selection elsewhere, such as in the PDF, is not this one's.
 */
export function clickEdits(
  event: Pick<MouseEvent, "target" | "currentTarget">,
): boolean {
  const target = event.target as Node | null;
  const field = event.currentTarget as Node | null;
  if (!target || !field) return false;
  const element = target.instanceOf(Element) ? target : target.parentElement;
  if (element?.closest("a")) return false;
  // Read through the node's own document: a popout's nodes are not this one's.
  const selection = field.doc.getSelection();
  if (!selection || selection.isCollapsed) return true;
  return !(
    field.contains(selection.anchorNode) || field.contains(selection.focusNode)
  );
}

/**
 * What a held-draft panel's verbs run, for a held comment, held Quoted Text
 * and held tags alike. Each surface binds them to its own write path; which press runs
 * which is decided here, once.
 */
export interface HeldDraftActions {
  /** Store the held draft in Zotero: Save comment, Save text, or Save tags. */
  save: () => void;
  /** Ask Zotero for editing again. */
  allowEditing: () => void;
  /** Drop the held draft and keep what Zotero holds. */
  discard: () => void;
}

/**
 * What a Write Conflict panel's verbs run. Each surface binds them to its own
 * write path; which press runs which is decided here, once.
 */
export interface ConflictActions {
  /** Send the conflicting write again, or delete anyway. */
  applyAgain: () => void;
  /** Drop the conflicting write and keep what Zotero holds. */
  discardConflict: () => void;
}

/**
 * Every verb that ends one text field's draft: the held panel's and its Write
 * Conflict panel's, for a comment or a Quoted Text.
 */
export interface TextDraftActions extends HeldDraftActions, ConflictActions {}

/** A panel's surface: the popover token, with a header icon beside its title. */
function panel(
  parent: HTMLElement,
  {
    surface,
    hook,
    icon,
    title,
  }: { surface: EditorSurface; hook: string; icon: string; title: string },
): HTMLElement {
  parent.empty();
  const look = SURFACE[surface];
  parent.addClasses(look.inset.split(" ").filter(Boolean));
  // `popover` is the surface token; `secondary` is the token Obsidian gives a
  // resting button, so a panel wearing it leaves every button on it at 1:1
  // against its own fill.
  const box = parent.createDiv({
    cls: `${hook} zt:flex zt:flex-col zt:gap-1 zt:bg-popover ${look.panel}`,
  });
  const head = box.createDiv({
    cls: "zt:flex zt:items-center zt:gap-1 zt:font-medium",
  });
  const glyph = head.createSpan({
    cls: "zt:flex zt:[--icon-size:14px]",
  });
  setIcon(glyph, icon);
  head.createSpan({ text: title });
  return box;
}

function buttons(
  box: HTMLElement,
  cls: string,
  list: readonly {
    label: string;
    primary: boolean;
    enabled: boolean;
    run: () => void;
  }[],
): void {
  const row = box.createDiv({ cls: `zt:flex zt:flex-wrap zt:gap-2 ${cls}` });
  for (const { label, primary, enabled, run } of list) {
    const button = row.createEl("button", {
      text: label,
      attr: { type: "button" },
      ...(primary && { cls: "mod-cta" }),
    });
    button.disabled = !enabled;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      run();
    });
  }
}

const HELD_DRAFT_VERB: Record<HeldDraftAction["kind"], keyof HeldDraftActions> =
  {
    save: "save",
    "allow-editing": "allowEditing",
    discard: "discard",
  };

const CONFLICT_VERB: Record<ConflictVerb, keyof ConflictActions> = {
  "apply-again": "applyAgain",
  "delete-anyway": "applyAgain",
  discard: "discardConflict",
};

/**
 * The text the user holds that Zotero has not taken, with the verbs that end
 * it. It wears the Write Conflict panel's surface because it is the same kind
 * of state — local text waiting on the user — and it carries its verbs for the
 * same reason: a surface that only says "unsaved" leaves nowhere to go.
 *
 * Where an `entry` is given, a click on the held text opens the editor on it,
 * as a click on the resting comment does, and raises the notice while the
 * edit is blocked (ADR 0066); otherwise the held text is for reading and
 * copying.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1145
 */
export function renderHeldDraftPanel(
  parent: HTMLElement,
  held: HeldDraft,
  {
    surface,
    actions,
    entry,
  }: {
    surface: EditorSurface;
    actions: HeldDraftActions;
    /** What a click on the held text does; absent where a click only reads. */
    entry?: CommentEntry;
  },
): void {
  const box = panel(parent, {
    surface,
    hook: themeHook.annotDraft,
    icon: "pencil-line",
    title: held.title,
  });
  const text = box.createDiv({
    cls: `zt:break-words zt:whitespace-pre-wrap zt:select-text${entry ? " zt:-mx-1 zt:rounded-(--radius-s) zt:px-1" : ""}${entry && !entry.disabled && !entry.blocked ? ` ${EDITABLE}` : ""}`,
    text: held.text,
  });
  if (entry) {
    text.addEventListener("click", (event) => {
      if (entry.disabled || !clickEdits(event)) return;
      // The surface's own click is not this one.
      claimClick({ nativeEvent: event });
      // The panel does not stand where the editor opens, so the caret goes to
      // the end rather than under the click.
      entry.onPress();
    });
  }
  heldReasonAndVerbs(box, held, actions);
}

/**
 * The tags the user holds that Zotero has not taken, with the verbs that end
 * them: the held comment panel, with the draft's tag chips in place of its
 * text.
 *
 * @see apps/obsidian/docs/adr/0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md
 */
export function renderHeldTagsPanel(
  parent: HTMLElement,
  held: HeldTags,
  {
    surface,
    actions,
  }: {
    surface: EditorSurface;
    actions: HeldDraftActions;
  },
): void {
  const box = panel(parent, {
    surface,
    hook: themeHook.annotDraft,
    icon: "tags",
    title: m.annot_view_tags_draft(),
  });
  const chips = box.createDiv({ cls: "zt:flex zt:flex-wrap zt:gap-1" });
  for (const name of held.names) {
    chips
      .createSpan({
        cls: tagChipVariants({
          state: "resting",
          density: "dense",
          truncate: true,
          class: "zt:cursor-[inherit]",
        }),
      })
      .createSpan({ cls: "zt:block zt:truncate", text: name });
  }
  heldReasonAndVerbs(box, held, actions);
}

/** A held panel's tail: why the draft is held, and the verbs that end it. */
function heldReasonAndVerbs(
  box: HTMLElement,
  held: Pick<HeldDraft, "reason" | "actions">,
  actions: HeldDraftActions,
): void {
  if (held.reason !== null) {
    // The reason runs to three and four lines in a narrow dock, past where
    // the card's own tight leading stays readable.
    box.createDiv({
      cls: "zt:leading-normal zt:text-pretty zt:text-muted-foreground",
      attr: { role: "status" },
      text: held.reason,
    });
  }
  buttons(
    box,
    "zt:mt-1",
    held.actions.map((action) => ({
      ...action,
      run: () => actions[HELD_DRAFT_VERB[action.kind]](),
    })),
  );
}

/**
 * A Write Conflict: the fresh Zotero value beside what the user asked for, and
 * the two verbs that end it. Applying again is a write, so it rests disabled
 * while the Editing Capability refuses one; discarding never is.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1151
 */
export function renderConflictPanel(
  parent: HTMLElement,
  conflict: ConflictPanel,
  {
    surface,
    live,
    actions,
  }: {
    surface: EditorSurface;
    /** Whether the Editing Capability takes a write right now. */
    live: boolean;
    actions: ConflictActions;
  },
): void {
  const box = panel(parent, {
    surface,
    hook: themeHook.annotConflict,
    icon: "alert-triangle",
    title: conflict.title,
  });
  if (conflict.prompt !== null) {
    box.createDiv({ cls: "zt:text-muted-foreground", text: conflict.prompt });
  }
  for (const { label, value } of conflict.values) {
    const line = box.createDiv({ cls: "zt:flex zt:gap-1" });
    line.createSpan({
      cls: "zt:shrink-0 zt:text-muted-foreground",
      text: label,
    });
    line.createSpan({ cls: "zt:min-w-0 zt:break-words", text: value });
  }
  buttons(
    box,
    "zt:mt-2",
    conflict.actions.map(({ kind, label }) => ({
      label,
      primary: false,
      enabled: kind === "discard" || live,
      run: () => actions[CONFLICT_VERB[kind]](),
    })),
  );
}
