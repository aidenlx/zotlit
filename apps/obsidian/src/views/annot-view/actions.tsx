import { Menu } from "obsidian";
import type { App } from "obsidian";
import { createContext } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent } from "react";

import { annotationOpenUri, parseIndexedKey } from "@zotlit/db";

import { buildColorMenu } from "@/lib/annotation-colors";
import { confirm } from "@/lib/confirm";
import * as m from "@/lib/i18n/generated/messages";
import { showMenuAtButton } from "@/lib/menu";
import type { MenuAlign } from "@/lib/menu";
import { BaseNotice } from "@/lib/notice";
import * as toast from "@/lib/toast";
import type {
  AnnotationRecord,
  AnnotationRepository,
  MutationState,
} from "@/services/annotation-repository/service";
import { writeFailureMessage } from "@/services/annotation-repository/write";
import type {
  ExcerptDisplayDemand,
  ExcerptDisplayService,
  ExcerptImageDisplay,
} from "@/services/excerpt-image/display";
import type { ExcerptRequest } from "@/services/excerpt-image/service";
import { addCopyIndexedKeyMenuItem } from "@/services/indexed-key/menu";
import type { NoteFeature } from "@/services/note-feature";
import { InertTemplateError } from "@/services/template/errors";

import { chooseAttachment } from "./attachment-suggester";
import type { CardBlock, CardControl } from "./card-controls";
import type { CommentRenderer } from "./comment-render";
import type { ExcerptImageTarget } from "./excerpt-image-state";
import { buildHeaderMenu } from "./menus";
import { attachmentLine, headerMenu } from "./presentation";
import type { AnnotState, FollowMode } from "./store";

export interface AnnotActions {
  /** Open a card's overflow menu, from the control that carries it. */
  onMoreOptions(
    evt: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
    annot: AnnotationRecord,
  ): void;
  /** Open the header block's one grouped menu, from the block itself. */
  onHeaderMenu(evt: MouseEvent<HTMLElement>): void;
  /** Choose another Attachment of the Item on screen, in a suggester. */
  onChooseAttachment(): void;
  /** Ask Zotero for write authorization, from the header menu. */
  onAllowEditing(): void;
  /**
   * Say why the verb just pressed could not act, in an Obsidian notice. A
   * blocked verb keeps its press and spends it here instead of on the write.
   * The notice reads the capability at the press, so it offers the one gesture
   * that could change it where there is one.
   */
  onBlockedPress(block: CardBlock): void;
  /** Open Zotero's eight swatches from a card's palette control. */
  onColorMenu(evt: MouseEvent<HTMLElement>, annot: AnnotationRecord): void;
  onDragStart(evt: DragEvent<HTMLElement>, annot: AnnotationRecord): void;
  onRefresh(): void;
  /** Follow the active tab or the Zotero reader, from a user gesture. */
  onSetFollowMode(mode: Exclude<FollowMode, "pinned">): void;
  /** Pin the Item on screen, releasing an Obsidian PDF view's lock. */
  onPinCurrentItem(): void;
  /** Search Zotero for an Item to pin. */
  onPinItem(): void;
  /** Return to the mode the pin interrupted. */
  onUnpin(): void;
  /** Turn Live updates on, so the Zotero reader can reach this view. */
  onEnableLiveUpdates(): void;
  /**
   * Take this Annotation as the selection, from a click on its card: the reader
   * the view follows selects it and moves to its Annotation Mark.
   *
   * @see https://github.com/aidenlx/zotlit/issues/1148
   */
  onSelectAnnotation(annot: AnnotationRecord): void;
  /** Recolour one Annotation in Zotero, from a swatch in the card's menu. */
  onSetColor(annot: AnnotationRecord, color: string): void;
  /** Store what the card's comment editor holds, from the gesture that closed it. */
  onSaveComment(
    annot: AnnotationRecord,
    comment: string,
    automatic?: boolean,
  ): void;
  onOpenComment(annot: AnnotationRecord): void;
  onEditComment(annot: AnnotationRecord, comment: string): void;
  /**
   * Drop held text Zotero never took, from the card's "Discard". Zotero's own
   * comment stands as it is, so the card behind the panel already shows what
   * the discard leaves.
   */
  onDiscardComment(annot: AnnotationRecord): void;
  /** Erase one Annotation in Zotero, from the card's overflow menu. */
  onDeleteAnnotation(annot: AnnotationRecord): void;
  /**
   * Send a conflicted write again, against the value Zotero holds now — the
   * card's "Apply again", and its "Delete anyway".
   */
  onApplyAgain(annot: AnnotationRecord): void;
  /** Leave Zotero's copy as it stands, from the conflicted card's "Discard". */
  onDiscardConflict(annot: AnnotationRecord): void;
  /**
   * Open one card's demand on its Annotation's live Excerpt Image. The card
   * states what it paints and releases the demand as it goes.
   */
  openExcerptImage(): ExcerptDisplayDemand;
  /**
   * The request one card's target resolves, or `null` where nothing can: no
   * Annotation Source, another Zotero data directory, or an unready database.
   */
  excerptImageRequest(target: ExcerptImageTarget): ExcerptRequest | null;
  getBacklink(annot: AnnotationRecord): string | undefined;
  /** Render a comment's Zotero HTML as Markdown; returns a disposer. */
  renderComment: CommentRenderer;
}

