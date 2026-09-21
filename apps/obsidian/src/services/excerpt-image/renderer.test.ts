// Host doubles measure resource ownership without allocating a browser canvas or a large PDF.
import { open } from "node:fs/promises";
import { loadPdfJs } from "obsidian";
import { expect, it, vi } from "vitest";

import { redPng } from "./__fixtures__/png";
import { ExcerptRenderer } from "./renderer";
import { ExcerptImageService } from "./service";
import type { ExcerptRequest } from "./service";

vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  open: vi.fn(),
}));
vi.mock("obsidian", async (original) => ({
  ...(await original<typeof import("obsidian")>()),
  loadPdfJs: vi.fn(),
}));

function fixture() {
  const started = Promise.withResolvers<void>();
  const destroyStarted = Promise.withResolvers<void>();
  const never = new Promise<never>(() => {});
  const state = {
    bytes: new Uint8Array([1, 2, 3, 4]),
    size: 4,
    mtimeMs: 1,
    stage: "" as "" | "load" | "page" | "render" | "encode",
    scheduling: "supported" as
      | "supported"
      | "missing"
      | "duplicate"
      | "flag"
      | "frozen",
    width: 100,
    height: 50,
    afterRead: () => {},
    destroyGate: undefined as Promise<void> | undefined,
  };
  const files: {
    close: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
  }[] = [];
  vi.mocked(open).mockImplementation(async () => {
    const file = {
      stat: async () => ({ size: state.size, mtimeMs: state.mtimeMs }),
      read: vi.fn(
        async (
          ...[target, offset, length, position]: [
            Uint8Array,
            number,
            number,
            number,
          ]
        ) => {
          const part = state.bytes.subarray(position, position + length);
          target.set(part, offset);
          state.afterRead();
          return { bytesRead: part.length, buffer: target };
        },
      ),
      close: vi.fn(async () => {}),
      async [Symbol.asyncDispose]() {
        await this.close();
      },
    };
    files.push(file);
    return file as unknown as Awaited<ReturnType<typeof open>>;
  });
  const canvases: { width: number; height: number }[] = [];
  const measured: [number, number][] = [];
  const tasks: { cancel: ReturnType<typeof vi.fn>; promise: Promise<void> }[] =
    [];
  const foreign = {
    task: { cancel: vi.fn() },
    _useRequestAnimationFrame: true,
  };
  const owned: { task: unknown; _useRequestAnimationFrame: boolean }[] = [];
  const destroys: ReturnType<typeof vi.fn>[] = [];
  const pageCleanups: ReturnType<typeof vi.fn>[] = [];
  const pages = vi.fn(async () => {
    if (state.stage === "page") {
      started.resolve();
      await never;
    }
    const intents = new Map<number, { renderTasks: Set<unknown> }>();
    const cleanup = vi.fn(() => true);
    pageCleanups.push(cleanup);
    return {
      view: [0, 0, state.width, state.height],
      cleanup,
      getViewport: ({
        scale,
        offsetX = 0,
        offsetY = 0,
      }: {
        scale: number;
        offsetX?: number;
        offsetY?: number;
      }) => ({
        convertToViewportPoint: (x: number, y: number): [number, number] => [
          x * scale + offsetX,
          y * scale + offsetY,
        ],
      }),
      _intentStates: intents,
      render: () => {
        const task = {
          promise: state.stage === "render" ? never : Promise.resolve(),
          cancel: vi.fn(),
          set onContinue(callback: (continueCallback: () => void) => void) {
            queueMicrotask(() => callback(() => undefined));
          },
        };
        tasks.push(task);
        const candidate = { task, _useRequestAnimationFrame: true };
        owned.push(candidate);
        if (state.scheduling === "flag")
          Object.assign(candidate, { _useRequestAnimationFrame: "yes" });
        if (state.scheduling === "frozen") Object.freeze(candidate);
        intents.set(1, {
          renderTasks: new Set(
            state.scheduling === "missing" ? [foreign] : [foreign, candidate],
          ),
        });
        if (state.scheduling === "duplicate")
          intents.set(2, { renderTasks: new Set([candidate]) });
        if (state.stage === "render") started.resolve();
        return task;
      },
    };
  });
  const load = vi.fn(async () => ({
    getDocument: getDocument,
  }));
  const getDocument = vi.fn(() => {
    const destroy = vi.fn(async () => {
      destroyStarted.resolve();
      await state.destroyGate;
    });
    destroys.push(destroy);
    if (state.stage === "load") started.resolve();
    return {
      promise:
        state.stage === "load" ? never : Promise.resolve({ getPage: pages }),
      destroy,
    };
  });
  const deadlines: { milliseconds: number; controller: AbortController }[] = [];
  const canvas = () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({}),
      toBlob(callback: (blob: Blob) => void) {
        measured.push([this.width, this.height]);
        if (state.stage === "encode") {
          started.resolve();
          return;
        }
        callback(new Blob([new Uint8Array([137, 80, 78, 71])]));
      },
    };
    canvases.push(canvas);
    return canvas as unknown as HTMLCanvasElement;
  };
  const renderer = new ExcerptRenderer({
    load,
    deadline: (milliseconds) => {
      const controller = new AbortController();
      deadlines.push({ milliseconds, controller });
      return controller.signal;
    },
    canvas,
  });
  const request: ExcerptRequest = {
    annotation: {
      key: "ANNOT001",
      parentKey: "ATTACH01",
      type: "image",
      color: null,
      text: null,
      comment: null,
      pageLabel: "1",
      tags: [],
      version: 1,
      position: { kind: "pdf-rects", pageIndex: 0, rects: [[0, 0, 100, 50]] },
    },
    source: { kind: "zotero-local-api", serverID: "SERVER" },
    sourceScope: "/zotero",
    libraryID: 1,
    attachmentKey: "ATTACH01",
    pdfPath: "/paper.pdf",
    zoteroPngPath: null,
  };
  return {
    state,
    destroyStarted,
    request,
    started,
    files,
    renderer,
    tasks,
    foreign,
    owned,
    destroys,
    load,
    getDocument,
    pages,
    pageCleanups,
    canvases,
    canvas,
    measured,
    deadlines,
    render: (input = request, signal = new AbortController().signal) =>
      renderer.render(input, signal),
    async [Symbol.asyncDispose]() {
      await renderer[Symbol.asyncDispose]();
    },
  };
}

