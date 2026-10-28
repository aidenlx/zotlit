// The fake Obsidian PDF reader — viewer host, viewer child, toolbar slot and
// page view — that both pdf-annotation-editor suites drive the seam through.
// Needs a DOM, so every consumer runs under `// @vitest-environment happy-dom`.
import {
  DateTime,
  Effect,
  Exit,
  PubSub,
  Scope as EffectScope,
  Stream,
} from "effect";
import type { Duration } from "effect";
import type { HoverParent, PDFPageViewport, Scope } from "obsidian";
import { vi } from "vitest";
import type { Mock } from "vitest";

import { parseAnnotationPosition } from "@zotlit/db";
import type { AnnotationPositionRaw } from "@zotlit/db";
import type { PdfPosition, PdfTextStructure } from "@zotlit/pdf-structure";

import { dispatchKey } from "@/lib/__fixtures__/keymap";
import { testNotifier } from "@/lib/__fixtures__/notifier";
import { passAborted } from "@/lib/abort-error";
import { withRecentColor } from "@/lib/annotation-colors";
import type { EffectBridge } from "@/lib/effect-bridge";
import { toInstant } from "@/lib/effect-clock";
import {
  markExternal,
  nextChange,
  writable,
  zoteroLibrary,
} from "@/services/annotation-repository/__fixtures__";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type {
  AnnotationList,
  AnnotationRecord,
  AnnotationRepositoryEvent,
  AnnotationState,
  HistoryOutcome,
} from "@/services/annotation-repository/service";
import { IDLE } from "@/services/annotation-repository/write";
import type { AttachmentResolution } from "@/services/attachment-resolver/service";
import { ReaderSessionHost } from "@/services/reader-session/session";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import type { PluginSettings } from "@/services/settings/service";
import { freshnessSignal } from "@/services/zotero-local-api/__fixtures__";
import type { WireAnnotation } from "@/services/zotero-local-api/__fixtures__";
import { editorApp } from "@/views/annot-view/__fixtures__/editor-app";

import type { AttachmentReads } from "./binding";
import { MarkCreation } from "./creation";
import type { AnnotationCreates } from "./creation";
import { MarkPopupHost } from "./mark-popup-host";
import { bindingWrites } from "./operations";
import { mountReaderKeymap } from "./reader-keymap";
import type { HistoryVerb } from "./reader-keymap";
import {
  createReaderSurfaceState,
  ingestAnnotations,
  listenAnnotationEvents,
} from "./reader-surface-state";
import type { AnnotationFacts } from "./reader-surface-state";
import { groupAnnotationsByPage } from "./render";
import type { OverlayPageView } from "./render";
import { MarkSelection } from "./selection";
import type { AnnotationEdits, MarkSelectionDeps } from "./selection";
import {
  DEFAULT_INK_WIDTH,
  DEFAULT_TEXT_FONT_SIZE,
  resolveToolColors,
} from "./tools";
import type {
  AnnotationToolColors,
  InkWidth,
  TextFontSize,
  ToolColorStore,
} from "./tools";

/** One glyph as Obsidian's patched worker answers it, from the 1.14.2 reading. */
export const GLYPH = {
  c: "E",
  u: "E",
  r: [58.0535, 726.9241, 64.1506, 737.4685],
};

/** The chunk fields the port derives each glyph's metrics and grouping from. */
export const TEXT_CHUNK = {
  transform: [9.9626, 0, 0, 9.9626, 58.0535, 726.9241],
  fontName: "g_d0_f1",
};

/** One page of text content carrying that glyph. */
export const GLYPH_CONTENT = { items: [{ ...TEXT_CHUNK, chars: [GLYPH] }] };

/** A scanned page: the worker answers with no text item at all. */
export const SCANNED_CONTENT = { items: [] };

/** What a build that lost the `includeChars` patch answers: items, but no `chars`. */
export const UNPATCHED_CONTENT = { items: [{ ...TEXT_CHUNK, str: "E" }] };

