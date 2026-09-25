// The reader's borrowed-document accessor: what excerpt work may reach of an
// open PDF view's document, and what a closed or replaced one withdraws.

// @vitest-environment happy-dom
import { resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import { FileSystemAdapter, Scope } from "obsidian";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { NoteIndexStub } from "@/services/note-index/test-stub";

import {
  annotationReads,
  attachmentReads,
  capabilityGestures,
  markGestures,
  pdfReader,
  readerSettings,
} from "./__fixtures__";
import { PdfAnnotationEditor } from "./service";

/** The bytes a document holding the open file answers with. */
const PDF_BYTES = new Uint8Array([37, 80, 68, 70]);

/** The document's own bytes-read, which a build may or may not answer. */
function withBytes(reader: ReturnType<typeof pdfReader>, bytes = PDF_BYTES) {
  const document_ = reader.child.pdfViewer as { pdfDocument: object };
  Object.assign(document_.pdfDocument, {
    getData: vi.fn(async () => bytes),
  });
  return document_.pdfDocument;
}

function pdfView(path: string | null, reader = pdfReader()) {
  return {
    file: path === null ? null : { path },
    viewer: reader.viewer,
    containerEl: document.createElement("div"),
    // `View.scope` — the Scope Obsidian gives every PDF view.
    scope: new Scope(),
  };
}

function workspace(views: { view: unknown }[]) {
  const app = {
    vault: { adapter: new FileSystemAdapter() },
    workspace: {
      getLeavesOfType: () => views,
      onLayoutReady: (callback: () => void) => callback(),
      on: () => ({ e: { offref: vi.fn() } }),
    },
  } as never;
  return app;
}

/** A bound PDF view, and the registry that owns it. */
async function readerRegistry(
  view: unknown,
  attachments = attachmentReads(),
  annotations = annotationReads(),
) {
  const service = new PdfAnnotationEditor({
    app: workspace([{ view }]),
    attachments,
    annotations,
    capabilityGestures: capabilityGestures(),
    markGestures: markGestures(),
    settings: readerSettings(),
    noteIndex: new NoteIndexStub(),
  });
  await service.ready;
  return service;
}

// The Reader Keymap binds the Annotation History keys for the host platform,
// which every binding these tests build reads as it mounts.
beforeEach(() => {
  setMockPlatform({ isMacOS: false });
});

afterEach(() => {
  resetMockPlatform();
});

it("lends the open document's bytes and pages for an absolute path", async () => {
  const reader = pdfReader();
  const document_ = withBytes(reader);
  await using service = await readerRegistry(pdfView("paper.pdf", reader));

  const borrowed = service.borrowDocument("/vault/paper.pdf");

  expect(borrowed?.path).toBe("/vault/paper.pdf");
  expect(borrowed?.document).toBe(document_);
  expect(await borrowed?.bytes()).toEqual(PDF_BYTES);
  expect(await borrowed?.page(0)).toBe(reader.page.pdfPage);
  expect((document_ as { getPage: Mock }).getPage).toHaveBeenCalledWith(1);
});

it("answers nothing for a file no open view holds", async () => {
  const reader = pdfReader();
  withBytes(reader);
  await using service = await readerRegistry(pdfView("paper.pdf", reader));

  expect(service.borrowDocument("/vault/other.pdf")).toBeNull();
  expect(service.borrowDocument("/vault")).toBeNull();
});

it("answers nothing while the viewer child has not been built", async () => {
  const cold = {
    file: { path: "paper.pdf" },
    // oxlint-disable-next-line unicorn/no-thenable -- mirrors Obsidian's own deferred host.
    viewer: { then: () => undefined },
    containerEl: document.createElement("div"),
  };
  await using service = await readerRegistry(cold);

  expect(service.borrowDocument("/vault/paper.pdf")).toBeNull();
});

it("answers nothing for a view with no open file", async () => {
  const reader = pdfReader();
  withBytes(reader);
  await using service = await readerRegistry(pdfView(null, reader));

  expect(service.borrowDocument("/vault/paper.pdf")).toBeNull();
});

it("withdraws a lent document when the reader closes it", async () => {
  const reader = pdfReader();
  withBytes(reader);
  await using service = await readerRegistry(pdfView("paper.pdf", reader));
  const borrowed = service.borrowDocument("/vault/paper.pdf");
  expect(borrowed).not.toBeNull();

  reader.closeViewer();

  expect(service.borrowDocument("/vault/paper.pdf")).toBeNull();
  expect(await borrowed!.page(0)).toBeNull();
});

it("withdraws a lent document when the reader replaces it", async () => {
  const reader = pdfReader();
  withBytes(reader);
  await using service = await readerRegistry(pdfView("paper.pdf", reader));
  const borrowed = service.borrowDocument("/vault/paper.pdf");
  const viewer = reader.child.pdfViewer as { pdfDocument: unknown };

  const replacement = {
    numPages: 1,
    getPage: vi.fn(async () => reader.page.pdfPage),
    getPageLabels: vi.fn(async () => null),
    getData: vi.fn(async () => PDF_BYTES),
  };
  viewer.pdfDocument = replacement;

  expect(await borrowed!.page(0)).toBeNull();
  const next = service.borrowDocument("/vault/paper.pdf");
  expect(next?.document).toBe(replacement);
  expect(await next?.page(0)).toBe(reader.page.pdfPage);
});

it("withdraws a lent document when the binding lets its controller go", async () => {
  const reader = pdfReader();
  const document_ = withBytes(reader);
  // A resolved Attachment is what mounts the binding's surfaces, including the
  // teardown that lets its controller go.
  await using service = await readerRegistry(
    pdfView("paper.pdf", reader),
    attachmentReads({
      kind: "resolved",
      attachmentKey: "ABCD2345",
      itemKey: "WXYZ6789g4711",
      openable: true,
    }),
  );
  const borrowed = service.borrowDocument("/vault/paper.pdf");
  expect(borrowed?.current()).toBe(true);

  // The binding drops the controller it lent from — the leaf closed — while the
  // viewer object behind it still holds the document the borrow was taken for.
  service.bindings[0]![Symbol.dispose]();

  expect(borrowed!.current()).toBe(false);
  expect(await borrowed!.bytes()).toBeNull();
  expect(await borrowed!.page(0)).toBeNull();
  // Only the borrow was withdrawn: the reader's own document is untouched.
  // `withBytes` attached the spy this reads back from the fixture's document.
  const documentSpies = document_ as { getData: Mock; getPage: Mock };
  expect(documentSpies.getData).not.toHaveBeenCalled();
  expect(documentSpies.getPage).not.toHaveBeenCalled();
});

it("withdraws a page the reader replaced while its read was in flight", async () => {
  const reader = pdfReader();
  const document_ = withBytes(reader);
  await using service = await readerRegistry(pdfView("paper.pdf", reader));
  const borrowed = service.borrowDocument("/vault/paper.pdf")!;
  const reading = Promise.withResolvers<unknown>();
  const getPage = vi.fn(() => reading.promise);
  Object.assign(document_, { getPage });

  const page = borrowed.page(0);
  await vi.waitFor(() => expect(getPage).toHaveBeenCalledTimes(1));
  // Obsidian reloads the file into a new document while that read is pending,
  // so the page it answers belongs to the document the reader moved on from.
  const viewer = reader.child.pdfViewer as { pdfDocument: unknown };
  viewer.pdfDocument = {
    numPages: 1,
    getPage: vi.fn(async () => reader.page.pdfPage),
    getPageLabels: vi.fn(async () => null),
  };
  reading.resolve(reader.page.pdfPage);

  expect(await page).toBeNull();
  expect(borrowed.current()).toBe(false);
});

it("answers no bytes for a document whose build cannot report them", async () => {
  const reader = pdfReader();
  await using service = await readerRegistry(pdfView("paper.pdf", reader));

  const borrowed = service.borrowDocument("/vault/paper.pdf");

  expect(borrowed).not.toBeNull();
  expect(await borrowed?.bytes()).toBeNull();
});

it("answers no page for a document that cannot read one", async () => {
  const reader = pdfReader();
  const document_ = withBytes(reader);
  Object.assign(document_, {
    getPage: vi.fn(async () => {
      throw new Error("Worker was destroyed");
    }),
  });
  await using service = await readerRegistry(pdfView("paper.pdf", reader));

  const borrowed = service.borrowDocument("/vault/paper.pdf");

  expect(await borrowed?.page(0)).toBeNull();
});

it("leaves the reader session's own role untouched", async () => {
  const reader = pdfReader();
  withBytes(reader);
  const view = pdfView("paper.pdf", reader);
  const annotations = annotationReads();
  await using service = await readerRegistry(
    view,
    attachmentReads({
      kind: "resolved",
      attachmentKey: "ABCD2345",
      itemKey: "WXYZ6789g4711",
      openable: true,
    }),
    annotations,
  );

  reader.renderFirstPage();
  const binding = service.bindings[0]!;
  await binding.probed;

  // The binding stands on the reader's own session, and excerpt work reaches
  // the same document while it does.
  expect(binding.supported).toBe(true);
  expect(binding.session).toBe(service.sessionForPath("paper.pdf"));
  expect(binding.session.source).toBe("obsidian-pdf");
  expect(service.borrowDocument("/vault/paper.pdf")).not.toBeNull();
});
