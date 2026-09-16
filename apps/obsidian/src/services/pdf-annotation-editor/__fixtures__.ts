// The fake Obsidian PDF reader — viewer host, viewer child, toolbar slot and
// page view — that both pdf-annotation-editor suites drive the seam through.
// Needs a DOM, so every consumer runs under `// @vitest-environment happy-dom`.
import { vi } from "vitest";
import type { Mock } from "vitest";

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

/** A PDF.js `PageViewport` as the bundled 5.3.34 builds one, at 150 % zoom. */
export function viewport(): Record<string, unknown> {
  return {
    viewBox: [0, 0, 612, 792],
    userUnit: 1,
    scale: 1.5,
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
    transform: [1.5, 0, 0, -1.5, 0, 1188],
    width: 918,
    height: 1188,
    convertToViewportPoint: (x: number, y: number) => [x, y],
    convertToPdfPoint: (x: number, y: number) => [x, y],
    clone: (options: { scale?: number }) => ({ ...viewport(), ...options }),
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

/** The ids of the probes that failed, in the order they were recorded. */
export function failedIn(
  results: readonly { probe: string; ok: boolean }[],
): string[] {
  return results.filter(({ ok }) => !ok).map(({ probe }) => probe);
}