/** A US Letter page box, `[x1, y1, x2, y2]` in PDF points. */
export const PAGE_BOX = [0, 0, 612, 792] as const;

export interface ViewportOptions {
  rotation?: number;
  scale?: number;
  userUnit?: number;
  box?: readonly [number, number, number, number];
}

/**
 * A PDF.js `PageViewport` built from the matrix its constructor writes, so the
 * conversions every suite reads come from PDF.js's own rule and not from the
 * module under test. Rotation and `/UserUnit` are carried, and a `clone` keeps
 * both — a double that dropped them would let a rotated page pass untested.
 *
 * @see https://github.com/mozilla/pdf.js/blob/v5.3.31/src/display/display_utils.js
 *   `PageViewport` — the nearest tagged release below the 5.3.34 build Obsidian
 *   bundles, whose constructor is unchanged between the two.
 */
export function viewport({
  rotation = 0,
  scale = 1,
  userUnit = 1,
  box = PAGE_BOX,
}: ViewportOptions = {}): PDFPageViewport {
  const total = scale * userUnit;
  const [x1, y1, x2, y2] = box;
  const axesSwap = rotation === 90 || rotation === 270;
  const convertToViewportPoint = (x: number, y: number): [number, number] => {
    switch (rotation) {
      case 90:
        return [total * (y - y1), total * (x - x1)];
      case 180:
        return [total * (x2 - x), total * (y - y1)];
      case 270:
        return [total * (y2 - y), total * (x2 - x)];
      default:
        return [total * (x - x1), total * (y2 - y)];
    }
  };
  const convertToPdfPoint = (x: number, y: number): [number, number] => {
    switch (rotation) {
      case 90:
        return [x1 + y / total, y1 + x / total];
      case 180:
        return [x2 - x / total, y1 + y / total];
      case 270:
        return [x2 - y / total, y2 - x / total];
      default:
        return [x1 + x / total, y2 - y / total];
    }
  };
  // PDF.js's `transform` is the affine map `convertToViewportPoint` applies,
  // so it is read off that map, rotation included.
  const [e, f] = convertToViewportPoint(0, 0);
  const [ax, bx] = convertToViewportPoint(1, 0);
  const [cy, dy] = convertToViewportPoint(0, 1);
  return {
    viewBox: box,
    userUnit,
    scale,
    rotation,
    offsetX: 0,
    offsetY: 0,
    transform: [ax - e, bx - f, cy - e, dy - f, e, f],
    width: total * (axesSwap ? y2 - y1 : x2 - x1),
    height: total * (axesSwap ? x2 - x1 : y2 - y1),
    convertToViewportPoint,
    convertToPdfPoint,
    clone: ({ scale: next = scale, rotation: turned = rotation }) =>
      viewport({ rotation: turned, scale: next, userUnit, box }),
  };
}

export interface FakePageView {
  div: HTMLElement;
  viewport: PDFPageViewport;
  /** Deleted to stand for a page Obsidian has not finished loading. */
  pdfPage?: {
    view: number[];
    commonObjs: { has: Mock; get: Mock };
    getTextContent: Mock;
  };
  /** PDF.js `RenderingStates`: `3` once the page has finished painting. */
  renderingState?: number;
}

/**
 * A PDF.js page view whose proxy answers `content`.
 *
 * The font store answers the base name Zotero's own extraction records, which
 * is what a page whose operator list has been fetched — that is, one that has
 * rendered — answers in the reader.
 *
 * @param content what `getTextContent({ includeChars: true })` resolves with.
 */
export function pageView(content: unknown = GLYPH_CONTENT): FakePageView {
  return {
    div: createDiv(),
    viewport: viewport({ scale: 1.5 }),
    pdfPage: {
      view: [0, 0, 612, 792],
      commonObjs: {
        has: vi.fn(() => true),
        get: vi.fn(() => ({ name: "NimbusRomNo9L-Regu" })),
      },
      getTextContent: vi.fn(async () => content),
    },
  };
}

