// A Citation Popover built from its real layer over test-owned service reads.
import type { App, TFile } from "obsidian";

import { layerHostApp } from "@/lib/__fixtures__/obsidian-host-app";
import { MemoryMetadataCache } from "@/lib/__fixtures__/obsidian-metadata-cache";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { Effect, Layer, Stream } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import type {
  CitationLookupAnswer,
  CitationLookupRequest,
} from "@/services/citation-index/lookup";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import type { CitationLookupStatus } from "@/services/citation-index/lookup-service";
import { CitationIndex } from "@/services/citation-index/service";
import type { DocumentCitationSet } from "@/services/citation-index/service";
import { CitationText } from "@/services/citation-text/service";
import type { DocumentCitations } from "@/services/citation-text/service";
import type { ResolvedLibraryScope } from "@/services/library-scope/scope";
import { LibraryScope } from "@/services/library-scope/service";
import type { EffectivePresentation } from "@/services/pandoc/document-presentation";
import { BibliographyRender } from "@/services/pandoc/render-cache";
import type {
  BibliographyRenderOutcome,
  BibliographyRenderResult,
  RenderPresentation,
} from "@/services/pandoc/render-cache";
import { Profile } from "@/services/profile/service";
import type { ProfileReader } from "@/services/profile/service";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type {
  ZoteroReadLease,
  ZoteroReadsApi,
  ZoteroReadsState,
} from "@/services/zotero-reads/service";

import { layerCitationPopover, CitationPopover } from "./service";

interface PopoverFixtureDeps {
  app: App | Record<string, unknown>;
  db: {
    state: ZoteroReadsState["state"];
    reads?: ZoteroReadsApi;
    acquireRead(): Promise<ZoteroReadLease>;
  };
  citationLookup: {
    status: CitationLookupStatus;
    read?(
      request: CitationLookupRequest,
      options?: { signal?: AbortSignal },
    ): Promise<CitationLookupAnswer>;
    changed?: Stream.Stream<void>;
    "status-changed"?: Stream.Stream<void>;
  };
  citationIndex?: {
    getDocumentCitationSet(
      file: TFile,
      options: {
        signal?: AbortSignal;
        include?: { citekeys?: readonly string[] };
      },
    ): Promise<unknown>;
  };
  libraryScope: { current: unknown };
  citationText?: {
    read(
      path: string,
      options: { signal: AbortSignal },
    ): Promise<DocumentCitations | null>;
  };
  profile: ProfileReader;
  bibliographyRender: {
    changed?: Stream.Stream<unknown>;
    settled?: Stream.Stream<unknown>;
    "style-missing"?: Stream.Stream<string>;
    vaultPresentation?: EffectivePresentation;
    render?(
      items: Parameters<BibliographyRender["Service"]["render"]>[0],
      presentation?: RenderPresentation,
    ): Promise<unknown>;
    readBibliography?(
      items: Parameters<BibliographyRender["Service"]["readBibliography"]>[0],
      options: { signal: AbortSignal },
    ): Promise<unknown>;
    invalidated?: Stream.Stream<void>;
  };
}

export interface CitationPopoverFixture extends AsyncDisposable {
  service: CitationPopover["Service"];
  runtime: ManagedRuntime.ManagedRuntime<CitationPopover, never>;
}

const READS_IDLE: Omit<ZoteroReadsState, "state"> = {
  error: null,
  moved: false,
  dbFileMissing: false,
  activeReadMode: null,
};

