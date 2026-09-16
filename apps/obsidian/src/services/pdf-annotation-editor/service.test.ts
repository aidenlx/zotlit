// @vitest-environment happy-dom
import { FileSystemAdapter } from "obsidian";
import { expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { themeHook } from "@/lib/theme-hooks";

import {
  annotation,
  annotationReads,
  attachmentReads,
  capabilityGestures,
  failedIn,
  pageView,
  pdfReader,
} from "./__fixtures__";
import { PdfAnnotationEditor } from "./service";
import type { AttachmentResolution } from "./service";

/** The eleven probes of the seam re-verification, as issue #1140 numbers them. */
const PROBE_COUNT = 11;

/** A Zotero attachment as the resolver of issue #1141 reports one. */
const RESOLVED = {
  kind: "resolved",
  attachmentKey: "ABCD2345",
  itemKey: "WXYZ6789g4711",
} as const satisfies AttachmentResolution;

/** Two of the Fixture's own Annotations on `rougier-2014.pdf`, page one. */
const HIGHLIGHT = annotation("PUPR5FG5", "highlight", {
  pageIndex: 0,
  rects: [[265.833, 611.202, 374.503, 620.019]],
});
const UNDERLINE = annotation("K3JRFLFQ", "underline", {
  pageIndex: 0,
  rects: [[67.011, 612.638, 211.485, 620.77]],
});

/** A reader whose one page fails the named viewport probe. */
function brokenReader(member: string) {
  const page = pageView();
  delete (page.viewport as Record<string, unknown>)[member];
  return pdfReader(page);
}

/** A reader Obsidian has not finished opening: its page holds no PDF.js proxy. */
function loadingReader() {
  const page = pageView();
  delete page.pdfPage;
  return pdfReader(page);
}

function pdfView(path: string | null, reader = pdfReader()) {
  return {
    file: path === null ? null : { path },
    viewer: reader.viewer,
    // `View.containerEl` — public API, and where the reader's own keystrokes
    // reach the binding.
    containerEl: document.createElement("div"),
  };
}

function workspace(views: { view: unknown }[]) {
  const offref = vi.fn();
  const handlers: (() => void)[] = [];
  const app = {
    vault: { adapter: new FileSystemAdapter() },
    workspace: {
      getLeavesOfType: () => views,
      onLayoutReady: (callback: () => void) => callback(),
      on: (_name: string, callback: () => void) => {
        handlers.push(callback);
        return { e: { offref } };
      },
    },
  } as never;

  return {
    app,
    offref,
    /** Replays what Obsidian's `file-open` and `layout-change` events drive. */
    relayout: () => {
      for (const handler of handlers) handler();
    },
  };
}

/** The Editing Capability affordance the reader's right toolbar slot holds. */
function affordanceIn(slot: HTMLElement): HTMLElement | null {
  return slot.querySelector<HTMLElement>(`.${themeHook.pdfCapability}`);
}

/** The cooldown's remaining seconds, as the affordance prints them. */
function secondsShown(slot: HTMLElement): string | null {
  return affordanceIn(slot)?.querySelector("span")?.textContent ?? null;
}

/** The instant the affordance reads a cooldown at, and a deadline 45s past it. */
const NOW = Temporal.Instant.from("2026-09-17T10:00:00Z");
const RETRY_AFTER = NOW.add({ seconds: 45 });

/** The Indexed Key of every mark painted over one page, in document order. */
function markedKeys(page: { div: HTMLElement }): (string | undefined)[] {
  return [
    ...page.div.querySelectorAll<SVGElement>("[data-zotero-annotation-key]"),
  ].map((mark) => mark.dataset.zoteroAnnotationKey);
}

it("binds an open PDF view, resolves its vault path, and unbinds on unload", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const attachments = attachmentReads(RESOLVED);
  const annotations = annotationReads();
  const { app, offref } = workspace([{ view }]);
  const service = new PdfAnnotationEditor({
    app,
    attachments,
    annotations,
    capabilityGestures: capabilityGestures(),
  });

  {
    await using _service = service;
    await service.ready;

    expect(attachments.resolve).toHaveBeenCalledExactlyOnceWith(
      "/vault/attachments/rougier-2014.pdf",
    );
    const binding = service.bindings[0]!;
    expect(binding.attachment).toEqual(RESOLVED);
    expect(annotations.read).toHaveBeenCalledExactlyOnceWith("ABCD2345");

    reader.renderFirstPage();
    await binding.probed;
    expect(binding.probes).toHaveLength(PROBE_COUNT);
    expect(failedIn(binding.probes)).toEqual([]);
    expect(binding.supported).toBe(true);
    // The rest of the Creation Toolbar arrives with creation; what stands here
    // is the always-present Editing Capability affordance.
    expect(affordanceIn(reader.toolbarRightEl)?.className).toContain(
      "clickable-icon",
    );
    expect(reader.toolbarRightEl.childElementCount).toBe(1);
    // An attachment with no Annotations leaves the page as Obsidian built it.
    expect(reader.page.div.childElementCount).toBe(0);
  }

  // The binding's disposer leaves the toolbar as Obsidian built it.
  expect(reader.toolbarRightEl.childElementCount).toBe(0);
  expect(reader.child.off).toHaveBeenCalledWith(
    "pagerendered",
    expect.any(Function),
  );
  expect(offref).toHaveBeenCalledTimes(2);
});

