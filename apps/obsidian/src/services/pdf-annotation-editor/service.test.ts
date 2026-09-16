// @vitest-environment happy-dom
import { FileSystemAdapter } from "obsidian";
import { expect, it, vi } from "vitest";

import { failedIn, pageView, pdfReader } from "./__fixtures__";
import { PdfAnnotationEditor } from "./service";
import type { AttachmentResolution } from "./service";

/** The eleven probes of the seam re-verification, as issue #1140 numbers them. */
const PROBE_COUNT = 11;

/** A Zotero attachment as the resolver of issue #1141 will report one. */
const RESOLVED = {
  kind: "resolved",
  attachmentKey: "ABCD2345",
  itemKey: "WXYZ6789g4711",
} as const satisfies AttachmentResolution;

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
  return { file: path === null ? null : { path }, viewer: reader.viewer };
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

it("binds an open PDF view, resolves its vault path, and unbinds on unload", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const resolveAttachment = vi.fn((): AttachmentResolution => RESOLVED);
  const { app, offref } = workspace([{ view }]);
  const service = new PdfAnnotationEditor({ app, resolveAttachment });

  {
    await using _service = service;
    await service.ready;

    expect(resolveAttachment).toHaveBeenCalledExactlyOnceWith(
      "/vault/attachments/rougier-2014.pdf",
    );
    const binding = service.bindings[0]!;
    expect(binding.attachment).toEqual(RESOLVED);

    reader.renderFirstPage();
    await binding.probed;
    expect(binding.probes).toHaveLength(PROBE_COUNT);
    expect(failedIn(binding.probes)).toEqual([]);
    expect(binding.supported).toBe(true);
    // This milestone mounts nothing: the reader stays as Obsidian built it.
    expect(reader.toolbarRightEl.childElementCount).toBe(0);
    expect(reader.page.div.childElementCount).toBe(0);
  }

  expect(reader.child.off).toHaveBeenCalledWith(
    "pagerendered",
    expect.any(Function),
  );
  expect(offref).toHaveBeenCalledTimes(2);
});

it("probes the page a view had already painted before the binding attached", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const { app } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({
    app,
    resolveAttachment: () => RESOLVED,
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
    resolveAttachment: () => RESOLVED,
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
  const resolveAttachment = vi.fn((): AttachmentResolution => RESOLVED);
  const view = pdfView("file:/Users/reader/Zotero/storage/ABCD2345/paper.pdf");
  const { app } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({ app, resolveAttachment });
  await service.ready;

  expect(resolveAttachment).toHaveBeenCalledExactlyOnceWith(
    "/Users/reader/Zotero/storage/ABCD2345/paper.pdf",
  );
  expect(service.bindings[0]!.absolutePath).toBe(
    "/Users/reader/Zotero/storage/ABCD2345/paper.pdf",
  );
});

it("leaves a PDF Zotero does not know exactly as Obsidian opened it", async () => {
  const reader = pdfReader();
  const view = pdfView("attachments/holiday-snaps.pdf", reader);
  const { app } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({
    app,
    resolveAttachment: () => ({ kind: "unresolved" }),
  });
  await service.ready;
  const binding = service.bindings[0]!;
  reader.renderFirstPage();
  await binding.probed;

  expect(binding.attachment).toEqual({ kind: "unresolved" });
  expect(reader.toolbarRightEl.childElementCount).toBe(0);
  expect(reader.page.div.childElementCount).toBe(0);
});

it("fails closed to the reader when the controller seam changed shape", async () => {
  const reader = pdfReader();
  delete reader.child.applySubpath;
  const view = pdfView("attachments/rougier-2014.pdf", reader);
  const resolveAttachment = vi.fn((): AttachmentResolution => RESOLVED);
  const { app } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({ app, resolveAttachment });
  await service.ready;
  const binding = service.bindings[0]!;

  expect(binding.supported).toBe(false);
  expect(failedIn(binding.probes)).toEqual(["P6"]);
  expect(reader.child.on).not.toHaveBeenCalled();
  // The resolution the repository and the Annotation View read is untouched.
  expect(resolveAttachment).toHaveBeenCalledExactlyOnceWith(
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
    resolveAttachment: () => RESOLVED,
  });
  await service.ready;
  const binding = service.bindings[0]!;

  expect(binding.supported).toBe(false);
  expect(failedIn(binding.probes)).toEqual(["P9"]);
  expect(reader.child.off).toHaveBeenCalledWith(
    "pagerendered",
    expect.any(Function),
  );
});

it("rebinds a leaf that opened another PDF and unbinds a closed leaf", async () => {
  const first = pdfReader();
  const second = pdfReader();
  const view = pdfView("attachments/first.pdf", first);
  const resolveAttachment = vi.fn((): AttachmentResolution => RESOLVED);
  const leaves = [{ view }];
  const { app, relayout } = workspace(leaves);

  await using service = new PdfAnnotationEditor({ app, resolveAttachment });
  await service.ready;

  Object.assign(view, pdfView("attachments/second.pdf", second));
  relayout();

  expect(first.child.off).toHaveBeenCalledWith(
    "pagerendered",
    expect.any(Function),
  );
  expect(resolveAttachment).toHaveBeenLastCalledWith(
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
  const resolveAttachment = vi.fn((): AttachmentResolution => RESOLVED);
  const { app, relayout } = workspace([{ view }]);

  await using service = new PdfAnnotationEditor({ app, resolveAttachment });
  await service.ready;

  expect(resolveAttachment).not.toHaveBeenCalled();
  expect(reader.child.on).not.toHaveBeenCalled();
  expect(service.bindings[0]!.absolutePath).toBeNull();

  Object.assign(view, pdfView("attachments/rougier-2014.pdf", reader));
  relayout();

  expect(resolveAttachment).toHaveBeenCalledExactlyOnceWith(
    "/vault/attachments/rougier-2014.pdf",
  );
});