it("loads one document for distinct annotations and closes it once at shutdown", async () => {
  await using f = fixture();
  await f.render();
  await f.render({
    ...f.request,
    annotation: {
      ...f.request.annotation,
      key: "ANNOT002",
      position: { kind: "pdf-rects", pageIndex: 2, rects: [[10, 10, 30, 40]] },
    },
  });
  expect(f.getDocument).toHaveBeenCalledTimes(1);
  expect(f.pages.mock.calls).toEqual([[1], [3]]);
  expect(f.pageCleanups.map((cleanup) => cleanup.mock.calls.length)).toEqual([
    1, 1,
  ]);
  expect(f.files.map((file) => file.read.mock.calls.length)).toEqual([2, 0]);
  expect(f.files.every((file) => file.close.mock.calls.length === 1)).toBe(
    true,
  );
  expect(f.tasks.every((task) => task.cancel.mock.calls.length === 1)).toBe(
    true,
  );
  expect(f.canvases).toEqual([
    {
      width: 0,
      height: 0,
      getContext: expect.any(Function),
      toBlob: expect.any(Function),
    },
    {
      width: 0,
      height: 0,
      getContext: expect.any(Function),
      toBlob: expect.any(Function),
    },
  ]);
  expect(f.destroys[0]).not.toHaveBeenCalled();
  await f.renderer[Symbol.asyncDispose]();
  expect(f.destroys[0]).toHaveBeenCalledTimes(1);
});

it("reuses its renderer within one operation and releases it when the operation ends", async () => {
  await using f = fixture();
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => {
    vi.unstubAllGlobals();
  });
  vi.stubGlobal("document", { createElement: f.canvas });
  vi.mocked(loadPdfJs).mockImplementation(f.load);
  const service = cleanup.use(
    new ExcerptImageService({
      stamp: async () => ({ size: 4, mtimeMs: 1 }),
    }),
  );
  {
    await using operation = service.operation();
    expect(await operation.resolve(f.request)).toMatchObject({
      provenance: "rendered",
    });
    expect(
      await operation.resolve({
        ...f.request,
        annotation: { ...f.request.annotation, key: "ANNOT002" },
      }),
    ).toMatchObject({ provenance: "rendered" });
    expect(f.getDocument).toHaveBeenCalledTimes(1);
    expect(f.tasks).toHaveLength(2);
    expect(f.destroys[0]).not.toHaveBeenCalled();
  }
  expect(f.destroys[0]).toHaveBeenCalledTimes(1);
  expect(service.rendererDiagnostics?.snapshot().documentOpen).toBe(false);
});

it("releases its renderer after a standalone resolution", async () => {
  await using f = fixture();
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => {
    vi.unstubAllGlobals();
  });
  vi.stubGlobal("document", { createElement: f.canvas });
  vi.mocked(loadPdfJs).mockImplementation(f.load);
  const service = cleanup.use(
    new ExcerptImageService({
      stamp: async () => ({ size: 4, mtimeMs: 1 }),
    }),
  );
  expect(await service.resolve(f.request)).toMatchObject({
    provenance: "rendered",
  });
  expect(f.destroys[0]).toHaveBeenCalledTimes(1);
  expect(service.rendererDiagnostics?.snapshot().documentOpen).toBe(false);
});