/** The viewer child, its toolbar slot, and the page renders it dispatches. */
export function pdfReader(page = pageView()) {
  const toolbarRightEl = createDiv();
  const listeners: { event: string; listener: (event: unknown) => void }[] = [];
  const child: Record<string, unknown> = {
    // `on` and `off` read the event bus through this, and Obsidian's `unload`
    // closes it and nulls it — see `closeViewer` below.
    pdfViewer: {
      eventBus: {},
      isInitialViewSet: true,
      pdfDocument: {
        numPages: 1,
        getPage: vi.fn(async () => page.pdfPage),
        getPageLabels: vi.fn(async () => null),
      },
    },
    on: vi.fn((event: string, listener: (event: unknown) => void) => {
      listeners.push({ event, listener });
    }),
    off: vi.fn(),
    getPage: vi.fn((pageNumber: number) =>
      pageNumber === 1 ? page : undefined,
    ),
    applySubpath: vi.fn(),
    toolbar: { toolbarRightEl },
  };

  return {
    child,
    page,
    toolbarRightEl,
    viewer: host(child),
    /** What Obsidian dispatches once PDF.js paints page one. */
    renderFirstPage: () => {
      page.renderingState = 3;
      for (const { event, listener } of listeners) {
        if (event === "pagerendered") listener({ pageNumber: 1, source: page });
      }
    },
    /** What PDF.js dispatches when its current page number changes. */
    turnPage: () => {
      for (const { event, listener } of listeners) {
        if (event === "pagechanging") listener({});
      }
    },
    /**
     * What PDF.js's `setInitialView` does on a reader still opening: it marks
     * the view set, moves to the position the document reopens at, which
     * dispatches `pagechanging`, and then dispatches `documentinit`.
     */
    setInitialView: () => {
      (child.pdfViewer as { isInitialViewSet: boolean }).isInitialViewSet =
        true;
      for (const name of ["pagechanging", "documentinit"]) {
        for (const { event, listener } of listeners) {
          if (event === name) listener({});
        }
      }
    },
    /**
     * What PDF.js's `close` does when Obsidian reloads a changed file into the
     * same reader: `setDocument(null)` dispatches `pagesdestroy`, and then the
     * initial view is unset for the document that opens next.
     */
    closeDocument: () => {
      for (const { event, listener } of listeners) {
        if (event === "pagesdestroy") listener({});
      }
      (child.pdfViewer as { isInitialViewSet: boolean }).isInitialViewSet =
        false;
    },
    /**
     * What the child's `unload` does before a closing leaf reaches ZotLit's
     * disposal: the viewer is closed, and every listener goes with it.
     */
    closeViewer: () => {
      listeners.length = 0;
      child.pdfViewer = null;
      child.toolbar = null;
    },
  };
}

/** A reader whose page one is loaded and whose initial view is not set yet. */
export function openingReader() {
  const reader = pdfReader();
  (reader.child.pdfViewer as { isInitialViewSet: boolean }).isInitialViewSet =
    false;
  return reader;
}

/** Obsidian's deferred viewer host, resolved on the child it was given. */
export function host(child: unknown) {
  return {
    // oxlint-disable-next-line unicorn/no-thenable -- mirrors Obsidian's own deferred host.
    then: (callback: (value: unknown) => void) => callback(child),
    child,
  };
}

/**
 * One Annotation as the repository answers it, from the Fixture's own rows on
 * `rougier-2014.pdf`.
 *
 * @see packages/scripts/lib/fixture/spec.ts — `ANNOTATIONS`
 */
export function annotation(
  key: string,
  type: AnnotationRecord["type"],
  position: unknown,
): AnnotationRecord {
  return {
    key,
    type,
    color: "#2ea8e5",
    comment: null,
    text: null,
    parentKey: "RGRPDF24",
    pageLabel: "1",
    sortIndex: "00000|000000|00000",
    tags: [],
    position: parseAnnotationPosition(
      position as AnnotationPositionRaw,
      "application/pdf",
    ),
    version: null,
    lock: null,
  };
}

