// Keeps one guarded binding per open Obsidian PDF view on the layer's Scope.
import {
  Clock,
  Context,
  Effect,
  Layer,
  PubSub,
  Stream,
  SubscriptionRef,
} from "effect";
import type { PDFFileView, View, WorkspaceLeaf } from "obsidian";

import { scopedBridge, valueOr } from "@/lib/effect-bridge";
import { fromInstant, instantClock } from "@/lib/effect-clock";
import { withLogCategory } from "@/lib/effect-log";
import { forkEach } from "@/lib/effect-stream";
import { Vault } from "@/lib/obsidian-vault";
import { Workspace } from "@/lib/obsidian-workspace";
import { CapabilityNotices } from "@/services/annotation-repository/notices";
import { AnnotationRepository } from "@/services/annotation-repository/service";
import { AttachmentResolver } from "@/services/attachment-resolver/service";
import { libraryTagNames } from "@/services/database/library-tag-names";
import type {
  BorrowedExcerptDocument,
  ExcerptReaderDocuments,
} from "@/services/excerpt-image/reader-borrow";
import { NoteIndex } from "@/services/note-index/service";
import type { ReaderSession } from "@/services/reader-session/session";
import { PluginSettings } from "@/services/settings/service";
import { UseLedger } from "@/services/use-ledger/service";
import { writeReadUse } from "@/services/zotero-local-api/last-read";
import { ZoteroLocalApi } from "@/services/zotero-local-api/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { registerAnnotationAnchorCapture } from "./anchor-capture";
import { PdfViewBinding } from "./binding";
import { PdfReads } from "./reads";
import { openFileOf, PDF_VIEW_TYPE } from "./seam";
import type { MarkGestures } from "./selection";
import { toolColorStore } from "./tools";

export type { AttachmentResolution } from "@/services/attachment-resolver/service";
export type {
  ReaderSession,
  ReaderSessionTarget,
} from "@/services/reader-session/session";
export type {
  AnnotationReads,
  AttachmentReads,
  CapabilityGestures,
  CommentNotes,
  PdfViewBinding,
} from "./binding";
export type { MarkGestures } from "./selection";
export type { PdfSeamProbeId, PdfSeamProbeResult } from "./seam";

/** UI gestures and the late-bound reader port that breaks the Excerpt dependency cycle. */
export interface PdfAnnotationEditorPorts {
  revealAnnotation: MarkGestures["revealAnnotation"];
  blockedPress: (
    block: Parameters<MarkGestures["blockedPress"]>[0],
    showCapability: () => void,
  ) => void;
  readers: ExcerptReaderDocuments;
}

/** The live reader bindings and sessions owned by this plugin lifetime. */
export class PdfAnnotationEditor extends Context.Service<
  PdfAnnotationEditor,
  {
    readonly bindings: Effect.Effect<readonly PdfViewBinding[]>;
    readonly sessions: Stream.Stream<ReadonlyMap<View, ReaderSession>>;
    bindingFor(
      view: View | null | undefined,
    ): Effect.Effect<PdfViewBinding | null>;
    sessionFor(
      view: View | null | undefined,
    ): Effect.Effect<ReaderSession | null>;
    borrowDocument(
      absolutePath: string,
    ): Effect.Effect<BorrowedExcerptDocument | null>;
    readonly sessionAdded: Stream.Stream<string>;
  }
>()("zotlit/pdf-annotation-editor/PdfAnnotationEditor") {}