export interface AnnotActionDeps {
  app: App;
  /** The plugin's live display surface for Excerpt Images. */
  excerptDisplay: Pick<ExcerptDisplayService, "open">;
  excerptImageRequest: AnnotActions["excerptImageRequest"];
  /**
   * The one write path for an Annotation. Commands take Indexed Keys: the
   * repository holds the record a write stamps its precondition off.
   */
  annotations: Pick<
    AnnotationRepository,
    | "deleteAnnotation"
    | "discardCommentDraft"
    | "discardConflict"
    | "patchColor"
    | "editComment"
    | "commentDraftFor"
    | "retryCommentDraft"
    | "retryWrite"
    | "submitComment"
  >;
  /** The clock a failure notice reads a cooldown's remaining seconds against. */
  now?: () => Temporal.Instant;
  /**
   * Whether the overflow menu's delete runs, and the reason it does not. The
   * view supplies it: the capability and the Annotation's mutation state live
   * in its store, and the native menu is built outside React.
   */
  deleteControl: (annot: AnnotationRecord) => CardControl;
  /**
   * The numeric id the Zotero database holds for an Annotation, or `null` for
   * one it does not hold yet — an Annotation created through the Zotero Local
   * API, which the card shows before SQLite knows it. The note templates read
   * the database, so they can render only what it holds.
   *
   * @see apps/obsidian/docs/adr/0033-zotero-object-identity-is-the-indexed-key-server-id-is-source-data.md
   */
  resolveAnnotationID: (indexedKey: string) => number | null;
  /**
   * What the view is showing right now. A native menu is built at the moment
   * the gesture opens it, so its entries are read then rather than subscribed
   * to — the same reason {@link AnnotActionDeps.deleteControl} is a callback.
   */
  getState: () => AnnotState;
  /** Show another Attachment of the Item on screen, from the picker. */
  setSelectedAttachmentKey: (key: string) => void;
  /** Add or drop one tag from the list filter, from a card's tag menu. */
  toggleSelectedTag: (tag: string) => void;
  refresh: () => Promise<void>;
  noteFeature: Pick<NoteFeature, "renderAnnotationCitation">;
  /** Templated drag-insert handler built by the view (owns the import handle). */
  onDragStart: AnnotActions["onDragStart"];
  /**
   * Put one Annotation into the active note, from the overflow menu — the same
   * Markdown the drag drops, on the route a keyboard reaches.
   */
  insertAnnotation: (annot: AnnotationRecord) => void;
  /** Comment renderer built by the view (owns the app, component, source path). */
  renderComment: CommentRenderer;
  onSetFollowMode: AnnotActions["onSetFollowMode"];
  onAllowEditing: AnnotActions["onAllowEditing"];
  onPinCurrentItem: AnnotActions["onPinCurrentItem"];
  onPinItem: AnnotActions["onPinItem"];
  onUnpin: AnnotActions["onUnpin"];
  onEnableLiveUpdates: AnnotActions["onEnableLiveUpdates"];
  onSelectAnnotation: AnnotActions["onSelectAnnotation"];
  onExploreAnnotation: (annotationKey: string) => void;
}