it("paints the attachment's annotations over every page it renders", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const annotations = annotationReads([HIGHLIGHT, UNDERLINE]);
  const { app } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations,
    capabilityGestures: capabilityGestures(),
  });
  await service.ready;
  const binding = service.bindings[0]!;
  await binding.refreshed;

  const overlay = reader.page.div.querySelector(".zt-pdf-annotation-overlay");

  expect(overlay?.getAttribute("aria-hidden")).toBe("true");
  expect(markedKeys(reader.page)).toEqual(["PUPR5FG5", "K3JRFLFQ"]);
});

it("rebuilds the marks from data after PDF.js recycles the page", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const annotations = annotationReads([HIGHLIGHT]);
  const { app } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations,
    capabilityGestures: capabilityGestures(),
  });
  await service.ready;
  await service.bindings[0]!.refreshed;

  // What a zoom, a rotation or a page recycle does: PDF.js `reset()` drops
  // every child of the page that is not on its own keep list, the overlay
  // included, and renders the page again.
  reader.page.div.replaceChildren();
  reader.renderFirstPage();

  expect(markedKeys(reader.page)).toEqual(["PUPR5FG5"]);
  // Rebuilt from what the binding already holds: no second database read.
  expect(annotations.read).toHaveBeenCalledOnce();
});

it("replaces the whole list when the repository announces a change", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const annotations = annotationReads([HIGHLIGHT]);
  const { app } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations,
    capabilityGestures: capabilityGestures(),
  });
  await service.ready;
  const binding = service.bindings[0]!;
  await binding.refreshed;

  annotations.replace("ABCD2345", [UNDERLINE]);
  await binding.refreshed;

  expect(markedKeys(reader.page)).toEqual(["K3JRFLFQ"]);

  // Another attachment's change is not this view's.
  annotations.replace("ZZZZ9999", []);
  await binding.refreshed;

  expect(markedKeys(reader.page)).toEqual(["K3JRFLFQ"]);
});

it("takes every mark off the page when the leaf closes", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const leaves = [{ view }];
  const { app, relayout } = workspace(leaves);

  await using service = new PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads([HIGHLIGHT]),
    capabilityGestures: capabilityGestures(),
  });
  await service.ready;
  await service.bindings[0]!.refreshed;

  expect(reader.page.div.childElementCount).toBe(1);

  leaves.length = 0;
  relayout();

  expect(reader.page.div.childElementCount).toBe(0);
});

