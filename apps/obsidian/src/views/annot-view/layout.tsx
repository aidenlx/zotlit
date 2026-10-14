// The Annotations Layout: the Annotation Cards, their store, the card actions,
// the Card Selection and the card keys, as one part any host can mount. The
// sidebar Annotation View is one host; a Query View is another.
//
// @see apps/obsidian/docs/adr/0069-the-annotation-view-is-the-annotations-layout-of-the-query-view.md
import { Component, Platform } from "obsidian";
import type { App, Scope } from "obsidian";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { ANNOTATION_COLORS } from "@/lib/annotation-colors";
import { AppContext } from "@/lib/app-context";
import { registerKeymap } from "@/lib/disposables";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { historyOutcomeNotice } from "@/services/annotation-repository/actions";
import type {
  AnnotationList,
  AnnotationRecord,
  AnnotationRepository,
  AnnotationSource,
  HistoryDirection,
} from "@/services/annotation-repository/service";
import {
  byTextField,
  IDLE,
  writeFailureMessage,
} from "@/services/annotation-repository/write";
import type { ExcerptDisplayService } from "@/services/excerpt-image/display";
import { savedExcerptRequest } from "@/services/excerpt-image/request";
import type { ExcerptRequest } from "@/services/excerpt-image/service";
import type { NoteFeature } from "@/services/note-feature";
import { inTextEntry } from "@/services/pdf-annotation-editor/capability-affordance";
import type { ReaderSession } from "@/services/reader-session/session";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

import { AnnotActionsContext, createAnnotActions } from "./actions";
import type { AnnotActionDeps, AnnotActions } from "./actions";
import { blocksNow } from "./Annotation";
import { AnnotList } from "./AnnotView";
import { cardControls } from "./card-controls";
import type { CardControls } from "./card-controls";
import {
  NO_SELECTION,
  nextCardSelection,
  placedKey,
  sameKeys,
} from "./card-selection";
import type {
  CardClick,
  CardPlace,
  CardSelection,
  SelectionChange,
} from "./card-selection";
import { createCommentRenderer } from "./comment-render";
import { createDragInsertHandler, createInsertHandler } from "./drag-insert";
import { CARD_SELECTOR, mountCardHistoryKeys } from "./history";
import {
  AnnotStoreProvider,
  capabilityOf,
  createAnnotStore,
  editorOpen,
  noFieldDrafts,
  selectedAlone,
  toggledTags,
  visibleOrder,
} from "./store";
import type {
  AnnotState,
  AnnotStore,
  CardGroup,
  CardPlacement,
  HeldSource,
} from "./store";

const logger = getLogger(["views", "annot-view"]);

/** The composite widgets in the layout and its host that answer their own keys. */
const COMPOSITE_WIDGET =
  '[role="listbox"], [role="combobox"], [role="menu"], [role="menuitem"]';

/**
 * Whether a key belongs to the control it landed on rather than to the Card
 * Selection: a text field, or a composite widget such as the filter bar's
 * list boxes.
 */
function controlOwnsKey(target: EventTarget | null): boolean {
  if (inTextEntry(target)) return true;
  const node = target as Node | null;
  return (
    node?.instanceOf(HTMLElement) === true &&
    node.closest(COMPOSITE_WIDGET) !== null
  );
}

/**
 * The services the layout reads and writes through. Every member is a
 * structural `Pick` sized to what the layout touches, so the real services
 * satisfy it as they are and a test can hand it plain stubs.
 */
export interface AnnotationsLayoutDeps {
  app: App;
  /** The database the Excerpt Image requests resolve through. */
  reads: Pick<ZoteroReadsService, "acquireRead">;
  /**
   * The one read and write path for each Attachment's Annotations, so the
   * cards and the reader overlay show one Annotation Source's records rather
   * than two, and an edit stamps its precondition off the record they show.
   */
  annotations: Pick<
    AnnotationRepository,
    | "annotationState"
    | "capability"
    | "capabilityFor"
    | "textDraftFor"
    | "deleteAnnotation"
    | "deleteAnnotations"
    | "discardTextDraft"
    | "discardTagDraft"
    | "discardConflict"
    | "on"
    | "patchColor"
    | "patchColors"
    | "editTextField"
    | "editTags"
    | "hold"
    | "peek"
    | "read"
    | "redo"
    | "refresh"
    | "retryWrite"
    | "retryTextDraft"
    | "submitTextField"
    | "submitTags"
    | "tagDraftFor"
    | "undo"
  >;
  /** Allow editing, from every entry the cards offer, which the UI seam owns. */
  allowEditing: () => void;
  /**
   * An edit gesture met a block on this Attachment, which the one notice
   * ledger answers — the same seam the reader's blocked keystrokes reach.
   *
   * @param attachmentKey the Attachment's Indexed Key.
   */
  reportBlockedGesture: (attachmentKey: string) => void;
  /** The tag names of an Annotation's Library, which the tag editor suggests. */
  libraryTagNames: (annotationKey: string) => Promise<readonly string[]>;
  zoteroPref: Pick<ZoteroPrefService, "dataDir" | "baseAttachmentPath">;
  /** The plugin's live display surface for Excerpt Images. */
  excerptDisplay: Pick<ExcerptDisplayService, "open" | "refresh">;
  noteFeature: Pick<
    NoteFeature,
    "renderAnnotationCitation" | "prepareAnnotationInsert"
  >;
}

/**
 * The gestures a card or the header menu raises that only the host can
 * answer: the sidebar's Follow Mode, its pin, its attachment picker, and the
 * Template Data Explorer, which needs the Item the host shows.
 */
export type HostGestures = Pick<
  AnnotActionDeps,
  | "setSelectedAttachmentKey"
  | "onSetFollowMode"
  | "onPinCurrentItem"
  | "onPinItem"
  | "onUnpin"
  | "onEnableLiveUpdates"
  | "onOpenPdf"
  | "onExploreAnnotation"
>;