it.each(["scope", "source", "library", "attachment", "path", "stamp"])(
  "replaces the resident document on %s changes",
  async (change) => {
    await using f = fixture();
    await f.render();
    const next = structuredClone(f.request);
    if (change === "scope") next.sourceScope = "/other";
    if (change === "source")
      next.source = { kind: "zotero-local-api", serverID: "OTHER" };
    if (change === "library") next.libraryID = 2;
    if (change === "attachment") next.attachmentKey = "ATTACH02";
    if (change === "path") next.pdfPath = "/other.pdf";
    if (change === "stamp") f.state.mtimeMs++;
    await f.render(next);
    expect(f.getDocument).toHaveBeenCalledTimes(2);
    expect(f.destroys[0]).toHaveBeenCalledTimes(1);
    expect(f.destroys[1]).not.toHaveBeenCalled();
  },
);

it("rejects an oversized open file before allocating or loading PDF.js", async () => {
  await using f = fixture();
  f.state.size = 256 * 1024 * 1024 + 1;
  await expect(f.render()).rejects.toThrow("byte limit");
  expect(f.files[0]!.read).not.toHaveBeenCalled();
  expect(f.files[0]!.close).toHaveBeenCalledTimes(1);
  expect(f.load).not.toHaveBeenCalled();
});

it.each(["growth", "shrink", "mtime"])(
  "rejects a PDF that changes during its bounded read (%s)",
  async (change) => {
    await using f = fixture();
    f.state.afterRead = () => {
      if (change === "growth") {
        f.state.bytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
        f.state.size = 6;
      }
      if (change === "shrink") f.state.size = 3;
      if (change === "mtime") f.state.mtimeMs++;
    };
    await expect(f.render()).rejects.toThrow("changed while reading");
    expect(f.files[0]!.read.mock.calls[0]![0]).toHaveLength(5);
    expect(f.files[0]!.close).toHaveBeenCalledTimes(1);
    expect(f.load).not.toHaveBeenCalled();
  },
);

it.each([
  { width: 100, height: 50, expected: [400, 200] },
  { width: 100_000, height: 100_000, expected: [4096, 4096] },
  { width: 100_000, height: 10, expected: [8192, 1] },
])(
  "bounds a $width × $height excerpt before canvas allocation",
  async ({ width, height, expected }) => {
    await using f = fixture();
    f.state.width = width;
    f.state.height = height;
    f.request.annotation.position = {
      kind: "pdf-rects",
      pageIndex: 0,
      rects: [[0, 0, width, height]],
    };
    await f.render();
    expect(f.measured).toEqual([expected]);
  },
);

it.each(["load", "page", "render", "encode"] as const)(
  "cancellation during %s closes only owned resources and permits a fresh load",
  async (stage) => {
    await using f = fixture();
    f.state.stage = stage;
    const controller = new AbortController();
    const pending = f.render(f.request, controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await f.started.promise;
    controller.abort();
    await rejection;
    expect(f.destroys[0]).toHaveBeenCalledTimes(1);
    expect(f.tasks.every((task) => task.cancel.mock.calls.length === 1)).toBe(
      true,
    );
    expect(
      f.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0),
    ).toBe(true);
    f.state.stage = "";
    await f.render();
    expect(f.getDocument).toHaveBeenCalledTimes(2);
  },
);

it.each([
  { phase: "pdf-reading", stage: "" },
  { phase: "document-loading", stage: "load" },
  { phase: "page-rendering", stage: "render" },
] as const)(
  "reports and releases the $phase diagnostic lifecycle",
  async ({ phase, stage }) => {
    await using f = fixture();
    f.state.stage = stage;
    f.renderer.diagnostics.hold(phase);
    const controller = new AbortController();
    const pending = f.render(f.request, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() => {
      expect(f.renderer.diagnostics.snapshot().phase).toBe(phase);
    });
    const active = f.renderer.diagnostics.snapshot();
    expect(active.jobActive).toBe(true);
    expect(active.fileOpen).toBe(phase !== "page-rendering");
    if (phase === "document-loading") {
      expect(active.documentOpen).toBe(true);
      expect(active.worker).toBe("pending");
    }
    if (phase === "page-rendering") {
      expect(active).toMatchObject({
        documentOpen: true,
        renderTaskActive: true,
        canvas: { width: 400, height: 200 },
      });
    }
    controller.abort();
    f.renderer.diagnostics.release();
    await rejected;
    expect(f.renderer.diagnostics.snapshot()).toMatchObject({
      phase: "idle",
      jobActive: false,
      fileOpen: false,
      documentOpen: false,
      renderTaskActive: false,
      canvas: null,
    });
    if (phase === "page-rendering")
      expect(f.renderer.diagnostics.snapshot().lastCanvas).toEqual({
        width: 0,
        height: 0,
      });
  },
);