it("probes the page a view had already painted before the binding attached", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const { app } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads(),
    capabilityGestures: capabilityGestures(),
  });
  await service.ready;
  const binding = service.bindings[0]!;
  await binding.probed;

  // Ten without a render: only P7 needs an event Obsidian has yet to dispatch.
  expect(binding.probes.map(({ probe }) => probe)).not.toContain("P7");
  expect(binding.probes).toHaveLength(PROBE_COUNT - 1);
  expect(failedIn(binding.probes)).toEqual([]);

  reader.renderFirstPage();
  await binding.probed;

  expect(binding.probes).toHaveLength(PROBE_COUNT);
  expect(reader.page.pdfPage?.getTextContent).toHaveBeenCalledOnce();
});

it("waits for the first render when Obsidian is still opening the document", async () => {
  const reader = loadingReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const { app } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads(),
    capabilityGestures: capabilityGestures(),
  });
  await service.ready;
  const binding = service.bindings[0]!;

  // Only the view and controller stages: P1 to P6 and P10.
  expect(binding.probes).toHaveLength(7);

  reader.renderFirstPage();
  await binding.probed;

  // P11 fails: the page Obsidian handed over carries no PDF.js proxy to read.
  expect(binding.probes).toHaveLength(PROBE_COUNT);
  expect(failedIn(binding.probes)).toEqual(["P11"]);
});

it("reads an external file's absolute path from its `file:` prefix", async () => {
  const attachments = attachmentReads(RESOLVED);
  const view = pdfView("file:/Users/reader/Zotero/storage/ABCD2345/paper.pdf");
  const { app } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({
    app,
    attachments,
    annotations: annotationReads(),
    capabilityGestures: capabilityGestures(),
  });
  await service.ready;

  expect(attachments.resolve).toHaveBeenCalledExactlyOnceWith(
    "/Users/reader/Zotero/storage/ABCD2345/paper.pdf",
  );
  expect(service.bindings[0]!.absolutePath).toBe(
    "/Users/reader/Zotero/storage/ABCD2345/paper.pdf",
  );
});

it("leaves a PDF Zotero does not know exactly as Obsidian opened it", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/holiday-snaps.pdf", reader);
  const attachments = attachmentReads({ kind: "unresolved" });
  const annotations = annotationReads([HIGHLIGHT]);
  const { app } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({
    app,
    attachments,
    annotations,
    capabilityGestures: capabilityGestures(),
  });
  await service.ready;
  const binding = service.bindings[0]!;
  reader.renderFirstPage();
  await binding.probed;
  await binding.refreshed;

  // "Zotero does not know this file" is an answer, so later database changes
  // do not send the binding asking again.
  attachments.answer(RESOLVED);
  attachments.answer(RESOLVED);
  await binding.refreshed;

  expect(attachments.resolve).toHaveBeenCalledOnce();
  expect(binding.attachment).toEqual({ kind: "unresolved" });
  expect(annotations.read).not.toHaveBeenCalled();
  expect(reader.toolbarRightEl.childElementCount).toBe(0);
  expect(reader.page.div.childElementCount).toBe(0);
});

it("paints a view bound while the resolver could not answer yet", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const attachments = attachmentReads();
  const annotations = annotationReads([HIGHLIGHT]);
  const { app } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({
    app,
    attachments,
    annotations,
    capabilityGestures: capabilityGestures(),
  });
  await service.ready;
  const binding = service.bindings[0]!;
  reader.renderFirstPage();
  await binding.probed;
  await binding.refreshed;

  // What a plugin reload over an open PDF tab does: the Zotero database is
  // still loading, so "not a Zotero attachment" is not yet the answer.
  expect(binding.attachment).toEqual({ kind: "pending" });
  expect(annotations.read).not.toHaveBeenCalled();
  expect(reader.page.div.childElementCount).toBe(0);

  attachments.answer(RESOLVED);
  await binding.refreshed;

  // No reopen, no zoom, no page change in between.
  expect(binding.attachment).toEqual(RESOLVED);
  expect(markedKeys(reader.page)).toEqual(["PUPR5FG5"]);
});