const NO_HOST_GESTURES: HostGestures = {
  setSelectedAttachmentKey: () => {},
  onSetFollowMode: () => {},
  onPinCurrentItem: () => {},
  onPinItem: () => {},
  onUnpin: () => {},
  onEnableLiveUpdates: () => {},
  onOpenPdf: () => {},
  onExploreAnnotation: () => {},
};

/** What the host gives the layout, beside the services. */
export interface AnnotationsLayoutHost {
  /**
   * The Scope the card keys go on. Obsidian consults it while the host has
   * the keyboard: the sidebar gives its leaf's own Scope.
   */
  scope: Scope;
  /** The note that the links in a comment resolve against; `""` for the vault root. */
  sourcePath: () => string;
  gestures?: Partial<HostGestures>;
  /**
   * Whether a key that landed outside the cards' grid still lands on the card
   * list, as one on the host's own frame does while no control has focus.
   */
  onList?: (node: HTMLElement) => boolean;
  /**
   * An Escape that found no card editor to close and no Card Selection to
   * clear. Return `false` to stop the key there.
   */
  onEscape?: (event: KeyboardEvent) => false | undefined;
  /**
   * Whether a record that came into a shown list after the rows landed shows
   * as well, in list order, until the rows run again: a new Annotation then
   * shows as its write starts, as it did in the sidebar before it ran a
   * query. Grouped rows wait for the next run.
   */
  showNewRecords?: boolean;
  /**
   * A list the rows hold gained or lost an Annotation since the rows landed,
   * so the query can run again and give the rows that list holds now.
   */
  onListChanged?: () => void;
}

/** One Attachment's list as the layout last took it, or `null` where its read failed. */
type Landed = { list: AnnotationList; scope: string | null } | null;

/** The keys of the Annotations the repository holds for an Attachment now. */
function annotationKeys(
  annotations: Pick<AnnotationRepository, "peek">,
  attachmentKey: string,
): ReadonlySet<string> | null {
  const held = annotations.peek(attachmentKey);
  return held ? new Set(held.value.annotations.map(({ key }) => key)) : null;
}

/**
 * What started a run of the query whose rows the layout shows: a list
 * change, another run of the request on screen, or a new request.
 */
export type RunCause = "list-change" | "rerun" | "new-request";

/** One record of the held lists, by its Attachment's key and its own Indexed Key. */
function recordId(attachmentKey: string, annotationKey: string): string {
  return `${attachmentKey}\n${annotationKey}`;
}

/** One row of a query a Query View shows: an Annotation and the Attachment that holds it. */
export interface LayoutRow {
  annotationKey: string;
  attachmentKey: string;
  /** The group the row stands in; a row with none stands under no heading. */
  group?: CardGroup;
}

export class AnnotationsLayout extends Component {
  /** What the cards show, which the host's own chrome may read and extend. */
  readonly store: AnnotStore = createAnnotStore();
  readonly #deps: AnnotationsLayoutDeps;
  readonly #host: AnnotationsLayoutHost;
  #actions: AnnotActions | null = null;
  #root: Root | null = null;
  #el: HTMLElement | null = null;
  #subscriptions: DisposableStack | null = null;
  /** The Attachments shown, in the order the host gave. */
  #shown: readonly string[] = [];
  /** The rows of a query the cards show. */
  #rows: readonly LayoutRow[] = [];
  /** The lists the cards on screen come from, held while they show. */
  #hold: Disposable | null = null;
  /** The Annotations of each Attachment shown, as the rows last found them. */
  readonly #listKeys = new Map<string, ReadonlySet<string>>();
  /**
   * The Annotations a list change added that no run's rows have named yet,
   * each with its Attachment's Indexed Key.
   */
  readonly #listAdded = new Map<string, string>();
  /**
   * The records the shown lists held when the rows first stood on screen, by
   * Attachment and key; `null` until they do. A record outside it is new.
   */
  #known: ReadonlySet<string> | null = null;
  /** The list each shown Attachment's last read left. */
  readonly #landed = new Map<string, Landed>();
  /** The last read started for each Attachment; a slower one never lands after it. */
  readonly #latest = new Map<string, number>();
  #nextRead = 0;
  #reading: Promise<void> = Promise.resolve();
  #closed = false;
  /** The reader the Card Selection is kept in step with, while the host binds one. */
  #boundReader: ReaderSession | null = null;
  /**
   * Whether the bound reader's selection waits to replace the Card Selection:
   * an open card editor holds it back, or it names a key the list has not
   * loaded. The selection itself is read from the reader when it applies.
   */
  #readerPending = false;
  /**
   * The keys the layout is sending to the bound Obsidian PDF view, while the
   * send runs. The reader reports them straight back, and that echo is the
   * layout's own change: it leaves the anchor and the focus where they are.
   */
  #pushing: readonly string[] | null = null;

  constructor(deps: AnnotationsLayoutDeps, host: AnnotationsLayoutHost) {
    super();
    this.#deps = deps;
    this.#host = host;
  }

  /** Settles once the cards show the last read the layout started. Never rejects. */
  get read(): Promise<void> {
    return this.#reading;
  }

  /**
   * The gestures the cards raise. `null` before the layout loads and after it
   * unloads.
   */
  get actions(): AnnotActions | null {
    return this.#actions;
  }

  /** The Attachments the cards show, in the order the host gave. */
  get attachments(): readonly string[] {
    return this.#shown;
  }

