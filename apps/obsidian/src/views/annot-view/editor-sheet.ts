// The controls every surface that edits an Annotation's text fields draws:
// the editor sheet (the field editor, its status line, its Save button and
// Done), the held-draft panel, and the Write Conflict panel. Each takes the
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
 * Obsidian's own text field — its fill, resting border and focus ring — drawn
 * as rings so neither changes the layout.
 */
const FIELD =
  "zt-annot-comment-editor zt:bg-(--background-modifier-form-field) zt:text-foreground zt:ring-1 zt:ring-(--background-modifier-border) zt:focus-within:ring-2 zt:focus-within:ring-(--background-modifier-border-focus)";

/** The field fades in around text that stays where it stood. */
const FIELD_ENTER =
  "zt:motion-safe:transition-[box-shadow,background-color] zt:starting:bg-transparent zt:starting:ring-transparent";

/** Where the popup's comment text stands, read or edited. */
const POPUP_TEXT = "zt:px-1.5 zt:py-1 zt:text-sm";

/** The popup's panels and its rendered comment take the row's width, as the sheet does. */
const POPUP_WIDTH = "zt:w-0 zt:min-w-[max(100%,12em)]";

/**
 * Each surface's own spacing, corners and width, its sheet's theme hook, and
 * the inset the element a sheet or a panel is drawn into takes from the
 * surface's border. `field` and `view` put the comment's text in one place, so
 * opening the editor over the rendered comment moves nothing.
 */
const SURFACE: Record<
  EditorSurface,
  {
    sheet: string;
    inset: string;
    field: string;
    view: string;
    viewFrame: string;
    footer: string;
    panel: string;
  }
> = {
  // The field's inset is taken back out of the margin on every side, so the
  // text keeps the place the rendered comment held. A panel runs to the
  // card's edges.
  card: {
    sheet: "",
    inset: "",
    field: `zt:-mx-1.5 zt:-my-1 zt:rounded-(--input-radius) zt:px-1.5 zt:py-1 zt:text-xs ${FIELD_ENTER}`,
    view: "zt:text-xs",
    viewFrame: "",
    footer: "zt:mt-2",
    panel: "zt:-mx-3 zt:px-3 zt:py-1.5",
  },
  // The card's Excerpt Block, beside the colour rule: a panel fills from the
  // rule to the card's end edge, so the rule still marks the excerpt it holds.
  excerpt: {
    sheet: "",
    inset: "",
    field: `zt:-mx-1.5 zt:-my-1 zt:rounded-(--input-radius) zt:px-1.5 zt:py-1 zt:text-xs ${FIELD_ENTER}`,
    view: "zt:text-xs",
    viewFrame: "",
    footer: "zt:mt-2",
    panel: "zt:-ms-2 zt:-me-3 zt:ps-2 zt:pe-3 zt:py-1.5",
  },
  // The popover's padding is the row's, which leaves a field or a panel under
  // it close to the border, so what stands under the row keeps its own inset.
  // The rendered comment is the field at rest: a recessed well with the
  // field's box and corners, so it reads as content apart from the verbs, and
  // opening the editor turns the well into the field without moving the text.
  popup: {
    sheet: themeHook.pdfCommentSheet,
    inset: "zt:px-1.5 zt:pb-1.5",
    field: `zt:rounded-(--radius-s) ${POPUP_TEXT} ${FIELD_ENTER}`,
    view: `zt:rounded-(--radius-s) zt:bg-(--background-secondary) ${POPUP_TEXT}`,
    viewFrame: POPUP_WIDTH,
    footer: "zt:mt-1",
    panel: `${POPUP_WIDTH} zt:rounded-(--radius-s) zt:px-2 zt:py-1.5`,
  },
};

/**
 * The rendered comment's classes. `markdown-rendered` is what buys the theme's
 * own prose styling: Obsidian declares those rules unlayered, so they outrank
 * the scoped Tailwind preflight. `zt-annot-comment` is the hook the view
 * stylesheet compacts them through.
 */
export function commentViewClass(surface: EditorSurface): string {
  return `markdown-rendered zt-annot-comment zt:overflow-x-auto zt:break-words zt:text-foreground zt:select-text ${SURFACE[surface].view}`;
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
  /** The Done button: store the field and close the editor. */
  onDone: () => void;
  /**
   * Focus left the sheet while the save is automatic and the editor takes a
   * write: store the field. The surface decides whether the sheet closes
   * with it. Absent where leaving saves nothing.
   */
  onLeave?: () => void;
  /** What focus may move within without leaving; the sheet itself by default. */
  within?: HTMLElement;
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
 * a Save button while the save is manual, and Done, which saves and closes.
 * The editor takes the caret at the end.
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
    onDone,
    onLeave,
    within = sheet,
  }: EditorSheetProps,
  status: EditorSheetStatus,
): EditorSheet {
  const look = SURFACE[surface];
  sheet.empty();
  sheet.addClasses(`${look.sheet} ${look.inset}`.split(" ").filter(Boolean));
  const frame = sheet.createDiv({ cls: `${FIELD} ${look.field}` });
  const footer = sheet.createDiv({
    cls: `zt:flex zt:flex-wrap zt:items-center zt:gap-2 ${look.footer}`,
  });
  // The live region stays mounted and shown through the quiet case, so a
  // status it announces is a change inside it rather than a new node.
  const hint = footer.createSpan({
    // The hint keeps a readable measure and puts the buttons on a line of
    // their own where they do not fit side by side. An empty hint takes no
    // measure, so Done stands at the row's end beside it.
    cls: "zt:min-w-0 zt:grow zt:basis-[12em] zt:empty:basis-0 zt:text-xs zt:text-pretty zt:text-muted-foreground",
    attr: { role: "status" },
  });
  const save = footer.createEl("button", {
    text: field.save,
    attr: { type: "button" },
  });
  if (onSave) save.addEventListener("click", onSave);
  // Done keeps the caret in the editor through its press, so the press is
  // what saves and closes rather than the blur before it.
  const done = footer.createEl("button", {
    cls: "mod-cta",
    text: m.annot_view_editor_done(),
    attr: { type: "button" },
  });
  done.addEventListener("mousedown", (event) => event.preventDefault());
  done.addEventListener("click", onDone);
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
    save.toggle(next.manual && onSave !== undefined);
    save.disabled = next.saveDisabled;
  };
  update(status);
  const { view } = editor;
  view.focus();
  view.dispatch({ selection: { anchor: view.state.doc.length } });
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
 * The held text is for reading and copying: the field's own control, the
 * comment pencil or Edit text, is what opens the editor on it (ADR 0060).
 *
 * @see https://github.com/aidenlx/zotlit/issues/1145
 */
export function renderHeldDraftPanel(
  parent: HTMLElement,
  held: HeldDraft,
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
    icon: "pencil-line",
    title: held.title,
  });
  box.createDiv({
    cls: "zt:break-words zt:whitespace-pre-wrap zt:select-text",
    text: held.text,
  });
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