/**
 * The attachment resolver, reduced to the lookup and the re-resolution a
 * binding takes.
 *
 * @param resolution what the resolver answers for every path, starting with
 *   `pending` — what a resolver whose database is still loading answers.
 */
export function attachmentReads(
  resolution: AttachmentResolution = { kind: "pending" },
): AttachmentReads & {
  resolve: Mock<AttachmentReads["resolve"]>;
  answer(next: AttachmentResolution): void;
} {
  const changes = Effect.runSync(PubSub.unbounded<void>());
  let current = resolution;
  return {
    resolve: vi.fn<AttachmentReads["resolve"]>(() =>
      Effect.sync(() => current),
    ),
    resolutionsChanged: Stream.fromPubSub(changes),
    /** What the resolver does once the database it waited on is readable. */
    answer(next: AttachmentResolution): void {
      current = next;
      PubSub.publishUnsafe(changes, undefined);
    },
  };
}

/**
 * The annotation repository, reduced to the reads, the Editing Capability, and
 * the two changes a binding takes.
 *
 * @param records the Annotations every read answers with.
 * @param capability what every Attachment, and the session, may do.
 */
export function annotationReads(
  records: readonly AnnotationRecord[] = [],
  capability: EditingCapability = { kind: "writable" },
) {
  const events = Effect.runSync(PubSub.unbounded<AnnotationRepositoryEvent>());
  const databaseSource = {
    kind: "zotero-db" as const,
    database: { userID: null, localUserKey: null, serverID: null },
    libraryID: 1,
    libraryRevision: 0,
  };
  let list: AnnotationList = {
    source: databaseSource,
    annotations: records,
  };
  let current = capability;
  /** How many PDF views hold each Attachment's Annotation History open. */
  const histories = new Map<string, number>();
  const eventStream = Stream.fromPubSub(events);
  /** Called once per run of the `probe` Effect, so a test counts the probes. */
  const probeRuns = vi.fn(() => Effect.void);
  return {
    read: vi.fn(() => Effect.succeed(list)),
    peek: vi.fn(() =>
      Effect.succeed({
        value: list,
        status: "fresh" as const,
        settled: Promise.resolve(list),
      }),
    ),
    refresh: vi.fn(() => Effect.succeed(list)),
    capabilityFor: vi.fn(() => Effect.sync(() => current)),
    annotationState: vi.fn(() =>
      Effect.sync((): AnnotationState => ({
        mutation: IDLE,
        textDrafts: { comment: null, text: null },
        tagDraft: null,
        hidden: false,
        gone: false,
      })),
    ),
    textDraftFor: vi.fn(() => Effect.succeed(null)),
    editTextField: vi.fn(() => Effect.succeed(null)),
    submitTextField: vi.fn(() => Effect.succeed(IDLE)),
    editTags: vi.fn(() => Effect.succeed(null)),
    submitTags: vi.fn(() => Effect.succeed(IDLE)),
    discardTextDraft: vi.fn(() => Effect.void),
    discardTagDraft: vi.fn(() => Effect.void),
    retryTextDraft: vi.fn(() => Effect.succeed(IDLE)),
    patchColor: vi.fn(() => Effect.succeed(IDLE)),
    patchColors: vi.fn((keys: readonly string[]) =>
      Effect.succeed(keys.map(() => IDLE)),
    ),
    patchGeometry: vi.fn(() => Effect.succeed(IDLE)),
    deleteAnnotation: vi.fn(() => Effect.succeed(IDLE)),
    deleteAnnotations: vi.fn((keys: readonly string[]) =>
      Effect.succeed(keys.map(() => IDLE)),
    ),
    createAnnotation: vi.fn(() =>
      Effect.succeed({ kind: "created" as const, annotationKey: "MADE2345" }),
    ),
    capability: Effect.sync(() => current),
    probe: Effect.suspend(probeRuns),
    probeRuns,
    hold: vi.fn(() =>
      Effect.succeed<Disposable>({ [Symbol.dispose]: () => {} }),
    ),
    openHistory: vi.fn((attachmentKey: string) =>
      Effect.sync(() => {
        histories.set(attachmentKey, (histories.get(attachmentKey) ?? 0) + 1);
      }),
    ),
    closeHistory: vi.fn((attachmentKey: string) =>
      Effect.sync(() => {
        const left = (histories.get(attachmentKey) ?? 1) - 1;
        if (left > 0) histories.set(attachmentKey, left);
        else histories.delete(attachmentKey);
      }),
    ),
    undo: vi.fn((_attachmentKey: string): Effect.Effect<HistoryOutcome> =>
      Effect.succeed({ kind: "idle" }),
    ),
    redo: vi.fn((_attachmentKey: string): Effect.Effect<HistoryOutcome> =>
      Effect.succeed({ kind: "idle" }),
    ),
    /** The Attachments a history stands open for, and how many views hold each. */
    get histories(): ReadonlyMap<string, number> {
      return histories;
    },
    annotationsChanged: eventStream.pipe(
      Stream.filter(
        (
          event,
        ): event is Extract<
          AnnotationRepositoryEvent,
          { _tag: "annotations-changed" }
        > => event._tag === "annotations-changed",
      ),
      Stream.map(({ attachmentKey }) => attachmentKey),
    ),
    annotationChanged: eventStream.pipe(
      Stream.filter(
        (
          event,
        ): event is Extract<
          AnnotationRepositoryEvent,
          { _tag: "annotation-changed" }
        > => event._tag === "annotation-changed",
      ),
      Stream.map(({ annotationKey }) => annotationKey),
    ),
    capabilityChanges: eventStream.pipe(
      Stream.filter(
        (
          event,
        ): event is Extract<
          AnnotationRepositoryEvent,
          { _tag: "capability-changed" }
        > => event._tag === "capability-changed",
      ),
      Stream.as(undefined),
    ),
    /** What a landed Capability Probe does: another capability, announced. */
    setCapability(next: EditingCapability): void {
      current = next;
      PubSub.publishUnsafe(events, { _tag: "capability-changed" });
    },
    /** What a dropped Zotero DB partition does: a whole new list, announced. */
    replace(attachmentKey: string, next: readonly AnnotationRecord[]): void {
      list = { source: databaseSource, annotations: next };
      PubSub.publishUnsafe(events, {
        _tag: "annotations-changed",
        attachmentKey,
      });
    },
  };
}