/** The popover layer over the reads each test scenario supplies. */
export function citationPopoverFixture(
  deps: PopoverFixtureDeps,
): CitationPopoverFixture {
  const stack = new AsyncDisposableStack();
  // A host without a metadata cache gets an empty in-memory one.
  const app = {
    metadataCache: new MemoryMetadataCache(),
    ...deps.app,
  } as unknown as App;
  let revision = 0;
  const lookupState = () => ({
    status: deps.citationLookup.status,
    revision: String(revision),
    stopped: false,
  });
  const layer = layerCitationPopover.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerHostApp(app),
        Layer.succeed(
          ZoteroReads,
          stubService<ZoteroReads["Service"]>("ZoteroReads", {
            current: Effect.sync(() => ({
              ...READS_IDLE,
              state: deps.db.state,
            })),
            reads:
              deps.db.reads ??
              ({
                ItemsByIndexedKeys: () => Effect.succeed(new Map()),
              } as unknown as ZoteroReadsApi),
            snapshot: Effect.acquireRelease(
              Effect.tryPromise({
                try: () => deps.db.acquireRead(),
                catch: (error) =>
                  new DbUnavailable({
                    message:
                      error instanceof Error ? error.message : String(error),
                  }),
              }),
              (lease) => Effect.promise(() => lease[Symbol.asyncDispose]()),
            ).pipe(Effect.map((lease) => lease.reads)),
          }),
        ),
        Layer.succeed(
          CitationLookup,
          stubService<CitationLookup["Service"]>("CitationLookup", {
            current: Effect.sync(lookupState),
            changes: Stream.concat(
              Stream.succeed(lookupState()),
              (deps.citationLookup.changed ?? Stream.empty).pipe(
                Stream.map(() => {
                  revision += 1;
                  return lookupState();
                }),
              ),
            ),
            read: (request) =>
              deps.citationLookup.read
                ? Effect.promise(() => deps.citationLookup.read!(request))
                : Effect.promise(() =>
                    Promise.reject(new Error("CitationLookup stub lacks read")),
                  ),
          }),
        ),
        Layer.succeed(
          CitationIndex,
          stubService<CitationIndex["Service"]>("CitationIndex", {
            getDocumentCitationSet: (file, options) => {
              if (!deps.citationIndex)
                throw new Error(
                  "CitationIndex stub lacks getDocumentCitationSet",
                );
              return Effect.promise(() =>
                deps.citationIndex!.getDocumentCitationSet(file, options ?? {}),
              ).pipe(Effect.map((value) => value as DocumentCitationSet));
            },
          }),
        ),
        Layer.succeed(
          LibraryScope,
          stubService<LibraryScope["Service"]>("LibraryScope", {
            current: Effect.sync(
              () => deps.libraryScope.current as ResolvedLibraryScope | null,
            ),
          }),
        ),
        Layer.succeed(
          CitationText,
          stubService<CitationText["Service"]>("CitationText", {
            read: (path, options) =>
              Effect.promise(() =>
                deps.citationText
                  ? deps.citationText.read(path, {
                      signal: options?.signal ?? new AbortController().signal,
                    })
                  : Promise.resolve(null),
              ).pipe(Effect.map((value) => value as DocumentCitations | null)),
          }),
        ),
        Layer.succeed(
          BibliographyRender,
          stubService<BibliographyRender["Service"]>("BibliographyRender", {
            state: Effect.sync(() => ({
              vaultPresentation: deps.bibliographyRender.vaultPresentation ?? {
                styleId: null,
                locale: null,
              },
              missingStyle: null,
            })),
            events: (deps.bibliographyRender.invalidated ?? Stream.empty).pipe(
              Stream.map(() => ({ _tag: "invalidated" as const })),
            ),
            render: (items, presentation) =>
              Effect.promise(() =>
                deps.bibliographyRender.render
                  ? deps.bibliographyRender.render(items, presentation)
                  : Promise.resolve({
                      kind: "unavailable",
                      reason: "engine-absent",
                    } as const),
              ).pipe(Effect.map((value) => value as BibliographyRenderOutcome)),
            readBibliography: (items, options) =>
              Effect.promise(() =>
                deps.bibliographyRender.readBibliography
                  ? deps.bibliographyRender.readBibliography(items, {
                      signal: options?.signal ?? new AbortController().signal,
                    })
                  : Promise.resolve(null),
              ).pipe(
                Effect.map((value) => value as BibliographyRenderResult | null),
              ),
          }),
        ),
        Layer.succeed(
          Profile,
          stubService<Profile["Service"]>("Profile", {
            loaded: Effect.sync(() => deps.profile.loaded),
            profileOf: (file) =>
              Effect.sync(() => deps.profile.profileOf(file)),
          }),
        ),
      ),
    ),
  );
  const runtime = buildRuntime(layer, stack);
  const service = runtime.runSync(CitationPopover);
  const owned = stack.move();
  return {
    service,
    runtime,
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  };
}
