import { Menu } from "obsidian";
import type { App } from "obsidian";
import { createContext } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent } from "react";

import { annotationOpenUri, parseIndexedKey } from "@zotlit/db";

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
  TextField,
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
import { groupControl } from "./card-controls";
import type { CardBlock, CardControl, CardControls } from "./card-controls";
import type { CardClick } from "./card-selection";
import { blockedNotice, confirmDelete, copyText, recolor } from "./card-verbs";
import type { CommentRenderer } from "./comment-render";
import { copiedText } from "./copied-text";
import type { ExcerptImageTarget } from "./excerpt-image-state";
import { buildHeaderMenu } from "./menus";
import { attachmentLine, headerMenu } from "./presentation";
import type { AnnotState, FollowMode } from "./store";

export interface AnnotActions {
  /**
   * Open a card's overflow menu, from the control that carries it. On a card
   * inside the Card Selection the menu acts on the whole selection; on one
   * outside it, the card is selected alone first.
   */
  onMoreOptions(
    evt: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
    annot: AnnotationRecord,
  ): void;
  /**
   * Open the same menu as {@link AnnotActions.onMoreOptions} at the pointer,
   * from a right-click on the card.
   */
  onCardMenu(evt: MouseEvent<HTMLElement>, annot: AnnotationRecord): void;
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
  /**
   * Open Zotero's eight swatches from a card's palette control. On a card
   * inside the Card Selection the swatch recolours the whole selection; on
   * one outside it, the card is selected alone first.
   *
   * @returns the block its notice named, where a blocked capability kept the
   *   swatches shut; `null` otherwise.
   */
  onColorMenu(
    evt: MouseEvent<HTMLElement>,
    annot: AnnotationRecord,
  ): CardBlock | null;
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
   * Change the Card Selection from a click on this card: alone for a plain
   * click, toggled for Cmd/Ctrl-click, a range for Shift-click. A bound
   * Obsidian PDF view lands quietly on the Annotation Mark of a card the click
   * adds.
   *
   * @see apps/obsidian/docs/adr/0061-the-annotation-view-owns-its-card-selection.md
   */
  onSelectAnnotation(annot: AnnotationRecord, gesture: CardClick): void;
  /**
   * A click on the empty list: an open card editor closes, or, with none
   * open, the Card Selection clears.
   */
  onClearSelection(): void;
  /**
   * Start one card's editing of a text field: a comment edit, or a Text Edit
   * on the Quoted Text. A card not selected alone is first selected alone,
   * and an open editor is first saved and closed.
   *
   * @returns whether a draft stands, which is when the editor opens.
   */
  onOpenField(annot: AnnotationRecord, field: TextField): boolean;
  /** Take one change of a card's text field editor into the field's draft. */
  onEditField(annot: AnnotationRecord, field: TextField, text: string): void;
  /**
   * Store what a card's text field editor holds, from the gesture that
   * saved or closed it.
   *
   * @param save.automatic whether the editor asks by itself, as on blur or
   *   close, rather than on the user's explicit save.
   */
  onSaveField(
    annot: AnnotationRecord,
    field: TextField,
    save: { text: string; automatic?: boolean },
  ): void;
  /**
   * Drop one text field's held draft Zotero never took, from the card's
   * "Discard". Zotero's own value stands as it is, so the card behind the
   * panel already shows what the discard leaves.
   */
  onDiscardDraft(annot: AnnotationRecord, field: TextField): void;
  /**
   * Start or rejoin one card's tag editing session. A card not selected alone
   * is first selected alone, and an open comment editor is first saved and
   * closed.
   *
   * @returns whether a session stands, which it does only while editing is
   *   available or a draft is already held.
   */
  onOpenTags(annot: AnnotationRecord): boolean;
  onEditTags(annot: AnnotationRecord, names: readonly string[]): void;
  /**
   * Save the card's tag session as its editor closes, or on Save tags.
   *
   * @param options.automatic whether the editor closing asks, which holds a
   *   draft that needs Save tags rather than saving it.
   */
  onSaveTags(annot: AnnotationRecord, options?: { automatic?: boolean }): void;
  /** Drop a held tag draft and keep the tags Zotero holds. */
  onDiscardTags(annot: AnnotationRecord): void;
  /** The tag names of the Annotation's Library, which the editor suggests. */
  libraryTagNames(annot: AnnotationRecord): readonly string[];
  /**
   * Erase every Selected Card's Annotation, from Delete or Backspace on the
   * view: after a confirmation, which names the count for two or more.
   *
   * @returns the block its notice named, where a blocked capability stopped
   *   the delete; `null` otherwise.
   */
  onDeleteSelection(): CardBlock | null;
  /**
   * Recolour every Selected Card's Annotation, from the `1`–`8` keys on the
   * view, as a swatch of the palette does.
   *
   * @returns the block its notice named, where a blocked capability stopped
   *   the recolour; `null` otherwise.
   */
  onRecolorSelection(color: string): CardBlock | null;
  /**
   * Copy every Selected Card's text as `text/plain`, from Cmd/Ctrl+C on the
   * view.
   *
   * @returns whether there was text to copy.
   */
  onCopySelection(): boolean;
  /**
   * Send a conflicted write again, against the value Zotero holds now — the
   * card's "Apply again", and its "Delete anyway".
   *
   * @param field the text field whose draft stands in the conflict; left
   *   out, the write the Annotation's standing conflict names.
   */
  onApplyAgain(annot: AnnotationRecord, field?: TextField): void;
  /**
   * Leave Zotero's copy as it stands, from the conflicted card's "Discard".
   *
   * @param field the text field whose draft stands in the conflict; left
   *   out, the write the Annotation's standing conflict names.
   */
  onDiscardConflict(annot: AnnotationRecord, field?: TextField): void;
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
    | "deleteAnnotations"
    | "discardTextDraft"
    | "discardConflict"
    | "discardTagDraft"
    | "patchColor"
    | "patchColors"
    | "editTextField"
    | "editTags"
    | "retryTextDraft"
    | "retryWrite"
    | "submitTextField"
    | "submitTags"
  >;
  /** The clock a failure notice reads a cooldown's remaining seconds against. */
  now?: () => Temporal.Instant;
  /**
   * Whether each of the card's verbs runs, and the reason it does not. The
   * view supplies it: the capability and the Annotation's mutation state live
   * in its store, and the native menu is built outside React.
   */
  controls: (annot: AnnotationRecord) => CardControls;
  /** The Selected Cards, in list order. */
  selectedCards: () => readonly AnnotationRecord[];
  /**
   * The numeric id the Zotero database holds for an Annotation, or `null` for
   * one it does not hold yet — an Annotation created through the Zotero Local
   * API, which the card shows before SQLite knows it. The note templates read
   * the database, so they can render only what it holds.
   *
   * @see apps/obsidian/docs/adr/0033-zotero-object-identity-is-the-indexed-key-server-id-is-source-data.md
   */
  resolveAnnotationID: (indexedKey: string) => number | null;
  libraryTagNames: AnnotActions["libraryTagNames"];
  /**
   * What the view is showing right now. A native menu is built at the moment
   * the gesture opens it, so its entries are read then rather than subscribed
   * to — the same reason {@link AnnotActionDeps.controls} is a callback.
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
  onClearSelection: AnnotActions["onClearSelection"];
  /**
   * Select this card alone, as a click does, unless it already is: an edit
   * control's press does this before its editor opens, so an editor never
   * opens on a card in a group.
   */
  selectAlone: (annot: AnnotationRecord) => void;
  /**
   * Save and close the open card editors: an editor opens only once the other
   * has closed, as the Mark Popup opens one at a time.
   */
  closeEditors: () => void;
  onExploreAnnotation: (annotationKey: string) => void;
}

