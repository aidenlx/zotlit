// The comment controls as Preact components, for the Annotation Card and the
// Mark Popup alike: the rendered comment, the comment sheet, the held-draft
// panel and the Write Conflict panel. Each draws through the vanilla builder in
// `comment-sheet.ts` and redraws only when what it shows changes, so a render
// of the surface around it never drops a click between its press and its
// release.
import type { App } from "obsidian";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { HTMLAttributes, RefObject } from "react";

import type { WriteConflict } from "@/services/annotation-repository/write";

import { conflictPanel } from "./card-conflict";
import { sameHeldDraft } from "./card-controls";
import type { HeldDraft } from "./card-controls";
import type { CommentRenderer } from "./comment-render";
import {
  commentViewClass,
  opensCommentEditor,
  renderCommentSheet,
  renderConflictPanel,
  renderHeldDraftPanel,
} from "./comment-sheet";
import type {
  CommentDraftActions,
  CommentSheet,
  CommentSheetProps,
  CommentSheetStatus,
  CommentSurface,
} from "./comment-sheet";

type DivProps = Omit<HTMLAttributes<HTMLDivElement>, "children">;

/**
 * The rendered comment: its text stands where the comment sheet's editor will
 * put it, and a click on it opens that sheet. The Markdown renders again only
 * when the comment does.
 */
export function CommentView({
  surface,
  render,
  html,
  editable,
  onOpen,
}: {
  surface: CommentSurface;
  render: CommentRenderer;
  html: string;
  /** Whether a click opens the editor, or the comment is read-only here. */
  editable: boolean;
  onOpen: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    return render(ref.current, html);
  }, [render, html]);
  return (
    <div
      ref={ref}
      className={commentViewClass(surface, editable)}
      onClick={(event) => {
        if (!editable || !opensCommentEditor(event.nativeEvent, surface))
          return;
        // Opening the editor is a verb; the surface's own click is not that.
        event.stopPropagation();
        onOpen();
      }}
    />
  );
}

export interface CommentSheetSlotProps
  extends
    Omit<CommentSheetProps, "app" | "surface">,
    Omit<DivProps, "onChange" | "onSubmit"> {
  app: App;
  surface: CommentSurface;
  /**
   * The comment taken into the open editor as it changes, keeping the caret;
   * `undefined` leaves the editor's text alone.
   */
  text?: string;
  status: CommentSheetStatus;
  /** Holds the sheet while it stands, for an owner that reads its text. */
  sheetRef?: RefObject<CommentSheet | null>;
}

/**
 * The comment sheet, built once as the slot mounts and torn down as it
 * unmounts, opening on `value`. Its callbacks read the latest render's values,
 * and a change of text or status is taken into the sheet as it stands, so the
 * caret stays.
 *
 * @see {@link renderCommentSheet}
 */
export function CommentSheetSlot({
  app,
  surface,
  value,
  text,
  status,
  sheetRef,
  onChange,
  onSubmit,
  onSave,
  onCancel,
  onLeave,
  within,
  ...rest
}: CommentSheetSlotProps) {
  const latest = useRef({
    value,
    status,
    onChange,
    onSubmit,
    onSave,
    onCancel,
    onLeave,
  });
  latest.current = {
    value,
    status,
    onChange,
    onSubmit,
    onSave,
    onCancel,
    onLeave,
  };
  const sheet = useRef<CommentSheet | null>(null);
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
      sheet.current = renderCommentSheet(
        el,
        {
          app,
          surface,
          value: at.value,
          onChange: (value) => latest.current.onChange?.(value),
          onSubmit: () => latest.current.onSubmit(),
          onSave: saves ? () => latest.current.onSave?.() : undefined,
          onCancel: () => latest.current.onCancel(),
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
  onOpen,
  ...rest
}: {
  held: HeldDraft;
  surface: CommentSurface;
  actions: CommentDraftActions;
  onOpen: () => void;
} & DivProps) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef({ actions, onOpen });
  latest.current = { actions, onOpen };
  const shown = useRef(held);
  if (!sameHeldDraft(shown.current, held)) shown.current = held;
  const stable = shown.current;
  useLayoutEffect(() => {
    if (!ref.current) return;
    renderHeldDraftPanel(ref.current, stable, {
      surface,
      actions: boundDraftActions(latest),
      onOpen: () => latest.current.onOpen(),
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
  actions: CommentDraftActions;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef({ actions });
  latest.current = { actions };
  const panel = useMemo(() => conflictPanel(conflict), [conflict]);
  useLayoutEffect(() => {
    if (!ref.current) return;
    renderConflictPanel(ref.current, panel, {
      surface,
      live,
      actions: boundDraftActions(latest),
    });
  }, [panel, live, surface]);
  return <div ref={ref} />;
}

/** The panels' verbs, each reading the latest render's actions. */
function boundDraftActions(
  latest: RefObject<{ actions: CommentDraftActions }>,
): CommentDraftActions {
  return {
    save: () => latest.current.actions.save(),
    allowEditing: () => latest.current.actions.allowEditing(),
    discard: () => latest.current.actions.discard(),
    applyAgain: () => latest.current.actions.applyAgain(),
    discardConflict: () => latest.current.actions.discardConflict(),
  };
}