it("releases a diagnostic gate and every resource at shutdown", async () => {
  await using f = fixture();
  f.state.stage = "render";
  f.renderer.diagnostics.hold("page-rendering");
  const pending = f.render();
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  await vi.waitFor(() => {
    expect(f.renderer.diagnostics.snapshot().phase).toBe("page-rendering");
  });
  const shutdown = f.renderer[Symbol.asyncDispose]();
  await rejected;
  await shutdown;
  expect(f.renderer.diagnostics.snapshot()).toMatchObject({
    phase: "idle",
    jobActive: false,
    fileOpen: false,
    documentOpen: false,
    renderTaskActive: false,
    canvas: null,
    lastCanvas: { width: 0, height: 0 },
  });
});

it.each(["missing", "duplicate", "flag", "frozen"] as const)(
  "unsupported scheduling (%s) cleans up and falls back without touching another task",
  async (shape) => {
    await using f = fixture();
    f.state.scheduling = shape;
    await using service = new ExcerptImageService({
      stamp: async () => ({ size: 4, mtimeMs: 1 }),
      render: (request, signal) => f.renderer.render(request, signal),
      read: async () => redPng,
    });
    expect(
      await service.resolve({ ...f.request, zoteroPngPath: "/zotero.png" }),
    ).toMatchObject({ provenance: "zotero", freshness: "uncertain" });
    expect(f.foreign._useRequestAnimationFrame).toBe(true);
    expect(f.foreign.task.cancel).not.toHaveBeenCalled();
    expect(f.tasks[0]!.cancel).toHaveBeenCalledTimes(1);
    expect(f.destroys[0]).toHaveBeenCalledTimes(1);
    expect(f.canvases[0]).toMatchObject({ width: 0, height: 0 });
  },
);

it("changes only the owned task's scheduling and preserves the resident PDF", async () => {
  await using f = fixture();
  await f.render();
  expect(f.owned[0]!._useRequestAnimationFrame).toBe(false);
  expect(f.foreign._useRequestAnimationFrame).toBe(true);
  expect(f.foreign.task.cancel).not.toHaveBeenCalled();
  expect(f.destroys[0]).not.toHaveBeenCalled();
});

it.each(["next request", "shutdown"])(
  "holds late-open cleanup before %s",
  async (action) => {
    await using f = fixture();
    const opened = Promise.withResolvers<void>();
    const releaseOpen = Promise.withResolvers<void>();
    const closing = Promise.withResolvers<void>();
    const releaseClose = Promise.withResolvers<void>();
    const original = vi.mocked(open).getMockImplementation()!;
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      opened.resolve();
      await releaseOpen.promise;
      const file = await original(...args);
      file.close = vi.fn(async () => {
        closing.resolve();
        await releaseClose.promise;
      });
      return file;
    });
    const render = vi.fn((request: ExcerptRequest, signal: AbortSignal) =>
      f.renderer.render(request, signal),
    );
    await using service = new ExcerptImageService({ render });
    const controller = new AbortController();
    const first = service.resolve(f.request, controller.signal);
    const rejected = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    await opened.promise;
    controller.abort();
    await rejected;
    let completed = false;
    const completion = (
      action === "shutdown"
        ? service[Symbol.asyncDispose]()
        : service.resolve({
            ...f.request,
            annotation: { ...f.request.annotation, key: "NEXT0001" },
          })
    ).then(() => {
      completed = true;
    });
    try {
      releaseOpen.resolve();
      await closing.promise;
      expect(completed).toBe(false);
      expect(render).toHaveBeenCalledTimes(1);
      expect(f.getDocument).not.toHaveBeenCalled();
    } finally {
      releaseClose.resolve();
    }
    await completion;
    expect(f.files[0]!.close).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(action === "shutdown" ? 1 : 2);
  },
);

it("bounds a stuck render and teardown, then refuses another resident document", async () => {
  await using f = fixture();
  f.state.stage = "render";
  f.state.destroyGate = new Promise(() => {});
  const pending = f.render();
  const rejection = expect(pending).rejects.toThrow("render deadline");
  await f.started.promise;
  f.deadlines
    .find(({ milliseconds }) => milliseconds === 30_000)!
    .controller.abort(new Error("render deadline"));
  await f.destroyStarted.promise;
  f.deadlines
    .findLast(({ milliseconds }) => milliseconds === 5_000)!
    .controller.abort(new Error("close deadline"));
  await rejection;
  await expect(f.render()).rejects.toThrow("closed");
  expect(f.getDocument).toHaveBeenCalledTimes(1);
  expect(f.tasks[0]!.cancel).toHaveBeenCalledTimes(1);
  expect(f.canvases[0]).toMatchObject({ width: 0, height: 0 });
});