it("unbinds a leaf whose viewer Obsidian already closed", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const leaves = [{ view }];
  const { app, relayout } = workspace(leaves);

  await using service = new PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads([HIGHLIGHT]),
    capabilityGestures: capabilityGestures(),
  });
  await service.ready;
  await service.bindings[0]!.refreshed;

  expect(markedKeys(reader.page)).toEqual(["PUPR5FG5"]);

  // Obsidian runs its own `unload` first on a closing tab and on a pop-out
  // detach: it closes the PDF.js viewer that `off` and `getPage` read through.
  reader.closeViewer();
  leaves.length = 0;

  expect(() => relayout()).not.toThrow();
  expect(service.bindings).toEqual([]);
  expect(reader.child.off).not.toHaveBeenCalled();
});

it("fails closed to the reader when the controller seam changed shape", async () => {
  const reader = pdfReader();
  delete reader.child.applySubpath;
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const attachments = attachmentReads(RESOLVED);
  const annotations = annotationReads([HIGHLIGHT]);
  const { app } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({
    app,
    attachments,
    annotations,
    capabilityGestures: capabilityGestures(),
  });
  await service.ready;
  const binding = service.bindings[0]!;
  await binding.refreshed;

  expect(binding.supported).toBe(false);
  expect(failedIn(binding.probes)).toEqual(["P6"]);
  expect(reader.child.on).not.toHaveBeenCalled();
  expect(reader.page.div.childElementCount).toBe(0);
  // The resolution the repository and the Annotation View read is untouched.
  expect(attachments.resolve).toHaveBeenCalledExactlyOnceWith(
    "/vault/attachments/rougier-2014.pdf",
  );
  expect(binding.attachment).toEqual(RESOLVED);
});

it("drops its page listener when a page's viewport changed shape", async () => {
  const reader = brokenReader("transform");
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const { app } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads([HIGHLIGHT]),
    capabilityGestures: capabilityGestures(),
  });
  await service.ready;
  const binding = service.bindings[0]!;
  await binding.refreshed;

  expect(binding.supported).toBe(false);
  expect(failedIn(binding.probes)).toEqual(["P9"]);
  expect(reader.page.div.childElementCount).toBe(0);
  expect(reader.child.off).toHaveBeenCalledWith(
    "pagerendered",
    expect.any(Function),
  );
});

it("rebinds a leaf that opened another PDF and unbinds a closed leaf", async () => {
  const first = pdfReader();
  const second = pdfReader();
  const view = pdfView("attachments/first.pdf", first);
  const attachments = attachmentReads(RESOLVED);
  const leaves = [{ view }];
  const { app, relayout } = workspace(leaves);

  await using service = new PdfAnnotationEditor({
    app,
    attachments,
    annotations: annotationReads(),
    capabilityGestures: capabilityGestures(),
  });
  await service.ready;

  Object.assign(view, pdfView("attachments/second.pdf", second));
  relayout();

  expect(first.child.off).toHaveBeenCalledWith(
    "pagerendered",
    expect.any(Function),
  );
  expect(attachments.resolve).toHaveBeenLastCalledWith(
    "/vault/attachments/second.pdf",
  );
  expect(second.child.on).toHaveBeenCalledWith(
    "pagerendered",
    expect.any(Function),
  );

  leaves.length = 0;
  relayout();

  expect(service.bindings).toEqual([]);
  expect(second.child.off).toHaveBeenCalledWith(
    "pagerendered",
    expect.any(Function),
  );
});

