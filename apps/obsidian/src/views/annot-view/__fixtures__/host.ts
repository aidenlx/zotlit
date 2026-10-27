import { Effect, Layer, Scope, Stream } from "effect";
import type * as Atom from "effect/reactivity/Atom";
// A view registry over controlled repository and Zotero services for annotation tests.
import { onTestFinished } from "vitest";

import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import type { HostSources } from "@/lib/__fixtures__/obsidian-host-app";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { layerUnreadViewServices } from "@/lib/__fixtures__/view-atoms";
import { openScope } from "@/lib/effect-scope";
import { makeViewRegistry } from "@/lib/view-atoms";
import { CapabilityNotices } from "@/services/annotation-repository/notices";
import { AnnotationRepository } from "@/services/annotation-repository/service";
import { ExcerptDisplays } from "@/services/excerpt-image/display";
import type {
  ExcerptImageDisplay,
} from "@/services/excerpt-image/display";
import { DEFAULT_LIBRARY_SCOPE } from "@/services/library-scope/scope";
import { LibraryScope } from "@/services/library-scope/service";
import { LocalServer } from "@/services/local-server/service";
import { AnnotationNoteActions } from "@/services/note-feature/view-actions";
import { NoteIndex } from "@/services/note-index/service";
import { annotationReads } from "@/services/pdf-annotation-editor/__fixtures__";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";
import {
  annotationDraftCommand,
  annotationWriteCommand,
  openExcerptDemandCommand,
  refreshExcerptDisplayCommand,
  copyCitationCommand,
} from "@/views/annot-view/atoms";
import { createAnnotStore } from "@/views/annot-view/model";

export const ANNOT_PATHS: ZoteroPrefSnapshot = {
  state: "ready",
  prefs: new Map(),
  resolvedProfileDir: null,
  profileDirOverride: null,
  dataDirOverride: null,
  dataDir: "/zotero",
  databasePath: "/zotero/zotero.sqlite",
  sourceId: null,
  baseAttachmentPath: null,
  httpPort: null,
};

export type AnnotHostOptions<R = never> = {
  annotations?: Partial<AnnotationRepository["Service"]>;
  holdCommands?: boolean;
  display?: Partial<ExcerptDisplays["Service"]>;
  notes?: Partial<AnnotationNoteActions["Service"]>;
  reads?: Partial<ZoteroReads["Service"]>;
  pref?: Partial<ZoteroPref["Service"]>;
  sources?: HostSources;
  services?: Layer.Layer<R>;
};

/** Annotation services shared by the card-only and Query View test hosts. */
export function layerAnnotServices<R = never>(
  options: AnnotHostOptions<R> = {},
) {
  const absentImage: ExcerptImageDisplay = {
    image: null,
    current: false,
    status: "absent",
  };
  return Layer.mergeAll(
    Layer.mock(
      ExcerptDisplays,
      stubService<ExcerptDisplays["Service"]>("ExcerptDisplays", {
        open: Effect.succeed({
          demand: () => {},
          release: () => {},
          subscribe: () => () => {},
          snapshot: () => absentImage,
        }),
        refresh: Effect.void,
        ...options.display,
      }),
    ),
    Layer.mock(AnnotationNoteActions, {
      citation: () => Effect.succeed({ kind: "not-in-database" }),
      insert: () => Effect.succeed({ kind: "cancelled" }),
      ...options.notes,
    }),
    Layer.mock(CapabilityNotices, {
      allowEditing: Effect.void,
      reportBlockedGesture: () => Effect.void,
    }),
    Layer.mock(AnnotationRepository, {
      ...annotationReads(),
      ...options.annotations,
    }),
    Layer.mock(ZoteroReads, {
      reads: stubService<ZoteroReads["Service"]["reads"]>("ZoteroReadsApi", {}),
      current: Effect.succeed({
        state: "ready" as const,
        error: null,
        moved: false,
        dbFileMissing: false,
        activeReadMode: null,
      }),
      changes: Stream.succeed({
        state: "ready" as const,
        error: null,
        moved: false,
        dbFileMissing: false,
        activeReadMode: null,
      }),
      events: Stream.empty,
      ...options.reads,
    }),
    Layer.mock(ZoteroPref, {
      current: Effect.succeed(ANNOT_PATHS),
      changes: Stream.succeed(ANNOT_PATHS),
      ...options.pref,
    }),
    Layer.mock(LocalServer, {
      availableChanges: Stream.succeed(false),
      readerTargetChanges: Stream.succeed(null),
      readerClosedChanges: Stream.succeed(false),
    }),
    Layer.mock(LibraryScope, {
      changes: Stream.succeed({
        current: null,
        all: null,
        invalid: false,
        effective: DEFAULT_LIBRARY_SCOPE,
        libraryRows: [],
      }),
    }),
    Layer.mock(NoteIndex, {
      changes: Stream.empty,
      getNotesByItemKey: () => Effect.succeed([]),
    }),
    options.services ?? Layer.empty,
  );
}

export function makeAnnotHost<R = never>(options: AnnotHostOptions<R> = {}) {
  const resource = openScope();
  const layer = Layer.mergeAll(
    layerUnreadViewServices,
    layerHost(options.sources),
    layerAnnotServices(options),
  );
  const context = Effect.runSync(
    Layer.build(layer).pipe(Effect.provideService(Scope.Scope, resource.scope)),
  );
  const registry = makeViewRegistry(context, { idleTTL: 0 });
  const commands: Atom.Atom<unknown>[] = [
    annotationDraftCommand,
    annotationWriteCommand,
    openExcerptDemandCommand,
    refreshExcerptDisplayCommand,
    copyCitationCommand,
  ];
  if (options.holdCommands !== false)
    for (const command of commands) registry.mount(command);
  return {
    registry,
    openCards: () => createAnnotStore(registry),
    async [Symbol.asyncDispose]() {
      registry.dispose();
      await resource.close();
    },
  };
}

/** Consumer fixtures close their view before the test releases its services. */
export function testAnnotHost<R = never>(
  options: Parameters<typeof makeAnnotHost<R>>[0] = {},
) {
  const host = makeAnnotHost(options);
  onTestFinished(() => host[Symbol.asyncDispose]());
  return host;
}