export function createAnnotActions(deps: AnnotActionDeps): AnnotActions {
  const now = deps.now ?? (() => Temporal.Now.instant());

  /**
   * The seam a write's outcome is rendered at: the repository answers data and
   * the notice is raised here, once, naming the reason. Nothing was drawn
   * ahead of Zotero, so a failure needs no undo — the card already shows what
   * Zotero holds.
   *
   * @see apps/obsidian/policies/ui-seams.md
   */
  const report = (outcome: Promise<MutationState>): void => {
    void outcome.then((state) => {
      if (state.kind !== "failed") return;
      new BaseNotice(writeFailureMessage(state.failure, now()));
    });
  };

  const onSetColor = (annot: AnnotationRecord, color: string): void =>
    report(deps.annotations.patchColor(annot.key, color));
  const onEditComment = (annot: AnnotationRecord, comment: string): void => {
    deps.annotations.editComment(annot.key, comment);
  };
  const onOpenComment = (annot: AnnotationRecord): void => {
    deps.annotations.editComment(annot.key);
  };
  const onDiscardComment = (annot: AnnotationRecord): void => {
    deps.annotations.discardCommentDraft(annot.key);
  };
  const onSaveComment = (
    annot: AnnotationRecord,
    comment: string,
    automatic = false,
  ): void => {
    deps.annotations.editComment(annot.key, comment);
    report(deps.annotations.submitComment(annot.key, { automatic }));
  };
  const onDeleteAnnotation = (annot: AnnotationRecord): void =>
    report(deps.annotations.deleteAnnotation(annot.key));
  /**
   * An erase leaves Zotero holding nothing, and the Annotation History puts it
   * back only under a new key, so the delete asks once against the card the
   * user can see.
   *
   * @see apps/obsidian/policies/ui-seams.md
   */
  const confirmDeleteAnnotation = async (
    annot: AnnotationRecord,
  ): Promise<void> => {
    const confirmed = await confirm(
      {
        title: m.annot_view_delete_confirm_title(),
        content: m.annot_view_delete_confirm_content(),
        action: m.annot_view_delete_confirm_action(),
        destructive: true,
      },
      deps.app,
    );
    if (confirmed) onDeleteAnnotation(annot);
  };
  const commentConflict = (annotationKey: string): boolean => {
    const mutation = deps.getState().mutations.get(annotationKey);
    return (
      mutation?.kind === "conflict" && mutation.conflict.write === "comment"
    );
  };
  const onApplyAgain = (annot: AnnotationRecord): void =>
    report(
      commentConflict(annot.key) && deps.annotations.commentDraftFor(annot.key)
        ? deps.annotations.retryCommentDraft(annot.key)
        : deps.annotations.retryWrite(annot.key),
    );
  const onDiscardConflict = (annot: AnnotationRecord): void => {
    if (
      commentConflict(annot.key) &&
      deps.annotations.commentDraftFor(annot.key)
    ) {
      deps.annotations.discardCommentDraft(annot.key);
    } else {
      deps.annotations.discardConflict(annot.key);
    }
  };
  // Every key on a record is an Indexed Key, so the library it names travels
  // with it: the Zotero URI and the cache path both want the bare key beside
  // the group the key already carries.
  const getBacklink = (annot: AnnotationRecord): string | undefined => {
    const annotation = parseIndexedKey(annot.key);
    const attachment = parseIndexedKey(annot.parentKey);
    if (!annotation || !attachment) return undefined;
    return annotationOpenUri({
      attachmentKey: attachment.key,
      annotationKey: annotation.key,
      pageLabel: annot.pageLabel,
      groupID: annotation.groupID,
    });
  };

  /**
   * A menu opened from a control, anchored under the control itself — so it
   * lands in the same place however the control was activated.
   *
   * @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md
   */
  const showMenu = (
    evt: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
    fill: (menu: Menu) => void,
    align?: MenuAlign,
  ): void => {
    const menu = new Menu();
    fill(menu);
    showMenuAtButton(menu, evt.currentTarget, align);
  };

  /**
   * The Attachment picker the header menu opens. The choice it offers is the
   * one `attachmentLine` decided, read at the moment the row was pressed.
   */
  const onChooseAttachment = (): void => {
    const line = attachmentLine(deps.getState());
    if (line.kind !== "picker") return;
    chooseAttachment(deps.app, line.options, deps.setSelectedAttachmentKey);
  };

  const fillCardMenu = (menu: Menu, annot: AnnotationRecord): void => {
    const backlink = getBacklink(annot);
    if (backlink) {
      menu.addItem((item) => {
        item
          .setTitle(m.annot_view_menu_copy_backlink())
          .setIcon("link")
          .onClick(() => {
            void toast.promise(navigator.clipboard.writeText(backlink), {
              success: m.annot_view_copied_backlink(),
              error: m.annot_view_copy_failed(),
            });
          });
      });
    }

    if (annot.text != null) {
      menu.addItem((item) => {
        item
          .setTitle(m.annot_view_menu_copy_text())
          .setIcon("copy")
          .onClick(() => {
            void toast.promise(navigator.clipboard.writeText(annot.text!), {
              success: m.annot_view_copied_text(),
              error: m.annot_view_copy_failed(),
            });
          });
      });
    }

    addCopyIndexedKeyMenuItem(menu, {
      indexedKey: annot.key,
      kind: "annotation",
    });

    menu.addItem((item) => {
      item
        .setTitle(m.annot_view_menu_copy_citation())
        .setIcon("quote")
        .onClick(() => {
          const annotationID = deps.resolveAnnotationID(annot.key);
          if (annotationID === null) {
            new BaseNotice(m.annot_view_annotation_not_in_database());
            return;
          }
          let citation: string | null;
          try {
            citation = deps.noteFeature.renderAnnotationCitation(annotationID);
          } catch (e) {
            if (!(e instanceof InertTemplateError)) throw e;
            new BaseNotice(e.message);
            return;
          }
          if (citation === null) {
            new BaseNotice(m.annot_view_copy_citation_no_key());
            return;
          }
          void toast.promise(navigator.clipboard.writeText(citation), {
            success: m.annot_view_copied_citation(),
            error: m.annot_view_copy_failed(),
          });
        });
    });

    menu.addSeparator();
    // The keyboard's route to what a drag does.
    menu.addItem((item) => {
      item
        .setTitle(m.annot_view_menu_insert())
        .setIcon("file-input")
        .setDisabled(
          !deps.app.workspace.activeEditor?.file ||
            !deps.app.workspace.activeEditor.editor,
        )
        .onClick(() => deps.insertAnnotation(annot));
    });

    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle(m.template_data_explorer_menu_explore())
        .setIcon("braces")
        .onClick(() => {
          const parsed = parseIndexedKey(annot.key);
          if (parsed) deps.onExploreAnnotation(parsed.key);
        });
    });

    // Every entry here is a verb. A blocked write shows as a dimmed entry and
    // says why once, in the header menu's capability row and in the notice a
    // card verb raises, rather than in a label under each menu it blocks. A menu
    // row is dimmed by either reason: the notice is reached from a card verb,
    // and a menu cannot raise one.
    const deleteControl = deps.deleteControl(annot);
    menu.addItem((item) => {
      item
        .setTitle(m.annot_view_menu_delete())
        .setIcon("trash-2")
        .setWarning(true)
        .setDisabled(deleteControl.disabled || deleteControl.blocked !== null)
        .onClick(() => void confirmDeleteAnnotation(annot));
    });
  };

  return {
    getBacklink,
    openExcerptImage: () => deps.excerptDisplay.open(),
    excerptImageRequest: deps.excerptImageRequest,
    onSetColor,
    onSaveComment,
    onOpenComment,
    onEditComment,
    onDiscardComment,
    onDeleteAnnotation,
    onApplyAgain,
    onDiscardConflict,
    onMoreOptions(evt, annot) {
      showMenu(evt, (menu) => fillCardMenu(menu, annot), "end");
    },
    onHeaderMenu(evt) {
      showMenu(evt, (menu) =>
        buildHeaderMenu(menu, {
          groups: headerMenu(deps.getState(), now()),
          actions: {
            onSetFollowMode: deps.onSetFollowMode,
            onPinCurrentItem: deps.onPinCurrentItem,
            onPinItem: deps.onPinItem,
            onUnpin: deps.onUnpin,
            onChooseAttachment,
            onAllowEditing: deps.onAllowEditing,
          },
        }),
      );
    },
    onChooseAttachment,
    onAllowEditing: deps.onAllowEditing,
    onBlockedPress(block) {
      if (block.action === null) {
        new BaseNotice(block.reason);
        return;
      }
      const notice = new BaseNotice(
        BaseNotice.render((renderer) => {
          renderer.setTitle(block.reason);
          renderer.addAction((button) => {
            button.setButtonText(m.capability_enable_editing()).onClick(() => {
              notice.hide();
              deps.onAllowEditing();
            });
          });
        }),
      );
    },
    onColorMenu(evt, annot) {
      showMenu(evt, (menu) =>
        buildColorMenu(menu, {
          color: annot.color,
          onSelect: (hex) => onSetColor(annot, hex),
        }),
      );
    },
    onDragStart: deps.onDragStart,
    renderComment: deps.renderComment,
    onSetFollowMode: deps.onSetFollowMode,
    onPinCurrentItem: deps.onPinCurrentItem,
    onPinItem: deps.onPinItem,
    onUnpin: deps.onUnpin,
    onEnableLiveUpdates: deps.onEnableLiveUpdates,
    onSelectAnnotation: deps.onSelectAnnotation,
    onRefresh() {
      void toast.promise(deps.refresh(), {
        loading: m.annot_view_refreshing(),
        success: m.annot_view_refreshed(),
        error: m.annot_view_refresh_failed(),
      });
    },
  };
}

