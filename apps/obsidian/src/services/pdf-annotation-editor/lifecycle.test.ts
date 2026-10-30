// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Scope,
  Stream,
} from "effect";
import { FileSystemAdapter, Scope as ObsidianScope } from "obsidian";
import type {
  App,
  PDFFileView,
  PDFViewerController,
  TFile,
  Vault,
  WorkspaceLeaf,
} from "obsidian";
import { beforeEach, afterEach, expect } from "vitest";
beforeEach(() => setMockPlatform({ isMacOS: false }));
afterEach(() => resetMockPlatform());

import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { stubService } from "@/lib/__fixtures__/service-stub";

import {
  annotationReads,
  attachmentReads,
  capabilityGestures,
  markGestures,
  pdfReader,
  readerSettings,
} from "./__fixtures__";
import { editorFixtureLayer } from "./__fixtures__/editor";
import { PdfAnnotationEditor } from "./service";

const host = () => {
  const workspace = new MemoryWorkspace();
  const reader = pdfReader();
  const controller = stubService<PDFViewerController>(
    "PDFViewerController",
    reader.child,
  );
  const view = stubService<PDFFileView>("PDFFileView", {
    file: null,
    leaf: undefined,
    app: stubService<App>("App", {}),
    viewer: { child: controller, then: (callback) => callback(controller) },
    containerEl: document.createElement("div"),
    scope: new ObsidianScope(),
  });
  workspace.leaves.set("pdf", [
    stubService<WorkspaceLeaf>("WorkspaceLeaf", { view }),
  ]);
  const app = stubService<App>("App", {
    vault: stubService<Vault>("Vault", { adapter: new FileSystemAdapter() }),
  });
  return { workspace, reader, view, app };
};

it.effect(
  "#1796 ends the session Stream and withdraws bindings when its layer closes",
  () =>
    Effect.gen(function* () {
      const h = host();
      const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const layer = editorFixtureLayer({
        app: h.app,
        workspace: h.workspace,
        attachments: attachmentReads(),
        annotations: annotationReads(),
        capabilityGestures: capabilityGestures(),
        markGestures: markGestures(),
        noteIndex: { getNotesByItemKey: () => Effect.succeed([]) },
        settings: readerSettings(),
      });
      const context = yield* Layer.build(layer).pipe(
        Effect.provideService(Scope.Scope, scope),
      );
      const editor = Context.get(context, PdfAnnotationEditor);
      const announced = yield* Stream.runCollect(editor.sessionAdded).pipe(
        Effect.forkScoped({ startImmediately: true }),
      );
      h.view.file = stubService<TFile>("TFile", {
        path: "attachments/rougier-2014.pdf",
      });
      h.workspace.layoutReady();
      expect(yield* editor.bindings).toHaveLength(1);
      yield* Scope.close(scope, Exit.succeed(undefined));
      expect(yield* editor.bindings).toEqual([]);
      expect(yield* Fiber.join(announced)).toEqual([
        "attachments/rougier-2014.pdf",
      ]);
      h.workspace.trigger("layout-change");
      expect(yield* editor.bindings).toEqual([]);
    }),
);

it.effect(
  "#1796 leaves a delayed layout callback inert after scope close",
  () =>
    Effect.gen(function* () {
      const h = host();
      const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const context = yield* Layer.build(
        editorFixtureLayer({
          app: h.app,
          workspace: h.workspace,
          attachments: attachmentReads(),
          annotations: annotationReads(),
          capabilityGestures: capabilityGestures(),
          markGestures: markGestures(),
          noteIndex: { getNotesByItemKey: () => Effect.succeed([]) },
          settings: readerSettings(),
        }),
      ).pipe(Effect.provideService(Scope.Scope, scope));
      const editor = Context.get(context, PdfAnnotationEditor);
      yield* Scope.close(scope, Exit.succeed(undefined));
      h.workspace.layoutReady();
      expect(yield* editor.bindings).toEqual([]);
    }),
);

it.effect(
  "#1796 interrupts a pending annotation read when the editor scope closes",
  () =>
    Effect.gen(function* () {
      const h = host();
      h.view.file = stubService<TFile>("TFile", {
        path: "attachments/rougier-2014.pdf",
      });
      const started = yield* Deferred.make<void>();
      const stopped = yield* Deferred.make<void>();
      const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const annotations = annotationReads();
      annotations.read.mockImplementation(() =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(stopped, undefined)),
        ),
      );
      const context = yield* Layer.build(
        editorFixtureLayer({
          app: h.app,
          workspace: h.workspace,
          attachments: attachmentReads({
            kind: "resolved",
            attachmentKey: "RGRPDF24",
            itemKey: "ROUG2014",
            serverID: null,
            openable: true,
          }),
          annotations,
          capabilityGestures: capabilityGestures(),
          markGestures: markGestures(),
          noteIndex: { getNotesByItemKey: () => Effect.succeed([]) },
          settings: readerSettings(),
        }),
      ).pipe(Effect.provideService(Scope.Scope, scope));
      const editor = Context.get(context, PdfAnnotationEditor);
      h.workspace.layoutReady();
      expect(annotations.read).toHaveBeenCalledOnce();
      yield* Deferred.await(started);
      const binding = (yield* editor.bindings)[0]!;
      yield* Scope.close(scope, Exit.succeed(undefined));
      yield* Deferred.await(stopped);
      yield* Effect.promise(() => binding.refreshed);
      expect(yield* editor.bindings).toEqual([]);
    }),
);
