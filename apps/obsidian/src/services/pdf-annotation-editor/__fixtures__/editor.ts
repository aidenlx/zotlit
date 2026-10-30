// The real editor Layer behind the public Promise/DOM binding test seam.
import { Clock, DateTime, Effect, Layer } from "effect";
import type { App, FileSystemAdapter, View } from "obsidian";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import { Vault } from "@/lib/obsidian-vault";
import type { WorkspaceSource } from "@/lib/obsidian-workspace";
import { layerWorkspaceFrom } from "@/lib/obsidian-workspace";
import { CapabilityNotices } from "@/services/annotation-repository/notices";
import { AnnotationRepository } from "@/services/annotation-repository/service";
import { AttachmentResolver } from "@/services/attachment-resolver/service";
import { NoteIndex } from "@/services/note-index/service";
import { PluginSettings } from "@/services/settings/service";
import { UseLedger } from "@/services/use-ledger/service";
import { ZoteroLocalApi } from "@/services/zotero-local-api/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { PdfAnnotationEditor, layerPdfAnnotationEditor } from "@/services/pdf-annotation-editor/service";
import type {
  AnnotationReads,
  AttachmentReads,
  CapabilityGestures,
  MarkGestures,
} from "@/services/pdf-annotation-editor/service";

interface EditorFixtureOptions {
  app: App;
  workspace?: WorkspaceSource;
  attachments: AttachmentReads;
  annotations: AnnotationReads;
  capabilityGestures: CapabilityGestures;
  markGestures: Pick<MarkGestures, "blockedPress" | "revealAnnotation">;
  noteIndex: Pick<NoteIndex["Service"], "getNotesByItemKey">;
  settings: Pick<PluginSettings["Service"], "current" | "update">;
  now?: () => DateTime.Utc;
  recordUse?: (itemKey: string) => void;
  /** Where the editor's notices go; a fresh recording one unless given. */
  notifier?: ReturnType<typeof testNotifier>;
}

/** The actual layer; only its external services have typed test substitutes. */
export function editorFixtureLayer(options: EditorFixtureOptions) {
  const deps = Layer.mergeAll(
    layerWorkspaceFrom(options.workspace ?? options.app.workspace),
    (options.notifier ?? testNotifier()).layer,
    Layer.mock(Vault, {
      fullPath: (path) =>
        Effect.sync(() =>
          (options.app.vault.adapter as FileSystemAdapter).getFullPath(path),
        ),
    }),
    Layer.mock(AttachmentResolver, options.attachments),
    Layer.mock(AnnotationRepository, options.annotations),
    Layer.mock(NoteIndex, options.noteIndex),
    Layer.mock(PluginSettings, options.settings),
    Layer.mock(UseLedger, {
      record: (key, kind, instant) =>
        Effect.sync(() => {
          options.recordUse?.(key);
          return { kind, instant: instant ?? DateTime.makeUnsafe(0) };
        }),
    }),
    Layer.mock(ZoteroReads, {
      reads: stubService<ZoteroReads["Service"]["reads"]>("ZoteroReadsApi", {}),
    }),
    Layer.mock(ZoteroLocalApi, {
      state: Effect.succeed({ kind: "probing" } as const),
    }),
    Layer.mock(CapabilityNotices, {
      reportBlockedGesture: (key) =>
        Effect.sync(() => options.capabilityGestures.reportBlockedGesture(key)),
      showEditingCapability: Effect.sync(() =>
        options.capabilityGestures.allowEditing(),
      ),
    }),
  );
  const layer = layerPdfAnnotationEditor({
    readers: { borrow: () => null },
    revealAnnotation: options.markGestures.revealAnnotation,
    blockedPress: options.markGestures.blockedPress,
  }).pipe(Layer.provide(deps));
  return options.now
    ? layer.pipe(
        Layer.provide(
          Layer.effect(
            Clock.Clock,
            Effect.map(Clock.Clock, (clock) => ({
              currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
              currentTimeNanos: clock.currentTimeNanos,
              monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
              monotonicTimeNanos: clock.monotonicTimeNanos,
              sleep: (duration) => clock.sleep(duration),
              currentTimeMillisUnsafe: () => DateTime.toEpochMillis(options.now!()),
              currentTimeMillis: Effect.sync(
                () => DateTime.toEpochMillis(options.now!()),
              ),
            })),
          ),
        ),
      )
    : layer;
}

export async function openPdfEditor(options: EditorFixtureOptions) {
  await using stack = new AsyncDisposableStack();
  const runtime = buildRuntime(editorFixtureLayer(options), stack);
  await runtime.context();
  const service = runtime.runSync(PdfAnnotationEditor);
  const bridge = effectBridge(runtime);
  const owned = stack.move();
  return {
    service,
    runtime,
    get bindings() {
      return bridge.runSync(service.bindings);
    },
    bindingFor: (view: View | null | undefined) =>
      bridge.runSync(service.bindingFor(view)),
    sessionFor: (view: View | null | undefined) =>
      bridge.runSync(service.sessionFor(view)),
    borrowDocument: (path: string) =>
      bridge.runSync(service.borrowDocument(path)),
    subscribe: (callback: (path: string) => void) =>
      bridge.subscribe(service.sessionAdded, callback),
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  };
}
