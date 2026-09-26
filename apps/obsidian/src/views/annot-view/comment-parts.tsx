// The comment controls as Preact components, for the Annotation Card and the
// Mark Popup alike: the rendered comment, the resting comment field that opens
// the editor, the editor sheet, the held-draft panel and the Write Conflict
// panel. Each draws through the vanilla builder in
// `editor-sheet.ts` and redraws only when what it shows changes, so a render
// of the surface around it never drops a click between its press and its
// release.
import type { App } from "obsidian";
import { useCallback, useId, useLayoutEffect, useMemo, useRef } from "react";
import type { HTMLAttributes, RefObject } from "react";

import * as m from "@/lib/i18n/generated/messages";
import { themeHook } from "@/lib/theme-hooks";
import { claimClick, cn } from "@/lib/utils";
import type { WriteConflict } from "@/services/annotation-repository/write";

import { conflictPanel } from "./card-conflict";
import { sameHeldDraft } from "./card-controls";
import type { CardControl, HeldDraft } from "./card-controls";
import type { CommentRenderer } from "./comment-render";
import {
  clickEdits,
  commentViewClass,
  renderEditorSheet,
  renderConflictPanel,
  renderHeldDraftPanel,
} from "./editor-sheet";
import type {
  CommentEntry,
  ConflictActions,
  HeldDraftActions,
  EditorSheet,
  EditorSheetProps,
  EditorSheetStatus,
  EditorSurface,
} from "./editor-sheet";

type DivProps = Omit<HTMLAttributes<HTMLDivElement>, "children">;

export type { CommentEntry } from "./editor-sheet";

/**
 * The comment field's entry for one editing control: its refusal and its
 * block come from the control, so a surface that decides its verbs through
 * {@link CardControl} states nothing twice.
 */
export function controlEntry(
  control: CardControl,
  onPress: CommentEntry["onPress"],
): CommentEntry {
  return {
    disabled: control.disabled,
    blocked: control.blocked !== null,
    onPress,
  };
}

/**
 * The rendered comment, in the place the editor sheet's editor puts its text.
 * With an `entry` — on a card selected alone, and in the Mark Popup — it is
 * the comment field at rest: it shows "Add a comment…" where there is no
 * comment, and a click, Enter, or reaching it with Tab opens the editor in
 * its place. A click that selected text or followed a link stays a read
 * (ADR 0066).
 *
 * One element with an entry or without it, so a text selection made on the
 * comment survives the card becoming selected alone under it. The Markdown
 * renders again only when the comment does. The field is named by a hidden
 * label rather than `aria-label`, which Obsidian would show as a tooltip over
 * the text.
 *
 * @see apps/obsidian/docs/adr/0066-the-comment-is-an-editable-field-on-a-card-selected-alone-and-in-the-mark-popup.md
 */
export function CommentView({
  surface,
  render,
  html,
  entry,
}: {
  surface: EditorSurface;
  render: CommentRenderer;
  /**
   * The stored comment, or `null` where there is none, which only a field
   * shows, as its placeholder.
   */
  html: string | null;
  entry?: CommentEntry;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const labelId = useId();
  useLayoutEffect(() => {
    if (!ref.current || html === null) return;
    return render(ref.current, html);
  }, [render, html]);
  const empty = html === null;
  // The label stands in every state, so the comment's element keeps its seat.
  const label = (
    <span key="label" id={labelId} hidden>
      {m.annot_view_card_comment_label()}
    </span>
  );
  if (!entry) {
    return (
      <>
        {label}
        <div
          key="comment"
          ref={ref}
          className={commentViewClass(surface, false)}
        />
      </>
    );
  }
  const { disabled, blocked, onPress } = entry;
  const editable = !disabled && !blocked;
  return (
    <>
      {label}
      <div
        // Keyed by what it draws, so the renderer's nodes and the placeholder
        // never share one element.
        key={empty ? "empty" : "comment"}
        ref={ref}
        role="textbox"
        aria-multiline
        aria-labelledby={labelId}
        aria-placeholder={m.annot_view_card_comment_placeholder()}
        aria-readonly={blocked || undefined}
        aria-disabled={disabled || undefined}
        tabIndex={0}
        className={cn(
          themeHook.annotCommentField,
          commentViewClass(surface, editable),
          empty && "zt:text-faint",
          empty && !editable && "zt:opacity-60",
        )}
        data-blocked={blocked ? "" : undefined}
        onClick={(e) => {
          if (disabled || !clickEdits(e)) return;
          // Placing the caret is not the surface's own click.
          claimClick(e);
          onPress({ x: e.clientX, y: e.clientY });
        }}
        onFocus={(e) => {
          // Reaching the field from the keyboard is reaching into it; a press
          // focuses it too, and its click is what opens the editor then.
          if (editable && e.currentTarget.matches(":focus-visible")) onPress();
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          e.stopPropagation();
          if (!disabled) onPress();
        }}
      >
        {empty ? m.annot_view_card_comment_placeholder() : null}
      </div>
    </>
  );
}

export interface EditorSheetSlotProps
  extends
    Omit<EditorSheetProps, "app" | "surface">,
    Omit<DivProps, "onChange" | "onSubmit"> {
  app: App;
  surface: EditorSurface;
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
  commit,
  onLeave,
  within,
  caretAt,
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
    commit,
    onLeave,
    caretAt,
  });
  latest.current = {
    field,
    value,
    status,
    onChange,
    onSubmit,
    onSave,
    onCancel,
    commit,
    onLeave,
    caretAt,
  };
  const sheet = useRef<EditorSheet | null>(null);
  const saves = onSave !== undefined;
  const leaves = onLeave !== undefined;
  const commitLabel = commit?.label;

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
          commit:
            commitLabel === undefined
              ? undefined
              : {
                  label: commitLabel,
                  run: () => latest.current.commit?.run(),
                },
          onLeave: leaves ? () => latest.current.onLeave?.() : undefined,
          within,
          caretAt: at.caretAt,
        },
        at.status,
      );
      if (sheetRef) sheetRef.current = sheet.current;
    },
    [app, surface, saves, leaves, commitLabel, within, sheetRef],
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
  entry,
  ...rest
}: {
  held: HeldDraft;
  surface: EditorSurface;
  actions: HeldDraftActions;
  /** What a click on the held text does; absent where a click only reads. */
  entry?: CommentEntry;
} & DivProps) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(actions);
  latest.current = actions;
  const latestPress = useRef(entry?.onPress);
  latestPress.current = entry?.onPress;
  const opens = entry !== undefined;
  const disabled = entry?.disabled ?? false;
  const blocked = entry?.blocked ?? false;
  const shown = useRef(held);
  if (!sameHeldDraft(shown.current, held)) shown.current = held;
  const stable = shown.current;
  useLayoutEffect(() => {
    if (!ref.current) return;
    renderHeldDraftPanel(ref.current, stable, {
      surface,
      actions: boundHeldActions(latest),
      entry: opens
        ? { disabled, blocked, onPress: () => latestPress.current?.() }
        : undefined,
    });
  }, [stable, surface, opens, disabled, blocked]);
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
  surface: EditorSurface;
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
