import { Menu, Platform } from "obsidian";
import type { App } from "obsidian";
import { createContext } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent } from "react";

import { annotationOpenUri, parseIndexedKey } from "@zotlit/db";
import { resolveAnnotCachePath } from "@zotlit/db/path";

import { buildColorMenu } from "@/lib/annotation-colors";
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
import {
  writeFailureMessage,
  writeFailureReason,
} from "@/services/annotation-repository/write";
import { addCopyIndexedKeyMenuItem } from "@/services/indexed-key/menu";
import type { NoteFeature } from "@/services/note-feature";
import { InertTemplateError } from "@/services/template/errors";

import type { CardControl } from "./card-controls";
import type { CommentRenderer } from "./comment-render";
import {
  buildAttachmentMenu,
  buildFollowModeMenu,
  buildTagMenu,
} from "./menus";
import { attachmentLine } from "./presentation";
import type { AnnotState, FollowMode } from "./store";

export interface AnnotActions {
  /** Open a card's overflow menu, from the control that carries it. */
  onMoreOptions(
    evt: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
    annot: AnnotationRecord,
  ): void;
  /** Open the Follow Mode menu from the toolbar's mode button. */
  onFollowModeMenu(evt: MouseEvent<HTMLElement>): void;
  /** Open the Attachment picker from the slot under the toolbar. */
  onAttachmentMenu(evt: MouseEvent<HTMLElement>): void;
  /** Open Zotero's eight swatches from a card's palette control. */
  onColorMenu(evt: MouseEvent<HTMLElement>, annot: AnnotationRecord): void;
  /** Open a card's own tags, each one a filter toggle. */
  onTagMenu(evt: MouseEvent<HTMLElement>, annot: AnnotationRecord): void;
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
  onSaveComment(annot: AnnotationRecord, comment: string): void;
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
   * Send one Uncertain Create again on its original write token, from the
   * badged card's "Try again".
   *
   * @param writeToken the token the Uncertain Create carries.
   */
  onRetryCreate(writeToken: string): void;
  /** Drop one Uncertain Create, from the badged card's "Discard". */
  onDiscardCreate(writeToken: string): void;
  getImgSrc(annot: AnnotationRecord): string;
  getBacklink(annot: AnnotationRecord): string | undefined;
  /** Render a comment's Zotero HTML as Markdown; returns a disposer. */
  renderComment: CommentRenderer;
}

export interface AnnotActionDeps {
  app: App;
  getDataDir: () => string;
  /**
   * The one write path for an Annotation. Commands take Indexed Keys: the
   * repository holds the record a write stamps its precondition off.
   */
  annotations: Pick<
    AnnotationRepository,
    | "deleteAnnotation"
    | "discardConflict"
    | "discardCreate"
    | "patchColor"
    | "patchComment"
    | "retryCreate"
    | "retryWrite"
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
  onPinCurrentItem: AnnotActions["onPinCurrentItem"];
  onPinItem: AnnotActions["onPinItem"];
  onUnpin: AnnotActions["onUnpin"];
  onEnableLiveUpdates: AnnotActions["onEnableLiveUpdates"];
  onSelectAnnotation: AnnotActions["onSelectAnnotation"];
  onExploreAnnotation: (annotationKey: string) => void;
}