/** The blocked-edit gesture the PDF reader hands to its UI seam. */
export function capabilityGestures() {
  return {
    reportBlockedGesture: vi.fn(),
    allowEditing: vi.fn(),
  };
}

/** The gestures the Mark Popup hands to its UI seam. */
export function markGestures() {
  return { revealAnnotation: vi.fn(), blockedPress: vi.fn() };
}

/**
 * The settings the reader keeps each tool's colour in: the shipped defaults,
 * with a write held in memory the way a save holds it on disk.
 */
export function readerSettings(): Pick<
  PluginSettings["Service"],
  "current" | "update"
> {
  let current: Settings = { ...defaults };
  return {
    current: Effect.sync(() => current),
    update: (patchOrUpdater) =>
      Effect.sync(() => {
        const patch =
          typeof patchOrUpdater === "function"
            ? patchOrUpdater(current)
            : patchOrUpdater;
        current = { ...current, ...patch } as Settings;
        return current;
      }),
  };
}

/** Each tool's colour, held the way the settings-backed store holds it. */
export function toolColors(): ToolColorStore {
  let stored: AnnotationToolColors = {};
  let recent: readonly string[] = [];
  let inkWidth: InkWidth = DEFAULT_INK_WIDTH;
  let textFontSize: TextFontSize = DEFAULT_TEXT_FONT_SIZE;
  return {
    current: () => resolveToolColors(stored),
    set: (tool, color) => {
      stored = { ...stored, [tool]: color };
    },
    recent: () => recent,
    use: (color) => {
      recent = withRecentColor(recent, color);
    },
    inkWidth: () => inkWidth,
    setInkWidth: (width) => {
      inkWidth = width;
    },
    textFontSize: () => textFontSize,
    setTextFontSize: (size) => {
      textFontSize = size;
    },
  };
}

