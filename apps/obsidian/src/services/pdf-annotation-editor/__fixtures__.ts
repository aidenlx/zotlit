// The fake Obsidian PDF reader — viewer host, viewer child, toolbar slot and
// page view — that both pdf-annotation-editor suites drive the seam through.
// Needs a DOM, so every consumer runs under `// @vitest-environment happy-dom`.
import type { HoverParent, PDFPageViewport, Scope } from "obsidian";
import { vi } from "vitest";
import type { Mock } from "vitest";

import { parseAnnotationPosition } from "@zotlit/db";
import type { AnnotationPositionRaw } from "@zotlit/db";
import type { PdfPosition, PdfTextStructure } from "@zotlit/pdf-structure";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { withRecentColor } from "@/lib/annotation-colors";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type {
  AnnotationList,
  AnnotationRecord,
  AnnotationRepositoryEvents,
} from "@/services/annotation-repository/service";
import { IDLE } from "@/services/annotation-repository/write";
import type { MutationState } from "@/services/annotation-repository/write";
import type {
  AttachmentResolution,
  AttachmentResolverEvents,
} from "@/services/attachment-resolver/service";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import { editorApp } from "@/views/annot-view/__fixtures__/editor-app";

import { MarkCreation } from "./creation";
import type { AnnotationCreates } from "./creation";
import { MarkPopupHost } from "./mark-popup-host";
import { mountReaderKeymap } from "./reader-keymap";
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
  const listeners: ((event: unknown) => void)[] = [];
  const child: Record<string, unknown> = {
    // `on` and `off` read the event bus through this, and Obsidian's `unload`
    // closes it and nulls it — see `closeViewer` below.
    pdfViewer: {
      eventBus: {},
      pdfDocument: {
        numPages: 1,
        getPage: vi.fn(async () => page.pdfPage),
        getPageLabels: vi.fn(async () => null),
      },
    },
    on: vi.fn((_event: string, listener: (event: unknown) => void) => {
      listeners.push(listener);
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
      for (const listener of listeners) {
        listener({ pageNumber: 1, source: page });
      }
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
    tags: [],
    position: parseAnnotationPosition(
      position as AnnotationPositionRaw,
      "application/pdf",
    ),
    version: null,
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
) {
  const emitter = createNanoEvents<AttachmentResolverEvents>();
  let current = resolution;
  return {
    resolve: vi.fn(() => current),
    on: <K extends keyof AttachmentResolverEvents>(
      event: K,
      cb: AttachmentResolverEvents[K],
    ) => emitter.on(event, cb),
    /** What the resolver does once the database it waited on is readable. */
    answer(next: AttachmentResolution): void {
      current = next;
      emitter.emit("resolutions-changed");
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
  const emitter = createNanoEvents<AnnotationRepositoryEvents>();
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
  return {
    read: vi.fn(() => Promise.resolve(list)),
    refresh: vi.fn(() => Promise.resolve(list)),
    capabilityFor: vi.fn(() => current),
    mutationFor: vi.fn((): MutationState => IDLE),
    commentDraftFor: vi.fn(() => null),
    editComment: vi.fn(() => null),
    submitComment: vi.fn(() => Promise.resolve(IDLE)),
    discardCommentDraft: vi.fn(),
    retryCommentDraft: vi.fn(() => Promise.resolve(IDLE)),
    patchColor: vi.fn(() => Promise.resolve(IDLE)),
    patchGeometry: vi.fn(() => Promise.resolve(IDLE)),
    deleteAnnotation: vi.fn(() => Promise.resolve(IDLE)),
    createAnnotation: vi.fn(() =>
      Promise.resolve({ kind: "created" as const, annotationKey: "MADE2345" }),
    ),
    get capability() {
      return current;
    },
    probe: vi.fn(() => Promise.resolve()),
    on: <K extends keyof AnnotationRepositoryEvents>(
      event: K,
      cb: AnnotationRepositoryEvents[K],
    ) => emitter.on(event, cb),
    /** What a landed Capability Probe does: another capability, announced. */
    setCapability(next: EditingCapability): void {
      current = next;
      emitter.emit("capability-changed");
    },
    /** What a dropped Zotero DB partition does: a whole new list, announced. */
    replace(attachmentKey: string, next: readonly AnnotationRecord[]): void {
      list = { source: databaseSource, annotations: next };
      emitter.emit("annotations-changed", attachmentKey);
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

/** The one gesture the Mark Popup hands to its UI seam. */
export function markGestures() {
  return { revealAnnotation: vi.fn() };
}

/**
 * The settings the reader keeps each tool's colour in: the shipped defaults,
 * with a write held in memory the way a save holds it on disk.
 */
export function readerSettings(): Pick<SettingsService, "current" | "update"> {
  let current: Settings = { ...defaults };
  return {
    get current() {
      return current;
    },
    update: (patchOrUpdater) => {
      const patch =
        typeof patchOrUpdater === "function"
          ? patchOrUpdater(current)
          : patchOrUpdater;
      current = { ...current, ...patch } as Settings;
      return current;
    },
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

/**
 * The repository, reduced to what the selected mark reads and writes through,
 * with a hand on its announcements.
 */
export function annotationEdits() {
  let commentDraft: {
    annotationKey: string;
    attachmentKey: string;
    serverID: string;
    baseline: string;
    text: string;
    state: { kind: "editing" };
  } | null = null;
  const listeners = new Map<string, Set<(...args: never[]) => void>>();
  function on<K extends keyof AnnotationRepositoryEvents>(
    event: K,
    listener: AnnotationRepositoryEvents[K],
  ): () => void {
    const registered = listeners.get(event) ?? new Set();
    const callback = listener as (...args: never[]) => void;
    registered.add(callback);
    listeners.set(event, registered);
    return () => {
      registered.delete(callback);
    };
  }
  return {
    mutationFor: vi.fn((_key: string): MutationState => IDLE),
    patchColor: vi.fn(async () => IDLE),
    patchGeometry: vi.fn(async (): Promise<MutationState> => IDLE),
    deleteAnnotation: vi.fn(async () => IDLE),
    commentDraftFor: vi.fn(() => commentDraft),
    editComment: vi.fn((annotationKey: string, text = "") => {
      commentDraft = {
        annotationKey,
        attachmentKey: "ABCD2345",
        serverID: "test",
        baseline: "",
        text,
        state: { kind: "editing" },
      };
      return commentDraft;
    }),
    submitComment: vi.fn(async () => IDLE),
    discardCommentDraft: vi.fn(),
    retryCommentDraft: vi.fn(async () => IDLE),
    on: vi.fn(on),
    hideCommentDraft() {
      commentDraft = null;
    },
    emit(event: string, annotationKey: string) {
      for (const listener of listeners.get(event) ?? []) {
        listener(annotationKey as never);
      }
    },
  };
}

/** The instant the reader surfaces read their clock at. */
export const READER_NOW = Temporal.Instant.from("2026-09-17T10:00:00Z");

export interface ReaderSurfacesOptions {
  /** The PDF view's container, where the gestures are heard. */
  containerEl: HTMLElement;
  /** The one page the reader holds, at page index 0. */
  page: OverlayPageView;
  /** What the last read answered. */
  records: readonly AnnotationRecord[];
  capability?: EditingCapability;
  annotations: AnnotationEdits & AnnotationCreates & AnnotationFacts;
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
  structure = null,
  sortIndex = async () => null,
  adjustRange = async () => null,
  textRotation = () => 0,
  colors = toolColors(),
}: ReaderSurfacesOptions) {
  const parent: HoverParent = { hoverPopover: null };
  const store = createReaderSurfaceState({
    colors: colors.current(),
    capability,
    now: READER_NOW,
  });
  let held = records;
  ingestAnnotations(store, held, annotations);
  const listening = listenAnnotationEvents(store, annotations);
  const gestures = {
    revealAnnotation: vi.fn(),
    reportBlockedGesture: vi.fn(),
    allowEditing: vi.fn(),
  };
  /** Why each create that made nothing said it made nothing, in order. */
  const reportCreateFailure = vi.fn<(reason: string) => void>();
  /** Each time the toolbar handed the keyboard to the pages. */
  const focusReader = vi.fn();
  const reported: (readonly string[])[] = [];
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
    now: () => READER_NOW,
  });
  const selection = new MarkSelection({
    app,
    containerEl,
    popup,
    marks: () =>
      store.getState().marksVisible ? groupAnnotationsByPage(held) : new Map(),
    records: () => held,
    pageAt: (pageIndex) => (pageIndex === 0 ? page : null),
    repaint: vi.fn(),
    navigate: (key) => navigated.push(key),
    report: (keys) => reported.push(keys),
    annotations,
    colors,
    surfaceState: store,
    gestures,
    creation,
    sortIndex,
    adjustRange,
    textRotation,
    refreshed: () => Promise.resolve(),
    now: () => READER_NOW,
  });
  selection.load();
  const view: { scope: Scope | null; app: typeof app } = { scope: null, app };
  const unmountKeymap = mountReaderKeymap(view, {
    escape: () => selection.escape() || creation.escape(),
  });
  const host = new MarkPopupHost({
    parent,
    store,
    variants: {
      selected: {
        anchor: () => selection.anchor(),
        render: (content) => selection.renderPopup(content),
      },
      create: {
        anchor: () => creation.anchor(),
        render: (content) => creation.renderPopup(content),
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
    parent,
    colors,
    gestures,
    reportCreateFailure,
    focusReader,
    reported,
    navigated,
    revealed,
    revealedWith,
    /** What a refresh does once the read answers: the records, replaced. */
    replace(next: readonly AnnotationRecord[]) {
      held = next;
      ingestAnnotations(store, next, annotations);
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
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      // The Scope reads the focus before the page is dispatched the event.
      Object.defineProperty(event, "target", { value: target });
      // The mock Scope records its registrations, in the order made.
      const scope = view.scope as unknown as {
        handlers: {
          key: string | null;
          func: (evt: KeyboardEvent) => boolean | void;
        }[];
      };
      for (const { key, func } of scope.handlers) {
        if (key !== null && key !== event.key) continue;
        if (func(event) !== false) continue;
        event.preventDefault();
        return event;
      }
      target.dispatchEvent(event);
      return event;
    },
    [Symbol.dispose]() {
      unmountKeymap();
      selection[Symbol.dispose]();
      creation[Symbol.dispose]();
      host[Symbol.dispose]();
      listening.dispose();
    },
  };
}
