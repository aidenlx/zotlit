// The fake Obsidian PDF reader — viewer host, viewer child, toolbar slot and
// page view — that both pdf-annotation-editor suites drive the seam through.
// Needs a DOM, so every consumer runs under `// @vitest-environment happy-dom`.
import { vi } from "vitest";
import type { Mock } from "vitest";

import { parseAnnotationPosition } from "@zotlit/db";
import type { AnnotationPositionRaw } from "@zotlit/db";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import type {
  AnnotationList,
  AnnotationRecord,
  AnnotationRepositoryEvents,
} from "@/services/annotation-repository/service";

/** One glyph as Obsidian's patched worker answers it, from the 1.14.2 reading. */
export const GLYPH = {
  c: "E",
  u: "E",
  r: [58.0535, 726.9241, 64.1506, 737.4685],
};

/** One page of text content carrying that glyph. */
export const GLYPH_CONTENT = { items: [{ chars: [GLYPH] }] };

/** A scanned page: the worker answers with no text item at all. */
export const SCANNED_CONTENT = { items: [] };

/** What a build that lost the `includeChars` patch answers: items, but no `chars`. */
export const UNPATCHED_CONTENT = { items: [{ str: "E" }] };

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
  pdfPage?: { getTextContent: Mock };
}

/**
 * A PDF.js page view whose proxy answers `content`.
 *
 * @param content what `getTextContent({ includeChars: true })` resolves with.
 */
export function pageView(content: unknown = GLYPH_CONTENT): FakePageView {
  return {
    div: document.createElement("div"),
    viewport: viewport(),
    pdfPage: { getTextContent: vi.fn(async () => content) },
  };
}

/** The viewer child, its toolbar slot, and the page renders it dispatches. */
export function pdfReader(page = pageView()) {
  const toolbarRightEl = document.createElement("div");
  const listeners: ((event: unknown) => void)[] = [];
  const child: Record<string, unknown> = {
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
    position: parseAnnotationPosition(
      position as AnnotationPositionRaw,
      "application/pdf",
    ),
    version: null,
  };
}

/** The annotation repository, reduced to the reads and the change a binding takes. */
export function annotationReads(records: readonly AnnotationRecord[] = []) {
  const emitter = createNanoEvents<AnnotationRepositoryEvents>();
  let list: AnnotationList = {
    source: { kind: "zotero-db" },
    annotations: records,
  };
  return {
    read: vi.fn(() => Promise.resolve(list)),
    on: <K extends keyof AnnotationRepositoryEvents>(
      event: K,
      cb: AnnotationRepositoryEvents[K],
    ) => emitter.on(event, cb),
    /** What a dropped Zotero DB partition does: a whole new list, announced. */
    replace(attachmentKey: string, next: readonly AnnotationRecord[]): void {
      list = { source: { kind: "zotero-db" }, annotations: next };
      emitter.emit("annotations-changed", attachmentKey);
    },
  };
}

/** The ids of the probes that failed, in the order they were recorded. */
export function failedIn(
  results: readonly { probe: string; ok: boolean }[],
): string[] {
  return results.filter(({ ok }) => !ok).map(({ probe }) => probe);
}