const IMG_PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="140">' +
    '<rect width="100%" height="100%" fill="rgba(128,128,128,0.18)"/>' +
    '<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" ' +
    'fill="gray" font-family="sans-serif" font-size="14">Image not cached</text>' +
    "</svg>",
)}`;

function resourceUrl(absolutePath: string): string {
  const encoded = encodeURI(absolutePath);
  return `${Platform.resourcePathPrefix}${encoded.replace(/^\//, "")}?${Date.now()}`;
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
  const onSaveComment = (annot: AnnotationRecord, comment: string): void =>
    report(deps.annotations.patchComment(annot.key, comment));
  const onDeleteAnnotation = (annot: AnnotationRecord): void =>
    report(deps.annotations.deleteAnnotation(annot.key));
  const onApplyAgain = (annot: AnnotationRecord): void =>
    report(deps.annotations.retryWrite(annot.key));
  const onDiscardConflict = (annot: AnnotationRecord): void =>
    deps.annotations.discardConflict(annot.key);
  /**
   * A retry that stays uncertain has already said so on its own badged card,
   * and one that landed needs no notice: only a refusal is news.
   */
  const onRetryCreate = (writeToken: string): void => {
    void deps.annotations.retryCreate(writeToken).then((outcome) => {
      if (outcome.kind !== "failed") return;
      new BaseNotice(
        m.pdf_create_failed({
          reason: writeFailureReason(outcome.failure, now()),
        }),
      );
    });
  };
  const onDiscardCreate = (writeToken: string): void =>
    deps.annotations.discardCreate(writeToken);

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

  const getImgSrc = (annot: AnnotationRecord): string => {
    const parsed = parseIndexedKey(annot.key);
    const cachePath =
      parsed &&
      resolveAnnotCachePath(
        { key: parsed.key, type: annot.type },
        { dataDir: deps.getDataDir(), groupID: parsed.groupID },
      );
    return cachePath ? resourceUrl(cachePath) : IMG_PLACEHOLDER;
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
    // The keyboard’s route to what a drag does. A native MenuItem carries no
    // tooltip, so a blocked insert says why in a label beside it.
    // @see apps/obsidian/policies/tooltips.md
    const { dragTarget } = deps.getState();
    menu.addItem((item) => {
      item
        .setTitle(m.annot_view_menu_insert())
        .setIcon("file-input")
        .setDisabled(dragTarget !== "ready")
        .onClick(() => deps.insertAnnotation(annot));
    });
    if (dragTarget !== "ready") {
      menu.addItem((item) =>
        item.setTitle(m.annot_view_insert_no_note()).setIsLabel(true),
      );
    }

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

    // A native MenuItem carries no tooltip, so a blocked delete says why in a
    // label beside it rather than in one it cannot show.
    // @see apps/obsidian/policies/tooltips.md
    const control = deps.deleteControl(annot);
    menu.addItem((item) => {
      item
        .setTitle(m.annot_view_menu_delete())
        .setIcon("trash-2")
        .setDisabled(control.disabled)
        .onClick(() => onDeleteAnnotation(annot));
    });
    if (control.disabled) {
      menu.addItem((item) => item.setTitle(control.tooltip).setIsLabel(true));
    }
  };

  return {
    getBacklink,
    getImgSrc,
    onSetColor,
    onSaveComment,
    onDeleteAnnotation,
    onApplyAgain,
    onDiscardConflict,
    onRetryCreate,
    onDiscardCreate,
    onMoreOptions(evt, annot) {
      showMenu(evt, (menu) => fillCardMenu(menu, annot), "end");
    },
    onFollowModeMenu(evt) {
      const { followMode, pinnable } = deps.getState();
      showMenu(evt, (menu) =>
        buildFollowModeMenu(menu, {
          state: { followMode, pinnable },
          actions: {
            onSetFollowMode: deps.onSetFollowMode,
            onPinCurrentItem: deps.onPinCurrentItem,
            onPinItem: deps.onPinItem,
            onUnpin: deps.onUnpin,
          },
        }),
      );
    },
    onAttachmentMenu(evt) {
      const line = attachmentLine(deps.getState());
      if (line.kind !== "picker") return;
      showMenu(evt, (menu) =>
        buildAttachmentMenu(menu, {
          options: line.options,
          selectedKey: line.selectedKey,
          onSelect: deps.setSelectedAttachmentKey,
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
    onTagMenu(evt, annot) {
      showMenu(evt, (menu) =>
        buildTagMenu(menu, {
          tags: annot.tags,
          selectedTags: deps.getState().selectedTags,
          onToggle: deps.toggleSelectedTag,
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

const NOOP_ACTIONS: AnnotActions = {
  onMoreOptions: () => {},
  onFollowModeMenu: () => {},
  onAttachmentMenu: () => {},
  onColorMenu: () => {},
  onTagMenu: () => {},
  onDragStart: () => {},
  onSetFollowMode: () => {},
  onPinCurrentItem: () => {},
  onPinItem: () => {},
  onUnpin: () => {},
  onEnableLiveUpdates: () => {},
  onSelectAnnotation: () => {},
  onSetColor: () => {},
  onSaveComment: () => {},
  onDeleteAnnotation: () => {},
  onApplyAgain: () => {},
  onDiscardConflict: () => {},
  onRetryCreate: () => {},
  onDiscardCreate: () => {},
  onRefresh: () => {},
  getImgSrc: () => IMG_PLACEHOLDER,
  getBacklink: () => undefined,
  renderComment: () => () => {},
};

export const AnnotActionsContext = createContext<AnnotActions>(NOOP_ACTIONS);
