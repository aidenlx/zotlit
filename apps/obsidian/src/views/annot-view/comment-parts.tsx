// The comment controls as Preact components, for the Annotation Card and the
// Mark Popup alike: the rendered comment, the comment pencil in its gutter,
// the "Add comment…" line, the editor sheet, the held-draft panel and the
// Write Conflict panel. Each draws through the vanilla builder in
// `comment-sheet.ts` and redraws only when what it shows changes, so a render
// of the surface around it never drops a click between its press and its
// release.
import type { App } from "obsidian";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { HTMLAttributes, ReactNode, RefObject } from "react";

import { IconButton } from "@/components/obsidian/icon-button";
import * as m from "@/lib/i18n/generated/messages";
import { claimClick, tooltipAttrs } from "@/lib/utils";
import type { WriteConflict } from "@/services/annotation-repository/write";

import { conflictPanel } from "./card-conflict";
import { sameHeldDraft } from "./card-controls";
import type { CardControl, HeldDraft } from "./card-controls";
import type { CommentRenderer } from "./comment-render";
import {
  commentViewClass,
  renderEditorSheet,
  renderConflictPanel,
  renderHeldDraftPanel,
} from "./comment-sheet";
import type {
  ConflictActions,
  HeldDraftActions,
  EditorSheet,
  EditorSheetProps,
  EditorSheetStatus,
  CommentSurface,
} from "./comment-sheet";

type DivProps = Omit<HTMLAttributes<HTMLDivElement>, "children">;

/**
 * The rendered comment: its text stands where the editor sheet's editor will
 * put it. A click on it is the surface's own and opens nothing, so the text
 * stays free to read, select and copy; the comment pencil opens the editor
 * (ADR 0060). The Markdown renders again only when the comment does.
 */
export function CommentView({
  surface,
  render,
  html,
}: {
  surface: CommentSurface;
  render: CommentRenderer;
  html: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    return render(ref.current, html);
  }, [render, html]);
  return <div ref={ref} className={commentViewClass(surface)} />;
}

/** The comment pencil: its name, its state, and what its press runs. */
export interface CommentPencil {
  /** The accessible name, which Obsidian also shows as the tooltip. */
  label: string;
  /** The press is refused outright, as while a write is in flight. */
  disabled: boolean;
  /**
   * The Editing Capability stands in the way: the pencil rests dimmed and
   * keeps its press, which the surface spends on the reason.
   */
  blocked: boolean;
  /** The editor is open on the comment. */
  active: boolean;
  onPress: () => void;
}

/**
 * The comment pencil for one editing control: its name, its refusal and its
 * dim come from the control, so a surface that decides its verbs through
 * {@link CardControl} states nothing twice.
 */
export function controlPencil(
  control: CardControl,
  { active, onPress }: Pick<CommentPencil, "active" | "onPress">,
): CommentPencil {
  return {
    label: control.tooltip,
    disabled: control.disabled,
    blocked: control.blocked !== null,
    active,
    onPress,
  };
}

/**
 * The comment, and the gutter beside it that holds the comment pencil. The
 * gutter stands while a pencil is offered, the editor open or not, so the text
 * wraps to one width through the edit and the pencil never covers it. With no
 * pencil the comment takes the whole width.
 *
 * @see apps/obsidian/docs/adr/0060-card-text-is-edited-only-through-explicit-controls.md
 */
export function CommentGutter({
  pencil,
  children,
}: {
  pencil: CommentPencil | null;
  children: ReactNode;
}) {
  // One element tree with the pencil or without it: the comment keeps its
  // nodes as its card becomes selected alone, and a text selection the press
  // started with them. The gap keeps the open field's ring off the pencil.
  return (
    <div className="zt:flex zt:items-start zt:gap-2">
      <div className="zt:min-w-0 zt:flex-1">{children}</div>
      {pencil && (
        <IconButton
          icon="pencil"
          // The 22px box sits on the first line without growing it, and
          // pulls back by its padding so the glyph lands on the text edge, as
          // the header's end control does.
          className="zt-annot-comment-pencil zt:-my-1 zt:-me-1 zt:shrink-0 zt:data-blocked:opacity-50"
          active={pencil.active}
          disabled={pencil.disabled}
          data-blocked={pencil.blocked ? "" : undefined}
          // An open editor keeps the focus through this press, so the press
          // itself is what closes it rather than the blur before it.
          onMouseDown={(e) => {
            if (pencil.active) e.preventDefault();
          }}
          onClick={(e) => {
            // The pencil is a verb; the surface's own click is not that.
            claimClick(e);
            pencil.onPress();
          }}
          {...tooltipAttrs(pencil.label)}
        />
      )}
    </div>
  );
}

/**
 * The "Add a comment…" line an Annotation with no comment shows in the
 * comment's place. The whole line is the comment pencil: one control, its
 * glyph standing in the gutter, so the words and the pencil take one press
 * and one stop in the Tab order.
 */
export function AddCommentLine({ pencil }: { pencil: CommentPencil }) {
  return (
    <IconButton
      icon="pencil"
      // The glyph comes last, at the gutter's place; the padding is taken back
      // on every side, so the words sit on the text edge and the line is as
      // tall as a line of comment.
      className="zt-annot-comment-pencil zt-annot-add-comment zt:-m-1 zt:w-auto zt:flex-row-reverse zt:text-xs zt:data-blocked:opacity-50"
      disabled={pencil.disabled}
      data-blocked={pencil.blocked ? "" : undefined}
      onClick={(e) => {
        // The pencil is a verb; the surface's own click is not that.
        claimClick(e);
        pencil.onPress();
      }}
      {...tooltipAttrs(pencil.label)}
    >
      <span className="zt:flex-1 zt:text-start">
        {m.annot_view_card_comment_placeholder()}
      </span>
    </IconButton>
  );
}