  override onload(): void {
    this.#closed = false;
    const deps = this.#deps;
    const subscriptions = new DisposableStack();
    this.#subscriptions = subscriptions;
    const gestures = { ...NO_HOST_GESTURES, ...this.#host.gestures };

    const insertDeps: Parameters<typeof createInsertHandler>[0] = {
      app: deps.app,
      noteFeature: deps.noteFeature,
      notify: (message) => void new BaseNotice(message),
      snapshot: (annotation) => {
        const state = this.store.getState();
        const held = state.sources.get(annotation.parentKey);
        return {
          source: state.annotations?.includes(annotation)
            ? (held?.source ?? null)
            : null,
          sourceScope: held?.scope ?? null,
        };
      },
    };
    const insert = createInsertHandler(insertDeps);
    const drag = createDragInsertHandler(insertDeps);
    subscriptions.defer(insert.cancel);
    subscriptions.defer(drag.cancel);

    this.#actions = createAnnotActions({
      app: deps.app,
      excerptDisplay: deps.excerptDisplay,
      excerptImageRequest: (target) => this.#excerptRequest(target),
      annotations: deps.annotations,
      controls: (annot) => this.#cardControls(annot),
      selectedCards: () => this.#selectedCards(),
      libraryTagNames: (annot) => deps.libraryTagNames(annot.key),
      getState: () => this.store.getState(),
      toggleSelectedTag: (tag) =>
        this.store.setState({
          selectedTags: toggledTags(this.store.getState().selectedTags, tag),
        }),
      refresh: () => this.refresh(),
      noteFeature: deps.noteFeature,
      onAllowEditing: () => deps.allowEditing(),
      onSelectAnnotation: (annot, gesture, place) =>
        this.#clickFromView({ kind: gesture, key: annot.key, place }),
      onClearSelection: () => void this.#clearFromView(),
      selectAlone: (annot) => this.#selectAloneFromView(annot.key),
      closeEditors: () => void this.#closeEditors(),
      openEditor: (annot, field) =>
        this.store.setState({ editing: { annotationKey: annot.key, field } }),
      onDragStart: drag,
      offerAnnotationInsert: () => {
        const offered = insert.offer();
        if (!offered) return null;
        return (annotation) => {
          // A read can replace the card's record while its menu is open.
          const current = this.store
            .getState()
            .annotations?.find(({ key }) => key === annotation.key);
          void offered(current ?? annotation);
        };
      },
      renderComment: createCommentRenderer({
        app: deps.app,
        component: this,
        getSourcePath: () => this.#host.sourcePath(),
      }),
      ...gestures,
    });