it("waits for the file a view has yet to load before it resolves anything", async () => {
  const reader = pdfReader();
  const view = pdfView(null, reader);
  const attachments = attachmentReads(RESOLVED);
  const annotations = annotationReads([HIGHLIGHT]);
  const { app, relayout } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({
    app,
    attachments,
    annotations,
    capabilityGestures: capabilityGestures(),
  });
  await service.ready;

  expect(attachments.resolve).not.toHaveBeenCalled();
  expect(annotations.read).not.toHaveBeenCalled();
  expect(reader.child.on).not.toHaveBeenCalled();
  expect(service.bindings[0]!.absolutePath).toBeNull();

  Object.assign(view, pdfView("attachments/rougier-2014.pdf", reader));
  relayout();

  expect(attachments.resolve).toHaveBeenCalledExactlyOnceWith(
    "/vault/attachments/rougier-2014.pdf",
  );
});

it("exposes each open PDF view as a Reader Session, by the file it holds", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const { app } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads([HIGHLIGHT]),
    capabilityGestures: capabilityGestures(),
  });
  await service.ready;

  const session = service.sessionForPath("attachments/rougier-2014.pdf");
  expect(session).toBe(service.bindings[0]!.session);
  expect(session!.source).toBe("obsidian-pdf");
  expect(session!.target).toEqual({
    attachmentKey: "ABCD2345",
    itemKey: "WXYZ6789g4711",
  });
  expect(service.sessionForPath("attachments/other.pdf")).toBeNull();
});

it("names a standalone attachment in its session, with no parent Item", async () => {
  const view = pdfView("attachments/loose.pdf");
  const { app } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({
    app,
    attachments: attachmentReads({
      kind: "resolved",
      attachmentKey: "LSTAND23",
      itemKey: null,
    }),
    annotations: annotationReads(),
    capabilityGestures: capabilityGestures(),
  });
  await service.ready;

  expect(service.sessionForPath("attachments/loose.pdf")!.target).toEqual({
    attachmentKey: "LSTAND23",
    itemKey: null,
  });
});

it("holds the selection a consumer sets, and announces it", async () => {
  const view = pdfView("attachments/rougier-2014.pdf");
  const { app } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads([HIGHLIGHT, UNDERLINE]),
    capabilityGestures: capabilityGestures(),
  });
  await service.ready;
  const session = service.bindings[0]!.session;
  const announced: (readonly string[])[] = [];
  session.on("selection-changed", (selected) => announced.push(selected));

  session.setSelectedAnnotations(["PUPR5FG5"]);

  expect(session.selected).toEqual(["PUPR5FG5"]);
  expect(announced).toEqual([["PUPR5FG5"]]);
});

it("moves the reader to the page an annotation is drawn on", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const { app } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads([HIGHLIGHT]),
    capabilityGestures: capabilityGestures(),
  });
  await service.ready;
  const binding = service.bindings[0]!;
  await binding.refreshed;
  reader.renderFirstPage();
  await binding.probed;

  const applySubpath = reader.child.applySubpath as Mock<(s: string) => void>;

  binding.session.navigateToAnnotation("PUPR5FG5");
  expect(applySubpath).toHaveBeenCalledWith("#page=1");

  // An annotation this reader draws nowhere moves nothing.
  applySubpath.mockClear();
  binding.session.navigateToAnnotation("K3JRFLFQ");
  expect(applySubpath).not.toHaveBeenCalled();
});

it("stops announcing once the view's binding is gone", async () => {
  const view = pdfView("attachments/rougier-2014.pdf");
  const { app } = workspace([{ view }]);

  const service = new PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads(),
    capabilityGestures: capabilityGestures(),
  });
  await service.ready;
  const session = service.bindings[0]!.session;
  const announced: unknown[] = [];
  session.on("target-changed", (target) => announced.push(target));

  await service[Symbol.asyncDispose]();
  session.setSelectedAnnotations(["PUPR5FG5"]);

  expect(announced).toEqual([]);
  expect(service.bindings).toEqual([]);
  expect(service.sessionForPath("attachments/rougier-2014.pdf")).toBeNull();
});