/** The ids of the probes that failed, in the order they were recorded. */
export function failedIn(
  results: readonly { probe: string; ok: boolean }[],
): string[] {
  return results.filter(({ ok }) => !ok).map(({ probe }) => probe);
}

export { dispatchKey };

/** The instant the reader surfaces read their clock at. */
export const READER_NOW = toInstant(
  DateTime.makeUnsafe("2026-09-17T10:00:00Z"),
);

export interface ReaderSurfacesOptions {
  /** The PDF view's container, where the gestures are heard. */
  containerEl: HTMLElement;
  /** The one page the reader holds, at page index 0. */
  page: OverlayPageView;
  /** What the last read answered. */
  records: readonly AnnotationRecord[];
  capability?: EditingCapability;
  annotations: AnnotationEdits & AnnotationCreates & AnnotationFacts;
  bridge: Pick<
    EffectBridge,
    "runSync" | "runPromise" | "runPromiseExit" | "subscribe"
  >;
  /**
   * This document's Structured Characters; `null` until one is open. As a
   * function, read on each ask, as the viewer is.
   */
  structure?: PdfTextStructure | null | (() => PdfTextStructure | null);
  /** The Sort Index a Geometry Edit is saved with. */
  sortIndex?: (position: PdfPosition) => Promise<string | null>;
  /** The range a text range's dragged end reaches. */
  adjustRange?: MarkSelectionDeps["adjustRange"];
  /** The text rotation a range's handles lie across. */
  textRotation?: MarkSelectionDeps["textRotation"];
  /** Each tool's colour and the ink width; held in memory unless given. */
  colors?: ToolColorStore;
  /**
   * The platform the Reader Keymap binds the Annotation History keys for.
   *
   * @default false
   */
  isMacOS?: boolean;
  /** Where the surfaces' notices go; a recording one unless given. */
  notifier?: ReturnType<typeof testNotifier>;
}

/**
 * The reader surfaces over one page, wired the way the binding wires them: one
 * Reader Surface State, the Mark Selection and the Mark Creation that draw from
 * it, and the one popup host over both.
 */
