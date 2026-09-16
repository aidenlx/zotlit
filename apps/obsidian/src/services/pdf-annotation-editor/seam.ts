// The one guarded adapter over Obsidian's private PDF reader seam: every read
// of a private member goes through an accessor or a probe declared here.
import type {
  PDFPageRenderedListener,
  PDFPageView,
  PDFViewerController,
  PDFViewerHost,
} from "obsidian";

import { disposable } from "@/lib/disposables";
import { getLogger } from "@/lib/log";

const logger = getLogger("pdf-annotation-editor");

/**
 * The eleven private members ZotLit reads inside Obsidian's PDF reader, as the
 * seam re-verification numbers them. Each is guarded structurally once per
 * binding, so an Obsidian upgrade is re-verified in this one place.
 */
export const PDF_SEAM_MEMBERS = {
  P1: "PDFFileView.file",
  P2: "PDFFileView.viewer",
  P3: "PDFViewerHost.then",
  P4: "PDFViewerController.on/off",
  P5: "PDFViewerController.getPage",
  P6: "PDFViewerController.applySubpath",
  P7: "PDFPageRenderedEvent",
  P8: "PDFPageView",
  P9: "PDFPageViewport",
  P10: "PDFViewerController.toolbar.toolbarRightEl",
  P11: "PDFPageProxy.getTextContent({ includeChars })",
} as const;

export type PdfSeamProbeId = keyof typeof PDF_SEAM_MEMBERS;

export interface PdfSeamProbeResult {
  probe: PdfSeamProbeId;
  /** The member {@link PDF_SEAM_MEMBERS} names for this probe. */
  member: string;
  ok: boolean;
}

/**
 * Records each probe's verdict once per binding and latches the first failure.
 *
 * {@link PdfSeamProbeLog.ok} gates the reader surfaces alone — the annotation
 * repository, the attachment resolver, and the Annotation View never read it,
 * so a changed seam costs the reader its overlay and nothing else.
 */
export class PdfSeamProbeLog {
  readonly #results = new Map<PdfSeamProbeId, PdfSeamProbeResult>();
  readonly #path;
  #failed = false;

  /** @param path the open file's vault or absolute path, for the log records. */
  constructor(path: () => string | null) {
    this.#path = path;
  }

  /** Whether every probe recorded so far passed. */
  get ok(): boolean {
    return !this.#failed;
  }