/** Acquires listeners before starting layout work; closing the Scope withdraws every binding. */
export const layerPdfAnnotationEditor = (ports: PdfAnnotationEditorPorts) =>
  Layer.effect(
    PdfAnnotationEditor,
    Effect.gen(function* () {
      const workspace = yield* Workspace;
      const vault = yield* Vault;
      const attachments = yield* AttachmentResolver;
      const annotations = yield* AnnotationRepository;
      const noteIndex = yield* NoteIndex;
      const settings = yield* PluginSettings;
      const ledger = yield* UseLedger;
      const zoteroReads = yield* ZoteroReads;
      const api = yield* ZoteroLocalApi;
      const notices = yield* CapabilityNotices;
      const bridge = yield* scopedBridge;
      const now = instantClock(yield* Clock.Clock);
      const events = yield* PubSub.unbounded<string>();
      const sessions = yield* SubscriptionRef.make<
        ReadonlyMap<View, ReaderSession>
      >(new Map());
      yield* Effect.addFinalizer(() => PubSub.shutdown(sessions.pubsub));
      yield* Effect.addFinalizer(() => PubSub.shutdown(events));
      const bindings = new Map<PDFFileView, PdfViewBinding>();
      const restoredViews = new WeakSet<PDFFileView>();
      let trackOpens = false;
      let retired = false;
      const colors = toolColorStore(settings, bridge);
      // PdfReads and the PDF.js bindings are callback edges until #1860.
      const reads = new PdfReads({
        now,
        record: ({ attachmentKey, itemKey, serverID, instant }) => {
          bridge.runSync(ledger.record(itemKey, "read", fromInstant(instant)));
          void bridge.runPromiseExit(
            writeReadUse({
              attachmentKey,
              serverID,
              instant: fromInstant(instant),
            }).pipe(
              Effect.provideService(ZoteroReads, zoteroReads),
              Effect.provideService(ZoteroLocalApi, api),
            ),
          );
        },
      });
      const showCapability = () =>
        bridge.runAndForget(notices.showEditingCapability);
      const unbind = (
        view: PDFFileView,
        binding: PdfViewBinding,
        { open }: { open: boolean },
      ) => {
        if (trackOpens) binding.close();
        if (!open || binding.filePath !== null) restoredViews.delete(view);
        binding[Symbol.dispose]();
        bindings.delete(view);
      };
      const reconcile = Effect.gen(function* () {
        if (retired) return;
        const views = (yield* workspace.leavesOfType(PDF_VIEW_TYPE)).map(
          (leaf) => leaf.view as PDFFileView,
        );
        const open = new Set(views);
        let changed = false;
        for (const [view, binding] of bindings) {
          if (
            open.has(view) &&
            binding.filePath === (openFileOf(view)?.path ?? null)
          )
            continue;
          unbind(view, binding, { open: open.has(view) });
          changed = true;
        }
        for (const view of views) {
          if (bindings.has(view)) continue;
          if (!trackOpens) restoredViews.add(view);
          const binding = new PdfViewBinding({
            view,
            adapter: {
              getFullPath: (path) => bridge.runSync(vault.fullPath(path))!,
            },
            attachments,
            annotations,
            bridge,
            capabilityGestures: {
              reportBlockedGesture: (key) =>
                bridge.runAndForget(notices.reportBlockedGesture(key)),
              allowEditing: showCapability,
            },
            markGestures: {
              revealAnnotation: ports.revealAnnotation,
              blockedPress: (block) =>
                ports.blockedPress(block, showCapability),
            },
            toolColors: colors,
            noteIndex,
            libraryTagNames: async (key) =>
              valueOr(
                await bridge.runPromiseExit(libraryTagNames(zoteroReads, key)),
                [],
              ),
            now,
            reads,
            openedAt: restoredViews.has(view) ? null : now(),
          });
          bindings.set(view, binding);
          changed = true;
          binding.load();
          if (binding.filePath) yield* PubSub.publish(events, binding.filePath);
        }
        if (changed)
          yield* SubscriptionRef.set(
            sessions,
            new Map(
              [...bindings].map(([view, binding]) => [view, binding.session]),
            ),
          );
      });
      const landAnchor = Effect.fnUntraced(function* (leaf: WorkspaceLeaf) {
        if (retired) return;
        const view = leaf.view as PDFFileView;
        const binding = bindings.get(view);
        if (!binding?.renamed) {
          binding?.land();
          return;
        }
        yield* Effect.logDebug(
          "An open named another Attachment of the bound file",
        ).pipe(
          withLogCategory("pdf-annotation-editor"),
          Effect.annotateLogs({
            path: binding.filePath,
            bound: binding.historyAttachment,
          }),
        );
        unbind(view, binding, { open: true });
        yield* reconcile;
      });
      const run = Effect.runSyncWith(yield* Effect.context<never>());
      yield* Effect.acquireDisposable(
        Effect.sync(() =>
          registerAnnotationAnchorCapture({
            onAnchor: (leaf) => run(landAnchor(leaf)),
          }),
        ),
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          retired = true;
          for (const binding of bindings.values()) binding[Symbol.dispose]();
          bindings.clear();
        }),
      );
      const bindingFor = Effect.fn("PdfAnnotationEditor.bindingFor")(
        (view: View | null | undefined) =>
          Effect.sync(() =>
            view ? (bindings.get(view as PDFFileView) ?? null) : null,
          ),
      );
      const borrowDocument = Effect.fn("PdfAnnotationEditor.borrowDocument")(
        (absolutePath: string) =>
          Effect.sync(() => {
            for (const binding of bindings.values()) {
              if (binding.absolutePath === absolutePath)
                return binding.borrow();
            }
            return null;
          }),
      );
      // Excerpts start below this layer. Their callback answers detached until
      // this layer acquires, and again once its bindings have been withdrawn.
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          ports.readers.borrow = (path) => run(borrowDocument(path));
        }),
        () =>
          Effect.sync(() => {
            ports.readers.borrow = () => null;
          }),
      );
      yield* forkEach(workspace.changes, (event) => {
        if (event._tag === "file-open" || event._tag === "layout-change")
          return reconcile;
        if (event._tag === "active-leaf-change" && event.leaf) {
          bindings.get(event.leaf.view as PDFFileView)?.activate();
        }
      });
      yield* workspace.layoutReady.pipe(
        Effect.andThen(reconcile),
        Effect.andThen(
          Effect.sync(() => {
            trackOpens = true;
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      );
      return PdfAnnotationEditor.of({
        bindings: Effect.sync(() => [...bindings.values()]).pipe(
          Effect.withSpan("PdfAnnotationEditor.bindings"),
        ),
        sessions: SubscriptionRef.changes(sessions),
        bindingFor,
        sessionFor: Effect.fn("PdfAnnotationEditor.sessionFor")((view) =>
          Effect.map(bindingFor(view), (binding) => binding?.session ?? null),
        ),
        borrowDocument,
        sessionAdded: Stream.fromPubSub(events),
      });
    }),
  );