export function readerSurfaces({
  containerEl,
  page,
  records,
  capability = { kind: "writable" },
  annotations,
  bridge,
  structure = null,
  sortIndex = async () => null,
  adjustRange = async () => null,
  textRotation = () => 0,
  colors = toolColors(),
  isMacOS = false,
  notifier = testNotifier(),
}: ReaderSurfacesOptions) {
  const parent: HoverParent = { hoverPopover: null };
  const store = createReaderSurfaceState({
    colors: colors.current(),
    capability,
    now: READER_NOW,
  });
  // The view holds its Attachment's list while it is open, as the binding
  // does.
  const viewHold = bridge.runSync(annotations.hold(["RGRPDF24"]));
  let held = records;
  ingestAnnotations(store, held, { annotations, bridge });
  const listening = listenAnnotationEvents(store, annotations, bridge);
  // The view's own Scope, which the writes run on and the disposal closes.
  const scope = EffectScope.makeUnsafe();
  const writes = Effect.runSync(bindingWrites.pipe(EffectScope.provide(scope)));
  const gestures = {
    revealAnnotation: vi.fn(),
    blockedPress: vi.fn(),
    reportBlockedGesture: vi.fn(),
    allowEditing: vi.fn(),
  };
  /** Why each create that made nothing said it made nothing, in order. */
  const reportCreateFailure = vi.fn<(reason: string) => void>();
  /** Each time the toolbar handed the keyboard to the pages. */
  const focusReader = vi.fn();
  const reported: (readonly string[])[] = [];
  /** The session a consumer names its selection surfaces on. */
  const session = new ReaderSessionHost({
    source: "obsidian-pdf",
    navigate: vi.fn(),
    select: vi.fn(),
  });
  const navigated: string[] = [];
  const revealed: string[] = [];
  /** The options each reveal was asked with, in reveal order. */
  const revealedWith: { commenting?: boolean }[] = [];
  const popup = {
    contains: (node: Node | null) => host.contains(node),
    sync: () => host.sync(),
  };
  const app = editorApp();
  const creation = new MarkCreation({
    app,
    containerEl,
    popup,
    attachmentKey: "RGRPDF24",
    pages: () => [{ pageIndex: 0, view: page }],
    records: () => held,
    structure: typeof structure === "function" ? structure : () => structure,
    repaint: vi.fn(),
    reveal: (annotationKey, options = {}) => {
      revealed.push(annotationKey);
      revealedWith.push(options);
    },
    reportBlockedGesture: gestures.reportBlockedGesture,
    reportCreateFailure,
    renderCapability: vi.fn(),
    focusReader,
    colors,
    surfaceState: store,
    annotations,
    bridge,
    writes,
    now: () => READER_NOW,
  });
  const selection = new MarkSelection({
    app,
    renderComment: (el, html) => {
      el.setText(html);
      return () => el.empty();
    },
    libraryTagNames: async () => [],
    containerEl,
    popup,
    selectionSurfaces: session,
    marks: () =>
      store.getState().marksVisible ? groupAnnotationsByPage(held) : new Map(),
    records: () => held,
    pageAt: (pageIndex) => (pageIndex === 0 ? page : null),
    repaint: vi.fn(),
    navigate: (key) => navigated.push(key),
    report: (keys) => reported.push(keys),
    annotations,
    bridge,
    writes,
    notifier: notifier.service,
    colors,
    surfaceState: store,
    gestures,
    creation,
    sortIndex,
    adjustRange,
    textRotation,
    now: () => READER_NOW,
  });
  selection.load();
  const view: { scope: Scope | null; app: typeof app } = { scope: null, app };
  /** Each press of the Annotation History keys this fixture answered, in order. */
  const stepped: HistoryVerb[] = [];
  const unmountKeymap = mountReaderKeymap(
    view,
    {
      escape: () => selection.escape() || creation.escape(),
      undo: () => stepped.push("undo"),
      redo: () => stepped.push("redo"),
      copy: () => selection.copy(),
    },
    { isMacOS },
  );
  const host = new MarkPopupHost({
    parent,
    store,
    variants: {
      selected: {
        anchor: () => selection.anchor(),
        render: (content) => selection.popupView(content),
      },
      create: {
        anchor: () => creation.anchor(),
        render: () => creation.popupView(),
        unanchored: () => creation.unanchored(),
      },
    },
  });

  return {
    app,
    store,
    host,
    selection,
    creation,
    session,
    parent,
    colors,
    gestures,
    reportCreateFailure,
    /** Every notice the surfaces showed, in order. */
    notices: notifier.notices,
    focusReader,
    reported,
    navigated,
    revealed,
    revealedWith,
    stepped,
    /** What a refresh does once the read answers: the records, replaced. */
    replace(next: readonly AnnotationRecord[]) {
      held = next;
      ingestAnnotations(store, next, { annotations, bridge });
    },
    /** What the binding does once a page re-rendered. */
    sync() {
      host.sync();
    },
    /**
     * One keystroke as Obsidian delivers it: the view's Scope hears it first,
     * and the page hears it only when no handler there took it.
     *
     * @param target where the focus sits; the container when not given.
     */
    key(init: KeyboardEventInit, target: EventTarget = containerEl) {
      return dispatchKey(view.scope!, init, target);
    },
    [Symbol.dispose]() {
      unmountKeymap();
      selection[Symbol.dispose]();
      creation[Symbol.dispose]();
      host[Symbol.dispose]();
      session[Symbol.dispose]();
      listening.dispose();
      viewHold[Symbol.dispose]();
      Effect.runFork(EffectScope.close(scope, Exit.void));
    },
  };
}