export function createAnnotActions(deps: AnnotActionDeps): AnnotActions {
  const now = deps.now ?? (() => Temporal.Now.instant());

  /**
   * The seam a write's outcome is rendered at: the repository answers data and
   * the notice is raised here, once, naming the reason. A failed write's
   * Pending Proposal goes with it, so a failure needs no undo — the card goes
   * back to what Zotero holds.
   *
   * @see apps/obsidian/policies/ui-seams.md
   */
  const report = (outcome: Promise<MutationState>): void => {
    void outcome.then((state) => {
      if (state.kind !== "failed") return;
      new BaseNotice(writeFailureMessage(state.failure, now()));
    });
  };

  /**
   * Recolour these cards: one alone, or a group as one History Step in which
   * each Annotation keeps its own outcome.
   */
  const setColors = (
    annots: readonly AnnotationRecord[],
    color: string,
  ): void =>
    void recolor(deps.annotations, {
      annotationKeys: annots.map(({ key }) => key),
      color,
      now,
    });
  /**
   * One verb over these cards, which one card's control decides alone: refused
   * while a write is in flight on any of them, and blocked for the same reason
   * one card is.
   */
  const controlOf = (
    verb: "color" | "delete",
    annots: readonly AnnotationRecord[],
  ): Pick<CardControl, "disabled" | "blocked"> =>
    groupControl(annots.map((annot) => deps.controls(annot)[verb]));
  /**
   * A press of one verb over these cards: `act` runs unless a write in flight
   * refuses the press, or a blocked capability spends it on the notice that
   * says why.
   *
   * @returns the block the notice named, or `null` where none was raised.
   */
  const press = (
    verb: "color" | "delete",
    annots: readonly AnnotationRecord[],
    act: () => void,
  ): CardBlock | null => {
    const control = controlOf(verb, annots);
    if (control.disabled) return null;
    if (control.blocked) {
      onBlockedPress(control.blocked);
      return control.blocked;
    }
    act();
    return null;
  };
  /** The swatches over these cards: checked only where every card has it. */
  const fillColorMenu = (
    menu: Menu,
    annots: readonly AnnotationRecord[],
  ): void =>
    buildColorMenu(menu, {
      colors: annots.map(({ color }) => color),
      onSelect: (hex) => setColors(annots, hex),
    });
  /**
   * The copy entry, for one card or a group. It is dimmed where no card has
   * text or a comment to copy.
   */
  const addCopyItem = (
    menu: Menu,
    annots: readonly AnnotationRecord[],
  ): void => {
    menu.addItem((item) => {
      item
        .setTitle(m.annot_view_menu_copy_text())
        .setIcon("copy")
        .setDisabled(copiedText(annots) === "")
        .onClick(() => copyText(annots));
    });
  };
  const onOpenField = (annot: AnnotationRecord, field: TextField): boolean => {
    deps.selectAlone(annot);
    deps.closeEditors();
    return deps.annotations.editTextField(field, annot.key) !== null;
  };
  const onEditField = (
    annot: AnnotationRecord,
    field: TextField,
    text: string,
  ): void => {
    deps.annotations.editTextField(field, annot.key, text);
  };
  const onSaveField = (
    annot: AnnotationRecord,
    field: TextField,
    { text, automatic = false }: { text: string; automatic?: boolean },
  ): void => {
    deps.annotations.editTextField(field, annot.key, text);
    report(deps.annotations.submitTextField(field, annot.key, { automatic }));
  };
  const onDiscardDraft = (annot: AnnotationRecord, field: TextField): void =>
    deps.annotations.discardTextDraft(field, annot.key);
  const onOpenTags = (annot: AnnotationRecord): boolean => {
    deps.selectAlone(annot);
    deps.closeEditors();
    return deps.annotations.editTags(annot.key) !== null;
  };
  const onEditTags = (
    annot: AnnotationRecord,
    names: readonly string[],
  ): void => {
    deps.annotations.editTags(annot.key, names);
  };
  const onSaveTags = (
    annot: AnnotationRecord,
    { automatic = false }: { automatic?: boolean } = {},
  ): void => report(deps.annotations.submitTags(annot.key, { automatic }));
  const onDiscardTags = (annot: AnnotationRecord): void =>
    deps.annotations.discardTagDraft(annot.key);
  /**
   * The delete over these cards, after the one confirmation that says what an
   * erase costs.
   *
   * @see apps/obsidian/policies/ui-seams.md
   */
  const deleteCards = (
    annots: readonly AnnotationRecord[],
  ): Promise<readonly string[]> =>
    confirmDelete(deps.app, deps.annotations, {
      annotationKeys: annots.map(({ key }) => key),
      now,
    });
  const onApplyAgain = (annot: AnnotationRecord, field?: TextField): void =>
    report(
      field
        ? deps.annotations.retryTextDraft(field, annot.key)
        : deps.annotations.retryWrite(annot.key),
    );
  const onDiscardConflict = (
    annot: AnnotationRecord,
    field?: TextField,
  ): void =>
    field
      ? deps.annotations.discardTextDraft(field, annot.key)
      : deps.annotations.discardConflict(annot.key);
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

  const onBlockedPress = (block: CardBlock): void =>
    blockedNotice(block, deps.onAllowEditing);

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

    // One card offers the copy only where it has text or a comment to copy.
    if (copiedText([annot]) !== "") addCopyItem(menu, [annot]);

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

    addDeleteItem(menu, [annot]);
  };

  /**
   * The menu for two or more Selected Cards: the verbs that act on every one
   * of them. The single-card entries — backlink, key, citation, insert,
   * explore — name one Annotation and are left out. The colour entry is
   * dimmed for the same reasons as the delete entry; copying never changes
   * Zotero, so it is always there.
   */
  const fillGroupMenu = (
    menu: Menu,
    annots: readonly AnnotationRecord[],
  ): void => {
    const color = controlOf("color", annots);
    menu.addItem((item) => {
      item
        .setTitle(m.annot_view_card_color())
        .setIcon("palette")
        .setDisabled(color.disabled || color.blocked !== null);
      fillColorMenu(item.setSubmenu(), annots);
    });
    addCopyItem(menu, annots);
    menu.addSeparator();
    addDeleteItem(menu, annots);
  };

  /**
   * The delete entry, for one card or a group. Every entry here is a verb. A
   * blocked write shows as a dimmed entry and says why once, in the header
   * menu's capability row and in the notice a card verb raises, rather than in
   * a label under each menu it blocks. A menu row is dimmed by either reason:
   * the notice is reached from a card verb, and a menu cannot raise one.
   */
  const addDeleteItem = (
    menu: Menu,
    annots: readonly AnnotationRecord[],
  ): void => {
    const control = controlOf("delete", annots);
    menu.addItem((item) => {
      item
        .setTitle(
          annots.length === 1
            ? m.annot_view_menu_delete()
            : m.annot_view_menu_delete_group({ count: annots.length }),
        )
        .setIcon("trash-2")
        .setWarning(true)
        .setDisabled(control.disabled || control.blocked !== null)
        .onClick(() => void deleteCards(annots));
    });
  };

  /**
   * The cards a verb pressed on this card acts on: the Card Selection where
   * the card is one of several Selected Cards, and else the card alone. A card
   * outside the Card Selection is selected alone first, so the verb acts on
   * the card the user pressed.
   */
  const cardsFor = (annot: AnnotationRecord): readonly AnnotationRecord[] => {
    const selected = deps.selectedCards();
    if (selected.length > 1 && selected.some(({ key }) => key === annot.key))
      return selected;
    deps.selectAlone(annot);
    return [annot];
  };

  /** The menu a card opens: the group's, or its own. */
  const fillMenuFor = (menu: Menu, annot: AnnotationRecord): void => {
    const annots = cardsFor(annot);
    if (annots.length > 1) fillGroupMenu(menu, annots);
    else fillCardMenu(menu, annot);
  };

  return {
    getBacklink,
    openExcerptImage: () => deps.excerptDisplay.open(),
    excerptImageRequest: deps.excerptImageRequest,
    onOpenTags,
    onEditTags,
    onSaveTags,
    onDiscardTags,
    libraryTagNames: deps.libraryTagNames,
    onOpenField,
    onEditField,
    onSaveField,
    onDiscardDraft,
    onApplyAgain,
    onDiscardConflict,
    onDeleteSelection() {
      const annots = deps.selectedCards();
      if (annots.length === 0) return null;
      return press("delete", annots, () => void deleteCards(annots));
    },
    onRecolorSelection(color) {
      const annots = deps.selectedCards();
      if (annots.length === 0) return null;
      return press("color", annots, () => setColors(annots, color));
    },
    onCopySelection: () => copyText(deps.selectedCards()),
    onMoreOptions(evt, annot) {
      showMenu(evt, (menu) => fillMenuFor(menu, annot), "end");
    },
    onCardMenu(evt, annot) {
      const menu = new Menu();
      fillMenuFor(menu, annot);
      menu.showAtMouseEvent(evt.nativeEvent);
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
    onBlockedPress,
    onColorMenu(evt, annot) {
      const annots = cardsFor(annot);
      return press("color", annots, () =>
        showMenu(evt, (menu) => fillColorMenu(menu, annots)),
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
    onClearSelection: deps.onClearSelection,
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
  onCardMenu: () => {},
  onHeaderMenu: () => {},
  onChooseAttachment: () => {},
  onAllowEditing: () => {},
  onBlockedPress: () => {},
  onColorMenu: () => null,
  onDragStart: () => {},
  onSetFollowMode: () => {},
  onPinCurrentItem: () => {},
  onPinItem: () => {},
  onUnpin: () => {},
  onEnableLiveUpdates: () => {},
  onSelectAnnotation: () => {},
  onClearSelection: () => {},
  onDiscardDraft: () => {},
  onOpenField: () => false,
  onEditField: () => {},
  onSaveField: () => {},
  onOpenTags: () => false,
  onEditTags: () => {},
  onSaveTags: () => {},
  onDiscardTags: () => {},
  libraryTagNames: () => [],
  onDeleteSelection: () => null,
  onRecolorSelection: () => null,
  onCopySelection: () => false,
  onApplyAgain: () => {},
  onDiscardConflict: () => {},
  onRefresh: () => {},
  openExcerptImage: () => NOOP_DEMAND,
  excerptImageRequest: () => null,
  getBacklink: () => undefined,
  renderComment: () => () => {},
};

export const AnnotActionsContext = createContext<AnnotActions>(NOOP_ACTIONS);