it("shows the Editing Capability in the reader's toolbar and follows it", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const annotations = annotationReads();
  const { app } = workspace([{ view }]);

  const service = new PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations,
    capabilityGestures: capabilityGestures(),
  });
  {
    await using _service = service;
    await service.ready;
    expect(annotations.capabilityFor).toHaveBeenCalledWith("ABCD2345");
    expect(affordanceIn(reader.toolbarRightEl)?.dataset.ztCapabilityTone).toBe(
      "ready",
    );

    // A probe that changed what this Attachment may do redraws the one node.
    annotations.setCapability({
      kind: "read-only",
      reason: "local-api-disabled",
    });
    const node = affordanceIn(reader.toolbarRightEl)!;
    expect(node.dataset.ztCapabilityTone).toBe("warning");
    expect(node.classList.contains("mod-warning")).toBe(true);
    expect(node.getAttribute("aria-label")).toContain("local API");
    expect(reader.toolbarRightEl.childElementCount).toBe(1);
  }

  expect(reader.toolbarRightEl.childElementCount).toBe(0);
});

it("counts a cooldown down on the toolbar's window, under the binding's disposer", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const annotations = annotationReads();
  const { app } = workspace([{ view }]);
  const started = vi.spyOn(reader.toolbarRightEl.win, "setInterval");
  const stopped = vi.spyOn(reader.toolbarRightEl.win, "clearInterval");
  const cooling = (): void =>
    annotations.setCapability({ kind: "cooldown", retryAfter: RETRY_AFTER });

  const service = new PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations,
    capabilityGestures: capabilityGestures(),
    now: () => NOW,
  });
  {
    await using _service = service;
    await service.ready;
    expect(started).not.toHaveBeenCalled();

    cooling();
    expect(started).toHaveBeenCalledOnce();
    expect(secondsShown(reader.toolbarRightEl)).toBe("45");

    // A capability that no longer counts down stops the clock rather than
    // leaving it turning behind a still icon.
    const id = started.mock.results[0]!.value as number;
    annotations.setCapability({ kind: "writable" });
    expect(stopped).toHaveBeenCalledWith(id);
    expect(secondsShown(reader.toolbarRightEl)).toBeNull();

    // A cooldown still running when the leaf closes takes its interval with it.
    stopped.mockClear();
    cooling();
  }
  expect(stopped).toHaveBeenCalledOnce();
});

it("hands the affordance's click and its keyboard activation to the one gesture", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const gestures = capabilityGestures();
  const { app } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations: annotationReads(),
    capabilityGestures: gestures,
  });
  await service.ready;

  const node = affordanceIn(reader.toolbarRightEl)!;
  node.click();
  node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

  // What the gesture then does — probe, then reveal the row — is the UI seam's,
  // and is asserted where it lives.
  expect(gestures.showEditingCapability).toHaveBeenCalledTimes(2);
});

it("probes before a blocked keystroke is answered, and stays out of the way otherwise", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const annotations = annotationReads([], {
    kind: "read-only",
    reason: "zotero-unavailable",
  });
  const gestures = capabilityGestures();
  const { app } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({
    app,
    attachments: attachmentReads(RESOLVED),
    annotations,
    capabilityGestures: gestures,
  });
  await service.ready;

  // The gesture probes Zotero before anything is said, so the binding's own
  // completion signal is what a check waits on.
  const press = async (key: string): Promise<void> => {
    view.containerEl.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true }),
    );
    await service.bindings[0]!.gestured;
  };

  await press("h");
  expect(annotations.probe).toHaveBeenCalledOnce();
  expect(gestures.reportBlockedGesture).toHaveBeenCalledExactlyOnceWith(
    "ABCD2345",
  );

  // A keystroke that is not an edit gesture never reaches the seam.
  await press("Escape");
  expect(annotations.probe).toHaveBeenCalledOnce();

  // Editing works again, so the keystroke belongs to the reader alone.
  annotations.setCapability({ kind: "writable" });
  await press("u");
  expect(annotations.probe).toHaveBeenCalledOnce();
  expect(gestures.reportBlockedGesture).toHaveBeenCalledOnce();
});