/** One reader record as the Zotero Local API writes it. */
export function wireOf(record: AnnotationRecord): WireAnnotation {
  return {
    key: record.key,
    version: record.version ?? 1,
    type: record.type,
    ...(record.color !== null && { color: record.color }),
    ...(record.comment !== null && { comment: record.comment }),
    ...(record.text !== null && { text: record.text }),
    ...(record.pageLabel !== null && { pageLabel: record.pageLabel }),
    sortIndex: record.sortIndex,
    position:
      record.position.kind === "unknown"
        ? record.position.raw
        : record.position,
    tags: record.tags,
  };
}

/**
 * The real Annotation Repository over a Zotero that holds `records` on
 * `RGRPDF24`, with Write Authorization already remembered and the list read.
 * What Zotero holds, through `zotero`, is the oracle a write is checked by.
 */
export async function repositoryOver(
  stack: AsyncDisposableStack,
  records: readonly AnnotationRecord[],
  { external }: { external?: readonly string[] } = {},
) {
  const zotero = zoteroLibrary(records.map(wireOf));
  const {
    repository,
    service,
    bridge,
    requests,
    client,
    dbEvents,
    serverEvents,
    localApiService,
    runtime,
    adjustLayerClock,
  } = await writable(stack, zotero.answers, { external });
  const list = await repository.read("RGRPDF24");
  return {
    repository,
    service,
    bridge,
    zotero,
    requests,
    list,
    localApiService,
    /**
     * Move the repository's TestClock, which its autosave timers run on;
     * Vitest's fake timers do not reach them.
     */
    adjustRepositoryClock(duration: Duration.Input): Promise<void> {
      return runtime.runPromise(adjustLayerClock(duration));
    },
    /**
     * Zotero imports one Annotation from the PDF file, and a database refresh
     * tells the repository, which locks it.
     */
    importFromPdf(key: string): void {
      markExternal(client, key);
      dbEvents.emit("changed");
    },
    /**
     * Zotero quits, and the device's database turns out to be another one:
     * the switch that hides every draft made against the first.
     */
    async switchDatabase(): Promise<void> {
      zotero.quit();
      const lost = nextChange(repository);
      freshnessSignal(serverEvents);
      await lost;
      client.$client.exec(
        "update settings set value = 'Zzzz11119999' where setting = 'localAPI' and key = 'serverID'",
      );
      dbEvents.emit("changed");
      await repository.read("RGRPDF24");
    },
  };
}

/**
 * The reader surfaces over {@link repositoryOver}. Every announcement is drawn
 * as the binding draws it: the list the repository holds at once, then the
 * list the read that follows answers. A test therefore sees the Pending
 * Proposals, failures and conflicts the repository itself produces.
 */
export async function readerOverZotero(
  stack: AsyncDisposableStack,
  {
    external,
    ...options
  }: Omit<ReaderSurfacesOptions, "annotations" | "bridge"> & {
    /** The Annotations Zotero imported from the PDF file, by key. */
    external?: readonly string[];
  },
) {
  const zoteroSide = await repositoryOver(stack, options.records, {
    external,
  });
  const { repository, service, bridge, list } = zoteroSide;
  const reader = stack.use(
    readerSurfaces({
      ...options,
      records: list?.annotations ?? [],
      annotations: service,
      bridge,
    }),
  );
  let open = true;
  stack.defer(() => {
    open = false;
  });
  const draw = (next: AnnotationList | null | undefined) => {
    if (!open || !next) return;
    reader.replace(next.annotations);
    reader.sync();
  };
  stack.defer(
    repository.listen("annotations-changed", (attachmentKey) => {
      draw(repository.peek(attachmentKey)?.value);
      void repository.read(attachmentKey).then(draw).catch(passAborted);
    }),
  );
  return { ...reader, ...zoteroSide, closeRuntime: () => stack.disposeAsync() };
}