    this.#mountKeys(subscriptions);
    this.#subscribe(subscriptions);
  }

  override onunload(): void {
    this.#closed = true;
    this.#latest.clear();
    this.#submitOpenEditor();
    this.#subscriptions?.dispose();
    this.#subscriptions = null;
    this.#hold?.[Symbol.dispose]();
    this.#hold = null;
    // An open tag editor ends its session, and saves it, as it unmounts.
    this.#root?.unmount();
    this.#root = null;
    this.#el = null;
    this.#actions = null;
  }

  /**
   * Draw the cards into `el`, or the host's own tree around them: a host that
   * draws more than the cards puts {@link AnnotList} inside its `content`.
   * Call it once the layout has loaded.
   */
  render(el: HTMLElement, content: ReactNode = <AnnotList collapsed />): void {
    const actions = this.#actions;
    if (!actions) throw new Error("The Annotations Layout renders once loaded");
    this.#root?.unmount();
    this.#el = el;
    this.#root = createRoot(el);
    this.#root.render(
      <AppContext value={this.#deps.app}>
        <AnnotStoreProvider value={this.store}>
          <AnnotActionsContext value={actions}>{content}</AnnotActionsContext>
        </AnnotStoreProvider>
      </AppContext>,
    );
  }

  // #region the list

  /**
   * Show the rows of a query, in the query's order, from the live lists of
   * the Attachments that hold them: a card shows its record as the repository
   * holds it now, and stays while the rows stand, whatever a write changed on
   * it. A row no list holds is named in `unresolved`. What is on screen stays
   * until every list has landed, and the layout holds the new lists before
   * it lets the old ones go. Another set of Attachments clears the Card
   * Selection; the bound reader's own selection applies over the clear.
   *
   * @param also Attachments whose lists the layout reads beside those the
   *   rows name, so a record new to one of them can show (`showNewRecords`).
   * @returns what settles once the reads this started have landed: `true`
   *   where each of them put its list on screen, `false` where a later read,
   *   a cancelled one or a failure left another there.
   */
  showRows(
    rows: readonly LayoutRow[],
    also: readonly string[] = [],
  ): Promise<boolean> {
    this.#rows = rows;
    this.#known = null;
    this.#listKeys.clear();
    const groups: CardPlacement[] = rows.flatMap((row) =>
      row.group ? [{ annotationKey: row.annotationKey, group: row.group }] : [],
    );
    this.store.setState({ groups: groups.length > 0 ? groups : null });
    const attachmentKeys = [
      ...new Set([...rows.map((row) => row.attachmentKey), ...also]),
    ];
    const previous = this.#hold;
    this.#hold = this.#deps.annotations.hold(attachmentKeys);
    if (!sameKeys(attachmentKeys, this.#shown)) {
      this.#shown = [...attachmentKeys];
      for (const key of this.#landed.keys())
        if (!attachmentKeys.includes(key)) this.#landed.delete(key);
      this.#syncCapabilities();
      this.store.setState({ cardSelection: NO_SELECTION });
      this.#takeReaderSelection();
    }
    const landing = Promise.all(
      attachmentKeys.map((key) => this.#readAttachment(key)),
    ).then((landed) => landed.every(Boolean));
    this.#reading = landing.then(() => {});
    // The lists that already stand show the new rows at once.
    this.#publish();
    void landing.then(() => {
      previous?.[Symbol.dispose]();
      if (this.#rows !== rows) return;
      for (const attachmentKey of attachmentKeys) {
        const keys = annotationKeys(this.#deps.annotations, attachmentKey);
        if (keys) this.#listKeys.set(attachmentKey, keys);
      }
    });
    return landing;
  }

  /**
   * Whether the rows of a run stay off screen. The query reads Zotero's
   * database, which can take a new Annotation after the repository's list
   * does: the run a list change asked for keeps the cards on screen while its
   * rows lack an Annotation that change added and the repository still
   * holds, and the database change that follows runs the query again. The
   * rows of any other run show. A new request, such as a filter edit, ends
   * the wait: an Annotation its rows leave out is not waited for. A rerun of
   * the request on screen keeps it. An added Annotation that a run's rows
   * name, or that the repository no longer holds, is no longer waited for.
   *
   * @param rowKeys the Annotations the run's rows name.
   * @param cause what started the run: the list change that
   *   {@link AnnotationsLayoutHost.onListChanged} reported, another run of
   *   the request on screen, or a new request.
   */
  keepsBack(rowKeys: Iterable<string>, cause: RunCause): boolean {
    if (cause === "new-request") {
      this.#listAdded.clear();
      return false;
    }
    const named = new Set(rowKeys);
    for (const [key, attachmentKey] of this.#listAdded) {
      if (
        named.has(key) ||
        !annotationKeys(this.#deps.annotations, attachmentKey)?.has(key)
      )
        this.#listAdded.delete(key);
    }
    return cause === "list-change" && this.#listAdded.size > 0;
  }

  /** Show no Attachment, and drop every list, draft and editor with them. */
  clear(): void {
    this.cancelReads();
    this.#shown = [];
    this.#rows = [];
    this.#listKeys.clear();
    this.#landed.clear();
    this.#syncCapabilities();
    this.store.setState({
      groups: null,
      unresolved: [],
      annotations: null,
      sources: new Map(),
      fieldDrafts: noFieldDrafts(),
      tagDrafts: new Map(),
      editing: null,
      cardSelection: NO_SELECTION,
    });
    this.#takeReaderSelection();
    this.#hold?.[Symbol.dispose]();
    this.#hold = null;
  }

  /** Drop the answers of the reads still running: a later `showRows` replaces them. */
  cancelReads(): void {
    this.#latest.clear();
  }

  /**
   * Revalidate every Attachment shown, and redraw the Excerpt Images once the
   * lists stand, for "Refresh data".
   */
  async refresh(): Promise<void> {
    const shown = this.#shown;
    if (shown.length === 0) return;
    await Promise.all(shown.map((key) => this.#deps.annotations.refresh(key)));
    await this.#reading;
    if (sameKeys(this.#shown, shown)) this.#deps.excerptDisplay.refresh();
  }

  /** Revalidate every Attachment shown, without waiting for the answer. */
  revalidate(): void {
    for (const key of this.#shown) void this.#deps.annotations.refresh(key);
  }

  /**
   * Reads one Attachment's Annotations through the repository, so its cards
   * come from whichever Annotation Source is active for it and say which —
   * the same source, and the same records, the overlay draws from.
   *
   * @see apps/obsidian/docs/adr/0034-the-annotation-source-is-atomic-per-attachment.md
   */
  #readAttachment(attachmentKey: string): Promise<boolean> {
    const read = ++this.#nextRead;
    this.#latest.set(attachmentKey, read);
    const scope = this.#deps.zoteroPref.dataDir;
    const current = () =>
      this.#latest.get(attachmentKey) === read &&
      this.#shown.includes(attachmentKey);
    return this.#deps.annotations
      .read(attachmentKey)
      .then((list) => {
        // A slower read never overwrites a later one. A null answer is a read
        // an invalidation cancelled; the same invalidation announces the
        // change the layout re-reads on, so the list is not left waiting.
        if (!current() || scope !== this.#deps.zoteroPref.dataDir) return false;
        if (list === null) {
          // The rows of a query wait for no list: an Attachment no read has
          // answered for yet names its rows unresolved until one does.
          if (!this.#landed.has(attachmentKey)) {
            this.#landed.set(attachmentKey, null);
            this.#publish();
          }
          return false;
        }
        this.#landed.set(attachmentKey, { list, scope });
        this.#publish();
        return true;
      })
      .catch((error: unknown) => {
        if (!current()) return false;
        logger.warn("Failed to read the annotations of an attachment", {
          attachmentKey,
          error,
        });
        this.#landed.set(attachmentKey, null);
        this.#publish();
        return false;
      });
  }

  /** The cards of every shown Attachment, once each list has landed. */
  #composed(): Pick<
    AnnotState,
    "annotations" | "sources" | "unresolved"
  > | null {
    const landed = this.#shown.map((key) => this.#landed.get(key));
    if (landed.includes(undefined)) return null;
    const sources = new Map<string, HeldSource>();
    for (const [index, key] of this.#shown.entries()) {
      const held = landed[index];
      if (held)
        sources.set(key, { source: held.list.source, scope: held.scope });
    }
    const records = new Map(
      landed.flatMap(
        (held) =>
          held?.list.annotations.map(
            (record) =>
              [recordId(record.parentKey, record.key), record] as const,
          ) ?? [],
      ),
    );
    const annotations: AnnotationRecord[] = [];
    const unresolved: string[] = [];
    // A row stands once for each group it is in; its card is one record.
    const seen = new Set<string>();
    for (const row of this.#rows) {
      const id = recordId(row.attachmentKey, row.annotationKey);
      if (seen.has(id)) continue;
      seen.add(id);
      const record = records.get(id);
      if (record) annotations.push(record);
      else unresolved.push(row.annotationKey);
    }
    this.#known ??= new Set(records.keys());
    if (this.#host.showNewRecords && this.store.getState().groups === null)
      this.#placeNewRecords(annotations, landed, this.#known);
    return { annotations, sources, unresolved };
  }

  /**
   * Put each record the lists gained since the rows landed after the record
   * before it in its own list, so a new Annotation stands where the next run
   * of the query will put it in reading order.
   */
  #placeNewRecords(
    annotations: AnnotationRecord[],
    landed: readonly (Landed | undefined)[],
    known: ReadonlySet<string>,
  ): void {
    for (const held of landed) {
      if (!held) continue;
      let at = -1;
      for (const record of held.list.annotations) {
        const id = recordId(record.parentKey, record.key);
        const shown = annotations.indexOf(record);
        if (shown !== -1) {
          at = shown;
          continue;
        }
        if (known.has(id)) continue;
        if (at === -1) {
          // Before the first card of its Attachment, or after every card.
          const first = annotations.findIndex(
            ({ parentKey }) => parentKey === record.parentKey,
          );
          at = (first === -1 ? annotations.length : first) - 1;
        }
        annotations.splice(at + 1, 0, record);
        at += 1;
      }
    }
  }

  /** Puts the composed lists on screen, with the drafts their records hold. */
  #publish(): void {
    const composed = this.#composed();
    if (!composed?.annotations) return;
    const { annotations } = composed;
    const repository = this.#deps.annotations;
    const fieldDrafts = byTextField(
      (field) =>
        new Map(
          annotations.flatMap((annotation) => {
            const draft = repository.textDraftFor(field, annotation.key);
            return draft ? [[annotation.key, draft] as const] : [];
          }),
        ),
    );
    const tagDrafts = new Map(
      annotations.flatMap((annotation) => {
        const draft = repository.tagDraftFor(annotation.key);
        return draft ? [[annotation.key, draft] as const] : [];
      }),
    );
    this.store.setState({ ...composed, fieldDrafts, tagDrafts });
  }

  /**
   * The lists with the one the repository holds for this Attachment now, for
   * an update that cannot wait for the layout's own re-read: a write's
   * Pending Proposal as it starts, and the drop of a tag draft, which the
   * repository makes only once the read-back stands in that list, so the
   * draft and the chips change in one update.
   */
  #heldList(
    attachmentKey: string,
  ): Pick<AnnotState, "annotations" | "sources"> | null {
    if (!this.#shown.includes(attachmentKey)) return null;
    const held = this.#deps.annotations.peek(attachmentKey);
    if (!held) return null;
    const scope =
      this.#landed.get(attachmentKey)?.scope ?? this.#deps.zoteroPref.dataDir;
    this.#landed.set(attachmentKey, { list: held.value, scope });
    return this.#composed();
  }

  /** Tell the host once a list the rows hold gains or loses an Annotation. */
  #listChanged(attachmentKey: string): void {
    const before = this.#listKeys.get(attachmentKey);
    if (!before) return;
    const now = annotationKeys(this.#deps.annotations, attachmentKey);
    if (
      now === null ||
      (now.size === before.size && [...now].every((key) => before.has(key)))
    )
      return;
    this.#listKeys.set(attachmentKey, now);
    for (const key of now) {
      if (!before.has(key)) this.#listAdded.set(key, attachmentKey);
    }
    this.#host.onListChanged?.();
  }

  /**
   * The Editing Capability of each Attachment shown: it moves with the probe
   * as well as with the Attachments.
   */
  #syncCapabilities(): void {
    this.store.setState({
      capabilities: new Map(
        this.#shown.map((key) => [
          key,
          this.#deps.annotations.capabilityFor(key),
        ]),
      ),
    });
  }

  // #endregion

  #subscribe(subscriptions: DisposableStack): void {
    const { annotations } = this.#deps;
    subscriptions.defer(
      annotations.on("capability-changed", () => this.#syncCapabilities()),
    );
    // The repository's own event is the only word that a list was superseded;
    // a held read says nothing about an invalidation of its own.
    subscriptions.defer(
      annotations.on("annotations-changed", (attachmentKey) => {
        if (!this.#shown.includes(attachmentKey)) return;
        // What the repository holds now, a write's Pending Proposal among
        // it, stands in the same task; the read that follows replaces it.
        const held = this.#heldList(attachmentKey);
        if (held) this.store.setState(held);
        this.#reading = this.#readAttachment(attachmentKey).then(() => {});
        // An Annotation added to or removed from a list the rows hold runs
        // the query again, so it takes its place.
        this.#listChanged(attachmentKey);
      }),
    );
    // One snapshot per Annotation: what a write left on it, its drafts, and
    // whether a complete read found it gone, which ends its editors.
    subscriptions.defer(
      annotations.on("annotation-changed", (annotationKey) => {
        const state = this.store.getState();
        const now = annotations.annotationState(annotationKey);
        const mutations = new Map(state.mutations);
        mutations.set(annotationKey, now.mutation);
        const fieldDrafts = byTextField((field) => {
          const drafts = new Map(state.fieldDrafts[field]);
          const draft = now.textDrafts[field];
          if (draft) drafts.set(annotationKey, draft);
          else drafts.delete(annotationKey);
          return drafts;
        });
        const tagDrafts = new Map(state.tagDrafts);
        const ended = now.tagDraft ? undefined : tagDrafts.get(annotationKey);
        if (now.tagDraft) tagDrafts.set(annotationKey, now.tagDraft);
        else tagDrafts.delete(annotationKey);
        this.store.setState({
          mutations,
          fieldDrafts,
          tagDrafts,
          ...(ended && this.#heldList(ended.attachmentKey)),
          ...(now.gone &&
            state.editing?.annotationKey === annotationKey && {
              editing: null,
            }),
        });
      }),
    );
    // A filter, a search, or a list that lost an Annotation drops the cards it
    // no longer shows. It only prunes: a reader selection is never applied
    // again for a card the list shows once more.
    subscriptions.defer(
      this.store.subscribe(
        (s) => visibleOrder(s),
        () => {
          // A list that is loading shows nothing yet, and hides nothing.
          if (this.store.getState().annotations === null) return;
          const { selection, changed } = this.#setSelection({ kind: "prune" });
          // The bound Obsidian PDF view drops the marks the list now hides,
          // so its keys never act on a card the list does not show. A reader
          // selection still waiting is the reader's own, and stays. A second
          // view bound to the same PDF takes the pruned selection through
          // that reader, as two such views share one selection.
          const session = this.#boundPdfSession();
          const push =
            changed &&
            !this.#readerPending &&
            session !== null &&
            !sameKeys(session.selected, selection.selected);
          if (changed)
            logger.debug("A prune dropped hidden cards from the selection", {
              selected: selection.selected.length,
              pushed: push,
              readerPending: this.#readerPending,
              bound: session !== null,
            });
          if (push && session) this.#pushToPdf(session, selection.selected);
        },
        { equalityFn: sameKeys },
      ),
    );
    // A waiting reader selection applies once the list loads a key it names.
    subscriptions.defer(
      this.store.subscribe(
        (s) => s.annotations,
        (next, previous) => {
          if (!this.#readerPending) return;
          const before = new Set(previous?.map(({ key }) => key));
          const loaded = next?.some(
            ({ key }) =>
              !before.has(key) && this.#boundReader?.selected.includes(key),
          );
          if (loaded) this.#takeReaderSelection();
        },
      ),
    );
    // A reader selection an open editor held back applies once it closes.
    subscriptions.defer(
      this.store.subscribe(
        (s) => editorOpen(s),
        (open) => {
          if (!open && this.#readerPending) this.#takeReaderSelection();
        },
      ),
    );
  }

  /** The card keys, on the Scope the host gave. */
  #mountKeys(subscriptions: DisposableStack): void {
    const { scope } = this.#host;
    const add = (registration: Disposable) => subscriptions.use(registration);

    // Escape closes an open card editor, then clears the Card Selection. One
    // typed into a field goes on to the field. With nothing to close or
    // clear, the host decides where the key goes.
    add(
      registerKeymap(scope, [], "Escape", (event) => {
        if (inTextEntry(event.target)) return;
        if (this.#clearFromView()) return false;
        return this.#host.onEscape?.(event);
      }),
    );

    // ↑ and ↓ move the Card Selection to one card in list order, which reads
    // across the grid's columns row by row. A key on any other control goes on
    // to it, and so does one that moves nothing, so the list still scrolls at
    // either end; ← and → are left to Obsidian.
    for (const [key, step] of [
      ["ArrowUp", -1],
      ["ArrowDown", 1],
    ] as const) {
      add(
        registerKeymap(scope, [], key, (event) => {
          if (!this.#onCardList(event.target)) return;
          if (this.#moveFromView(step)) return false;
        }),
      );
      // Shift extends the selection from the anchor instead.
      add(
        registerKeymap(scope, ["Shift"], key, (event) => {
          if (!this.#onCardList(event.target)) return;
          if (this.#extendFromView(step)) return false;
        }),
      );
    }

    // Cmd/Ctrl+A selects every card the list shows, from anywhere in the
    // host. One typed into a field goes on to the field, which selects its own
    // text, and one on a list box or a menu goes on to that widget.
    add(
      registerKeymap(scope, ["Mod"], "A", (event) => {
        if (controlOwnsKey(event.target)) return;
        this.#changeFromView({ kind: "all" });
        return false;
      }),
    );

    // Delete and Backspace erase every Selected Card. The Mac keyboards that
    // print "delete" on the backspace key send `Backspace`. One on any other
    // control goes on to it, so a field still deletes its own text.
    for (const key of ["Delete", "Backspace"]) {
      add(
        registerKeymap(scope, [], key, (event) => {
          if (!this.#onCardList(event.target)) return;
          if (this.store.getState().cardSelection.selected.length === 0) return;
          this.#actions?.onDeleteSelection();
          return false;
        }),
      );
    }

    // `1`–`8` recolour every Selected Card, in the palette's own order, as the
    // same keys do in the PDF. One on a field, a list box or a menu goes on to
    // that control.
    for (const [index, color] of ANNOTATION_COLORS.entries()) {
      add(
        registerKeymap(scope, [], String(index + 1), (event) => {
          if (controlOwnsKey(event.target)) return;
          if (this.store.getState().cardSelection.selected.length === 0) return;
          this.#actions?.onRecolorSelection(color);
          return false;
        }),
      );
    }

    // Cmd/Ctrl+C copies the text of every Selected Card, from anywhere in the
    // host. One typed into a field, on a list box or a menu, or over text the
    // user selected in the cards, goes on to that control or the platform's
    // own copy.
    add(
      registerKeymap(scope, ["Mod"], "C", (event) => {
        if (controlOwnsKey(event.target)) return;
        const el = this.#el;
        const selection = el?.win.getSelection();
        if (
          selection &&
          !selection.isCollapsed &&
          el?.contains(selection.anchorNode)
        )
          return;
        if (this.#actions?.onCopySelection()) return false;
      }),
    );

    // The platform's undo and redo keys, which a card answers with the
    // Annotation History of its own Attachment.
    add(
      mountCardHistoryKeys(
        scope,
        (direction) => {
          const attachmentKey = this.historyAttachment;
          if (attachmentKey !== null)
            this.stepHistory(direction, attachmentKey);
        },
        { isMacOS: Platform.isMacOS },
      ),
    );
  }

  // #region history

  /**
   * The Attachment whose Annotation History a card's undo key steps: the one
   * of the card the Card Selection is on, else the one Attachment shown;
   * `null` while neither names one.
   */
  get historyAttachment(): string | null {
    const { annotations, cardSelection } = this.store.getState();
    const { focus } = cardSelection;
    const key = focus !== null ? placedKey(focus) : cardSelection.selected[0];
    const card = key && annotations?.find((record) => record.key === key);
    if (card) return card.parentKey;
    return this.#shown.length === 1 ? this.#shown[0]! : null;
  }

  /**
   * Step one confirmed edit of an Attachment's Annotation History. An edit
   * made on a card and one made in a PDF view of the same Attachment are one
   * history, in the order they were made. An Attachment no PDF view has open
   * holds no history, so the step finds nothing to take.
   *
   * The repository decides and writes; this seam shows its answer — a step
   * Zotero moved under says so, a write that did not land says why, and a
   * block is reported the way every other blocked edit gesture is.
   *
   * @see apps/obsidian/policies/ui-seams.md
   */
  stepHistory(direction: HistoryDirection, attachmentKey: string): void {
    const stepping =
      direction === "undo"
        ? this.#deps.annotations.undo(attachmentKey)
        : this.#deps.annotations.redo(attachmentKey);
    void stepping.then((outcome) => {
      // The layout can unload while the step is away, and an unloaded one
      // neither scrolls nor speaks.
      if (this.#closed) return;
      const notice = historyOutcomeNotice(outcome, Temporal.Now.instant());
      if (notice !== null) new BaseNotice(notice);
      switch (outcome.kind) {
        case "stepped":
          return this.scrollToCard([outcome.annotationKey]);
        case "removed":
          // The step took its Annotations off the Attachment, so the layout
          // has no card left to bring into view. The reader that holds the
          // PDF lands on the page they sat on.
          return;
        case "blocked":
          this.#deps.reportBlockedGesture(attachmentKey);
          return;
        case "changed":
        case "failed":
        case "locked":
        case "idle":
          return;
        default:
          // A new outcome must be answered here rather than fall through.
          outcome satisfies never;
          return;
      }
    });
  }

  // #endregion

  /** The file inputs one record on screen resolves through ({@link savedExcerptRequest}). */
  #excerptRequest(input: {
    annotation: AnnotationRecord;
    source: AnnotationSource | null;
    sourceScope: string | null;
  }): Promise<ExcerptRequest | null> {
    return savedExcerptRequest({
      ...input,
      zoteroReads: this.#deps.reads,
      paths: this.#deps.zoteroPref,
    });
  }

  /**
   * What one card's editing verbs may do, for the native overflow menu, which
   * is built outside React and so reads the store itself.
   */
  #cardControls(annot: AnnotationRecord): CardControls {
    const state = this.store.getState();
    return cardControls({
      blocks: blocksNow(annot, capabilityOf(state, annot.parentKey)),
      mutation: state.mutations.get(annot.key) ?? IDLE,
      hasTags: annot.tags.length > 0,
      type: annot.type,
    });
  }

  // #region card selection

  /**
   * Keep the Card Selection in step with this reader, and take its selection
   * when it is a new one; `null` binds none. Two hosts bound to one Obsidian
   * PDF view share a selection through it.
   */
  bindReader(reader: ReaderSession | null): void {
    if (reader === this.#boundReader) return;
    logger.debug("The Card Selection binds another reader", {
      source: reader?.source ?? null,
    });
    this.#boundReader = reader;
    this.#takeReaderSelection();
  }

  /** A reader reported a new selection; the bound one's replaces the Card Selection. */
  readerSelectionChanged(reader: ReaderSession): void {
    if (reader === this.#boundReader) this.#takeReaderSelection();
  }

  /** Clear the Card Selection and drop a reader selection that waits. */
  resetSelection(): void {
    this.#readerPending = false;
    this.store.setState({ cardSelection: NO_SELECTION });
  }

  /** @returns the Card Selection after the change, and whether it moved. */
  #setSelection(change: SelectionChange): {
    selection: CardSelection;
    changed: boolean;
  } {
    const state = this.store.getState();
    const current = state.cardSelection;
    const selection = nextCardSelection(current, visibleOrder(state), change);
    if (selection === current) return { selection, changed: false };
    this.store.setState({ cardSelection: selection });
    return { selection, changed: true };
  }

  /**
   * The bound reader's selection replaces the Card Selection, and brings its
   * first card into view. While a card editor is open it waits, so the card
   * being edited keeps its selection; a key the list has not loaded waits for
   * the list. Each call drops what waited before it: the reader's selection
   * now is the latest.
   */
  #takeReaderSelection(): void {
    this.#readerPending = false;
    const reader = this.#boundReader;
    if (!reader) return;
    if (this.#pushing !== null && sameKeys(reader.selected, this.#pushing))
      return;
    const state = this.store.getState();
    const keys = reader.selected;
    if (editorOpen(state)) {
      this.#readerPending = true;
      logger.debug("A reader selection waits for the card editor to close", {
        source: reader.source,
        keys: keys.length,
      });
      return;
    }
    const listed = new Set(state.annotations?.map(({ key }) => key));
    this.#readerPending = !keys.every((key) => listed.has(key));
    const { selection, changed } = this.#setSelection({
      kind: "replace",
      keys,
    });
    logger.debug("A reader selection replaced the Card Selection", {
      source: reader.source,
      keys: keys.length,
      selected: selection.selected.length,
      waitsForList: this.#readerPending,
    });
    if (changed) this.scrollToCard(selection.selected);
  }

  /**
   * A gesture on the cards changes the Card Selection, and a change saves and
   * closes an open card editor. A bound Obsidian PDF view takes the
   * selection; the Zotero Reader takes nothing from ZotLit (ADR 0036).
   *
   * @param landOn the Annotation whose Mark the PDF view lands on quietly: a
   *   Mark Landing, with no Mark Popup.
   */
  #changeFromView(change: SelectionChange, landOn?: string): CardSelection {
    this.#readerPending = false;
    const { selection, changed } = this.#setSelection(change);
    if (changed) this.#closeEditors();
    const session = this.#boundPdfSession();
    if (!session) return selection;
    if (!sameKeys(session.selected, selection.selected))
      this.#pushToPdf(session, selection.selected);
    if (landOn !== undefined) session.navigateToAnnotation(landOn);
    return selection;
  }

  /** Sends the Card Selection to the bound Obsidian PDF view. */
  #pushToPdf(session: ReaderSession, keys: readonly string[]): void {
    this.#pushing = keys;
    try {
      session.setSelectedAnnotations(keys);
    } finally {
      this.#pushing = null;
    }
  }

  /**
   * Whether a key landed on the card list itself: a card's row, the grid, or
   * the frame the host counts as the list with no control focused.
   */
  #onCardList(target: EventTarget | null): boolean {
    const node = target as Node | null;
    if (!node?.instanceOf(HTMLElement)) return false;
    if (node === this.#el || this.#host.onList?.(node) === true) return true;
    return (
      this.#el?.contains(node) === true &&
      node.matches(`${CARD_SELECTOR}, .annots-container, [role="grid"]`)
    );
  }

  /** The Selected Cards, in list order. */
  #selectedCards(): AnnotationRecord[] {
    const { annotations, cardSelection } = this.store.getState();
    const byKey = new Map(annotations?.map((annot) => [annot.key, annot]));
    return cardSelection.selected.flatMap((key) => byKey.get(key) ?? []);
  }

  /**
   * A click on a card: alone, or with Cmd/Ctrl or Shift held. A bound
   * Obsidian PDF view lands quietly on the mark of a card that a plain click
   * or a Cmd/Ctrl-click adds; a card that leaves, and a range, only repaint.
   */
  #clickFromView(change: Extract<SelectionChange, { kind: CardClick }>): void {
    const { key } = change;
    const adds =
      change.kind === "click" ||
      (change.kind === "toggle" &&
        !this.store.getState().cardSelection.selected.includes(key));
    this.#changeFromView(change, adds ? key : undefined);
  }

  /**
   * A card's edit control was pressed: a card not selected alone is first
   * selected alone, as a click selects it, so an editor never opens on a card
   * in a group.
   */
  #selectAloneFromView(key: string): void {
    if (selectedAlone(this.store.getState(), key)) return;
    this.#clickFromView({ kind: "click", key });
  }

  /**
   * A key moves the Card Selection to one card, and a bound Obsidian PDF view
   * lands quietly on its mark, as a click does.
   *
   * @returns whether the selection moved; at either end of the list it stays.
   */
  #moveFromView(step: 1 | -1): boolean {
    const place = this.#stepFromView({ kind: "move", step });
    if (place === null) return false;
    this.#boundPdfSession()?.navigateToAnnotation(placedKey(place));
    return true;
  }

  /**
   * Shift and a key extend the Card Selection by one card; the PDF only
   * repaints.
   *
   * @returns whether the selection moved; at either end of the list it stays.
   */
  #extendFromView(step: 1 | -1): boolean {
    return this.#stepFromView({ kind: "extend", step }) !== null;
  }

  /**
   * One keyboard step of the Card Selection, in the order the grid draws the
   * cards. The card at the place it ends on takes the focus and comes into
   * view.
   *
   * @returns the place it ends on, or `null` where the selection stayed.
   */
  #stepFromView(
    change: Extract<SelectionChange, { kind: "move" | "extend" }>,
  ): CardPlace | null {
    const current = this.store.getState().cardSelection;
    const next = this.#changeFromView(change);
    const place = next.focus;
    if (next === current || place === null) return null;
    const card = this.#placedCardElement(place);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: "nearest" });
    return place;
  }

  /**
   * Escape, or a click on the empty list: an open card editor closes first,
   * and with none open the selection clears — the layout's own, and a bound
   * PDF view's where that holds a mark the list hides.
   *
   * @returns whether there was anything to close or clear.
   */
  #clearFromView(): boolean {
    if (this.#closeEditors()) return true;
    const selected =
      this.store.getState().cardSelection.selected.length > 0 ||
      (this.#boundPdfSession()?.selected.length ?? 0) > 0;
    if (selected) this.#changeFromView({ kind: "clear" });
    return selected;
  }

  /**
   * Saves and closes the open field editor.
   *
   * @returns whether one was open.
   */
  #closeEditors(): boolean {
    if (!editorOpen(this.store.getState())) return false;
    this.#submitOpenEditor();
    this.store.setState({ editing: null });
    return true;
  }

  /**
   * Submits the open field editor's draft, as its own close would, and says
   * why in a notice where the write did not land.
   */
  #submitOpenEditor(): void {
    const { editing } = this.store.getState();
    // The tag editor saves its session as it unmounts. A text field's text is
    // already its draft, which this submits as the editor's own close would.
    if (!editing || editing.field === "tags") return;
    const submitting = this.#deps.annotations.submitTextField(
      editing.field,
      editing.annotationKey,
      { automatic: true },
    );
    void submitting.then((outcome) => {
      if (outcome.kind === "failed")
        new BaseNotice(
          writeFailureMessage(outcome.failure, Temporal.Now.instant()),
        );
    });
  }

  /**
   * The bound reader, while it is an Obsidian PDF view: the one reader the
   * layout can select in. Zotero owns every gesture on its own reader.
   */
  #boundPdfSession(): ReaderSession | null {
    const reader = this.#boundReader;
    return reader?.source === "obsidian-pdf" ? reader : null;
  }

  // #endregion

  /** Bring the first of these cards the list holds into view. */
  scrollToCard(keys: readonly string[]): void {
    for (const key of keys) {
      const el = this.#cardElement(key);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
  }

  /** One Annotation's card, while the list shows it. */
  #cardElement(key: string): HTMLElement | null {
    const el = this.#el?.querySelector(
      `${CARD_SELECTOR}[data-zotero-annotation-key="${key}"]`,
    );
    return el?.instanceOf(HTMLElement) ? el : null;
  }

  /**
   * The card at one place in the list, while the list shows it. A group key
   * can hold any character, so the place is compared, not put in a selector.
   */
  #placedCardElement(place: CardPlace): HTMLElement | null {
    const cards = this.#el?.querySelectorAll<HTMLElement>(
      `${CARD_SELECTOR}[data-zotero-annotation-key="${placedKey(place)}"]`,
    );
    return (
      [...(cards ?? [])].find(
        (card) => card.getAttribute("data-card-place") === place,
      ) ?? null
    );
  }

  /**
   * Bring one Annotation's card forward and select it, from the Mark Popup in
   * the PDF reader or a notice. A card the list does not hold is left alone.
   */
  revealAnnotation(annotationKey: string): void {
    const held = this.store
      .getState()
      .annotations?.some((record) => record.key === annotationKey);
    if (held !== true) return;
    this.#changeFromView({ kind: "click", key: annotationKey });
    this.scrollToCard([annotationKey]);
  }
}