/** What a card outside a configured view shows: nothing, and no demand to make. */
const NOOP_DISPLAY: ExcerptImageDisplay = {
  image: null,
  current: false,
  status: "absent",
};

const NOOP_DEMAND: ExcerptDisplayDemand = {
  demand: () => {},
  release: () => {},
  subscribe: () => () => {},
  snapshot: () => NOOP_DISPLAY,
};

const NOOP_ACTIONS: AnnotActions = {
  onMoreOptions: () => {},
  onHeaderMenu: () => {},
  onChooseAttachment: () => {},
  onAllowEditing: () => {},
  onBlockedPress: () => {},
  onColorMenu: () => {},
  onDragStart: () => {},
  onSetFollowMode: () => {},
  onPinCurrentItem: () => {},
  onPinItem: () => {},
  onUnpin: () => {},
  onEnableLiveUpdates: () => {},
  onSelectAnnotation: () => {},
  onSetColor: () => {},
  onSaveComment: () => {},
  onDiscardComment: () => {},
  onOpenComment: () => {},
  onEditComment: () => {},
  onDeleteAnnotation: () => {},
  onApplyAgain: () => {},
  onDiscardConflict: () => {},
  onRefresh: () => {},
  openExcerptImage: () => NOOP_DEMAND,
  excerptImageRequest: () => null,
  getBacklink: () => undefined,
  renderComment: () => () => {},
};

export const AnnotActionsContext = createContext<AnnotActions>(NOOP_ACTIONS);
