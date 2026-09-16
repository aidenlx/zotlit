// The fake Obsidian PDF reader — viewer host, viewer child, toolbar slot and
// page view — that both pdf-annotation-editor suites drive the seam through.
// Needs a DOM, so every consumer runs under `// @vitest-environment happy-dom`.
import { vi } from "vitest";
import type { Mock } from "vitest";

import { parseAnnotationPosition } from "@zotlit/db";
import type { AnnotationPositionRaw } from "@zotlit/db";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

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

/**
 * A PDF.js `PageViewport` as the bundled 5.3.34 builds one over a US Letter
 * page, at 150 % zoom by default.
 */
export function viewport(scale = 1.5): Record<string, unknown> {
  return {
    viewBox: [0, 0, 612, 792],
    userUnit: 1,
    scale,
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
    transform: [scale, 0, 0, -scale, 0, 792 * scale],
    width: 612 * scale,
    height: 792 * scale,
    convertToViewportPoint: (x: number, y: number) => [
      x * scale,
      (792 - y) * scale,
    ],
    convertToPdfPoint: (x: number, y: number) => [x / scale, 792 - y / scale],
    clone: ({ scale: next = scale }: { scale?: number }) => viewport(next),
  };
}

export interface FakePageView {
  div: HTMLElement;
  viewport: Record<string, unknown>;
  /** Deleted to stand for a page Obsidian has not finished loading. */
  pdfPage?: {
    view: number[];
    commonObjs: { has: Mock; get: Mock };
    getTextContent: Mock;
  };
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
    div: document.createElement("div"),
    viewport: viewport(),
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
  const toolbarRightEl = document.createElement("div");
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
  let list: AnnotationList = {
    source: { kind: "zotero-db" },
    annotations: records,
  };
  let current = capability;
  return {
    read: vi.fn(() => Promise.resolve(list)),
    capabilityFor: vi.fn(() => current),
    mutationFor: vi.fn((): MutationState => IDLE),
    patchColor: vi.fn(() => Promise.resolve(IDLE)),
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
      list = { source: { kind: "zotero-db" }, annotations: next };
      emitter.emit("annotations-changed", attachmentKey);
    },
  };
}

/** The two gestures the Editing Capability affordance hands to its UI seam. */
export function capabilityGestures() {
  return {
    showEditingCapability: vi.fn(),
    reportBlockedGesture: vi.fn(),
  };
}

/** The one gesture the Mark Popup hands to its UI seam. */
export function markGestures() {
  return { revealAnnotation: vi.fn() };
}

/** The ids of the probes that failed, in the order they were recorded. */
export function failedIn(
  results: readonly { probe: string; ok: boolean }[],
): string[] {
  return results.filter(({ ok }) => !ok).map(({ probe }) => probe);
}