export interface EditorSheetSlotProps
  extends
    Omit<EditorSheetProps, "app" | "surface">,
    Omit<DivProps, "onChange" | "onSubmit"> {
  app: App;
  surface: CommentSurface;
  /**
   * The field's text taken into the open editor as it changes, keeping the caret;
   * `undefined` leaves the editor's text alone.
   */
  text?: string;
  status: EditorSheetStatus;
  /** Holds the sheet while it stands, for an owner that reads its text. */
  sheetRef?: RefObject<EditorSheet | null>;
}

/**
 * The editor sheet, built once as the slot mounts and torn down as it
 * unmounts, opening on `value` with the wording of `field`. Its callbacks read
 * the latest render's values, and a change of text or status is taken into the
 * sheet as it stands, so the caret stays.
 *
 * @see {@link renderEditorSheet}
 */
export function EditorSheetSlot({
  app,
  surface,
  field,
  value,
  text,
  status,
  sheetRef,
  onChange,
  onSubmit,
  onSave,
  onCancel,
  onDone,
  onLeave,
  within,
  ...rest
}: EditorSheetSlotProps) {
  const latest = useRef({
    field,
    value,
    status,
    onChange,
    onSubmit,
    onSave,
    onCancel,
    onDone,
    onLeave,
  });
  latest.current = {
    field,
    value,
    status,
    onChange,
    onSubmit,
    onSave,
    onCancel,
    onDone,
    onLeave,
  };
  const sheet = useRef<EditorSheet | null>(null);
  const saves = onSave !== undefined;
  const leaves = onLeave !== undefined;

  const mount = useCallback(
    (el: HTMLDivElement | null) => {
      const gone = sheet.current;
      gone?.[Symbol.dispose]();
      sheet.current = null;
      // An owner's handle may already hold the sheet that replaced this one.
      if (sheetRef?.current === gone) sheetRef.current = null;
      if (!el) return;
      const at = latest.current;
      sheet.current = renderEditorSheet(
        el,
        {
          app,
          surface,
          field: at.field,
          value: at.value,
          onChange: (value) => latest.current.onChange?.(value),
          onSubmit: () => latest.current.onSubmit(),
          onSave: saves ? () => latest.current.onSave?.() : undefined,
          onCancel: () => latest.current.onCancel(),
          onDone: () => latest.current.onDone(),
          onLeave: leaves ? () => latest.current.onLeave?.() : undefined,
          within,
        },
        at.status,
      );
      if (sheetRef) sheetRef.current = sheet.current;
    },
    [app, surface, saves, leaves, within, sheetRef],
  );

  useLayoutEffect(() => {
    if (text !== undefined) sheet.current?.editor.setText(text);
  }, [text]);

  const { readOnly, hint, manual, saveDisabled } = status;
  useLayoutEffect(() => {
    sheet.current?.update({ readOnly, hint, manual, saveDisabled });
  }, [readOnly, hint, manual, saveDisabled]);

  return <div ref={mount} {...rest} />;
}

/**
 * The comment the user holds that Zotero has not taken, with the verbs that
 * end it, compared by value: a surface may build a fresh `held` on every
 * render.
 *
 * @see {@link renderHeldDraftPanel}
 */
export function HeldDraftSlot({
  held,
  surface,
  actions,
  ...rest
}: {
  held: HeldDraft;
  surface: CommentSurface;
  actions: HeldDraftActions;
} & DivProps) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(actions);
  latest.current = actions;
  const shown = useRef(held);
  if (!sameHeldDraft(shown.current, held)) shown.current = held;
  const stable = shown.current;
  useLayoutEffect(() => {
    if (!ref.current) return;
    renderHeldDraftPanel(ref.current, stable, {
      surface,
      actions: boundHeldActions(latest),
    });
  }, [stable, surface]);
  return <div ref={ref} {...rest} />;
}

/**
 * A Write Conflict on the comment: the fresh Zotero value beside what the user
 * asked for, and the two verbs that end it.
 *
 * @see {@link renderConflictPanel}
 */
export function ConflictPanelSlot({
  conflict,
  live,
  surface,
  actions,
}: {
  conflict: WriteConflict;
  /** Whether the Editing Capability takes a write right now. */
  live: boolean;
  surface: CommentSurface;
  actions: ConflictActions;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(actions);
  latest.current = actions;
  const panel = useMemo(() => conflictPanel(conflict), [conflict]);
  useLayoutEffect(() => {
    if (!ref.current) return;
    renderConflictPanel(ref.current, panel, {
      surface,
      live,
      actions: boundConflictActions(latest),
    });
  }, [panel, live, surface]);
  return <div ref={ref} />;
}

/** The held panel's verbs, each reading the latest render's actions. */
function boundHeldActions(
  latest: RefObject<HeldDraftActions>,
): HeldDraftActions {
  return {
    save: () => latest.current.save(),
    allowEditing: () => latest.current.allowEditing(),
    discard: () => latest.current.discard(),
  };
}

/** The conflict panel's verbs, each reading the latest render's actions. */
function boundConflictActions(
  latest: RefObject<ConflictActions>,
): ConflictActions {
  return {
    applyAgain: () => latest.current.applyAgain(),
    discardConflict: () => latest.current.discardConflict(),
  };
}