  get results(): readonly PdfSeamProbeResult[] {
    return [...this.#results.values()];
  }

  /** Later verdicts for an already-recorded probe are dropped. */
  record(results: readonly PdfSeamProbeResult[]): void {
    for (const result of results) {
      if (this.#results.has(result.probe)) continue;
      this.#results.set(result.probe, result);
      const fields = {
        probe: result.probe,
        member: result.member,
        path: this.#path(),
      };
      if (result.ok) {
        logger.debug("PDF reader seam probe passed", fields);
        continue;
      }
      this.#failed = true;
      logger.warn(
        "PDF reader seam probe failed; ZotLit's PDF reader surfaces stay off for this view",
        fields,
      );
    }
  }
}

/** P1 and P2: what a PDF file view must expose before a binding attaches. */
export function probeFileView(view: unknown): PdfSeamProbeResult[] {
  const candidate = isObject(view) ? view : {};
  return [
    verdict(
      "P1",
      "file" in candidate &&
        (candidate.file === null || isVaultFile(candidate.file)),
    ),
    verdict("P2", isViewerHost(candidate.viewer)),
  ];
}

/** P3 to P6 and P10: what the deferred host resolved to. */
export function probeController(
  host: PDFViewerHost,
  controller: unknown,
): PdfSeamProbeResult[] {
  const candidate = isObject(controller) ? controller : {};
  return [
    verdict("P3", isObject(controller) && Object.is(host.child, controller)),
    verdict("P4", isFunction(candidate.on) && isFunction(candidate.off)),
    verdict("P5", isFunction(candidate.getPage)),
    verdict("P6", isFunction(candidate.applySubpath)),
    verdict(
      "P10",
      isObject(candidate.toolbar) &&
        isElement(candidate.toolbar.toolbarRightEl),
    ),
  ];
}

/**
 * P7: the render event Obsidian forwards from PDF.js. Only a real event proves
 * this one, so it is recorded when the first render arrives rather than when the
 * binding attaches.
 */
export function probeRenderEvent(event: unknown): PdfSeamProbeResult[] {
  const candidate = isObject(event) ? event : {};
  return [
    verdict(
      "P7",
      typeof candidate.pageNumber === "number" && isObject(candidate.source),
    ),
  ];
}

/** P8 and P9: a page view and the viewport it converts coordinates through. */
export function probePageView(page: unknown): PdfSeamProbeResult[] {
  return [
    verdict("P8", isPageView(page)),
    verdict("P9", isObject(page) && isViewport(page.viewport)),
  ];
}

/**
 * P11: the per-glyph text content the Sort Index port reads.
 *
 * The worker reads `includeChars` as a boolean defaulting to `false`, so a build
 * that lost the patch answers the same text items with no `chars` key — which is
 * a failure, not an empty page. A page that answers **no items at all** is a
 * scanned page and passes; items that carry no `chars` array do not.
 */
export async function probeTextContent(
  page: PDFPageView,
): Promise<PdfSeamProbeResult> {
  try {
    const content: unknown = await page.pdfPage?.getTextContent({
      includeChars: true,
    });
    if (!isObject(content) || !Array.isArray(content.items)) {
      return verdict("P11", false);
    }
    const items = content.items as unknown[];
    if (items.length === 0) return verdict("P11", true);
    let patched = false;
    for (const item of items) {
      const chars = isObject(item) ? item.chars : undefined;
      if (!Array.isArray(chars)) continue;
      patched = true;
      if (chars.length > 0) return verdict("P11", isGlyph(chars[0]));
    }
    return verdict("P11", patched);
  } catch (error) {
    logger.debug("PDF page text content threw during the seam probe", {
      error,
    });
    return verdict("P11", false);
  }
}

/** The open file's path, `file:`-prefixed for an external file. */
export function openFilePathOf(view: unknown): string | null {
  const file = isObject(view) ? view.file : null;
  return isVaultFile(file) ? file.path : null;
}

/** Runs `onReady` with the viewer child, at once or once Obsidian builds it. */
export function whenViewerReady(
  host: PDFViewerHost,
  onReady: (controller: PDFViewerController) => void,
): void {
  host.then(onReady);
}

/** Subscribes to page renders, paired with the removal that ends the subscription. */
export function onPageRendered(
  controller: PDFViewerController,
  listener: PDFPageRenderedListener,
): Disposable {
  controller.on("pagerendered", listener);
  return disposable(() => controller.off("pagerendered", listener));
}

/** The PDF.js page view for a one-based page number, once that page is built. */
export function pageViewOf(
  controller: PDFViewerController,
  pageNumber: number,
): PDFPageView | null {
  const page: unknown = controller.getPage(pageNumber);
  return isPageView(page) ? page : null;
}

/**
 * The first page of a document Obsidian has already opened, which is what a
 * binding attaching to a painted view — the plugin enabled over an open PDF tab
 * — has to probe, because such a view renders nothing more until the reader
 * moves. `null` while the document is still loading; the page-rendered
 * subscription covers that case.
 */
export function loadedPageOf(
  controller: PDFViewerController,
): PDFPageView | null {
  const page = pageViewOf(controller, 1);
  return page?.pdfPage ? page : null;
}

function verdict(probe: PdfSeamProbeId, ok: boolean): PdfSeamProbeResult {
  return { probe, member: PDF_SEAM_MEMBERS[probe], ok };
}

function isViewerHost(value: unknown): value is PDFViewerHost {
  return isObject(value) && isFunction(value.then) && "child" in value;
}

function isPageView(value: unknown): value is PDFPageView {
  return isObject(value) && isElement(value.div) && isObject(value.viewport);
}

/** The nine constructor properties PDF.js `PageViewport` always assigns. */
const VIEWPORT_NUMBERS = [
  "userUnit",
  "scale",
  "rotation",
  "offsetX",
  "offsetY",
  "width",
  "height",
];

/**
 * The nine constructor properties plus the conversions.
 *
 * The nine are required: `userUnit` absent and read as `1` would silently skew
 * every mark on a page with `/UserUnit ≠ 1`, which is the drift the page-unit
 * overlay exists to prevent. `clone` and `convertToPdfPoint` are methods, not
 * constructor properties, so each is guarded where present and allowed to be
 * absent — a viewport with no `clone` takes the documented division fallback.
 */
function isViewport(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    VIEWPORT_NUMBERS.every((member) => typeof value[member] === "number") &&
    Array.isArray(value.viewBox) &&
    Array.isArray(value.transform) &&
    isFunction(value.convertToViewportPoint) &&
    (value.convertToPdfPoint === undefined ||
      isFunction(value.convertToPdfPoint)) &&
    (value.clone === undefined || isFunction(value.clone))
  );
}

function isGlyph(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.c === "string" &&
    typeof value.u === "string" &&
    Array.isArray(value.r) &&
    value.r.length === 4
  );
}

function isVaultFile(value: unknown): value is { path: string } {
  return isObject(value) && typeof value.path === "string";
}

/** Cross-window safe: `instanceof HTMLElement` is bound to one window. */
function isElement(value: unknown): value is HTMLElement {
  return isObject(value) && value.nodeType === 1;
}

function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}
