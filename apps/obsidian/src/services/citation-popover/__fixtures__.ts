// A Citation Popover built from its real layer over test-owned service reads.
import { Effect, Layer, Stream } from "effect";
import type { ManagedRuntime } from "effect";
import type { TFile } from "obsidian";

import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import type { HostSources } from "@/lib/__fixtures__/obsidian-host-app";
import { stubService } from "@/lib/__fixtures__/service-stub";
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
} from "@/services/zotero-reads/service";
import { ShowInLibrary } from "@/views/library/show-in-library";

import { layerCitationPopover, CitationPopover } from "./service";

export interface CitationPopoverFixtureDeps {
  /** The Obsidian objects the capability tags read; a missing one is empty. */
  host: HostSources;
  db: {
    current: ZoteroReads["Service"]["current"];
    reads?: ZoteroReadsApi;
    acquireRead(): Promise<ZoteroReadLease>;
  };
  services?: {
    citationLookup?: CitationLookup["Service"];
    citationIndex?: CitationIndex["Service"];
    citationText?: CitationText["Service"];
    bibliographyRender?: BibliographyRender["Service"];
  };
  citationLookup?: {
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
  /** Receives each Show in Library of the popover. */
  showInLibrary?: (indexedKey: string) => void;
  citationText?: {
    read(
      path: string,
      options: { signal: AbortSignal },
    ): Promise<DocumentCitations | null>;
  };
  profile: ProfileReader;
  bibliographyRender?: {
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

/**
 * The popover layer over the reads each test scenario supplies.
 *
 * @param options.logs a Logger layer that takes the layer's Effect logs in
 *   place of the plugin's loggers.
 */
export function citationPopoverFixture(
  deps: CitationPopoverFixtureDeps,
  options: { logs?: Layer.Layer<never> } = {},
): CitationPopoverFixture {
  const stack = new AsyncDisposableStack();
  const citationLookup = deps.citationLookup ?? { status: "fresh" as const };
  const bibliographyRender = deps.bibliographyRender ?? {};
  let revision = 0;
  const lookupState = () => ({
    status: citationLookup.status,
    revision: String(revision),
    stopped: false,
  });
  const layer = layerCitationPopover.pipe(
    Layer.provide(
      Layer.mergeAll(
        options.logs ?? Layer.empty,
        layerHost(deps.host),
        Layer.succeed(
          ShowInLibrary,
          ShowInLibrary.of({
            show: (indexedKey) =>
              Effect.sync(() => deps.showInLibrary?.(indexedKey)),
          }),
        ),
        Layer.succeed(
          ZoteroReads,
          stubService<ZoteroReads["Service"]>("ZoteroReads", {
            current: deps.db.current,
            reads:
              deps.db.reads ??
              Object.assign(stubService<ZoteroReadsApi>("ZoteroReadsApi", {}), {
                ItemsByIndexedKeys: () => Effect.succeed(new Map()),
              }),
            snapshot: Effect.acquireDisposable(
              Effect.tryPromise({
                try: () => deps.db.acquireRead(),
                catch: (error) =>
                  new DbUnavailable({
                    message:
                      error instanceof Error ? error.message : String(error),
                  }),
              }),
            ).pipe(Effect.map((lease) => lease.reads)),
          }),
        ),
        Layer.succeed(
          CitationLookup,
          deps.services?.citationLookup ??
            stubService<CitationLookup["Service"]>("CitationLookup", {
              current: Effect.sync(lookupState),
              changes: Stream.concat(
                Stream.succeed(lookupState()),
                (citationLookup.changed ?? Stream.empty).pipe(
                  Stream.map(() => {
                    revision += 1;
                    return lookupState();
                  }),
                ),
              ),
              read: (request) =>
                citationLookup.read
                  ? Effect.promise(() => citationLookup.read!(request))
                  : Effect.promise(() =>
                      Promise.reject(
                        new Error("CitationLookup stub lacks read"),
                      ),
                    ),
            }),
        ),
        Layer.succeed(
          CitationIndex,
          deps.services?.citationIndex ??
            stubService<CitationIndex["Service"]>("CitationIndex", {
              getDocumentCitationSet: (file, options) => {
                if (!deps.citationIndex)
                  throw new Error(
                    "CitationIndex stub lacks getDocumentCitationSet",
                  );
                return Effect.promise(() =>
                  deps.citationIndex!.getDocumentCitationSet(
                    file,
                    options ?? {},
                  ),
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
          deps.services?.citationText ??
            stubService<CitationText["Service"]>("CitationText", {
              read: (path) =>
                Effect.promise((signal) =>
                  deps.citationText
                    ? deps.citationText.read(path, { signal })
                    : Promise.resolve(null),
                ).pipe(
                  Effect.map((value) => value as DocumentCitations | null),
                ),
            }),
        ),
        Layer.succeed(
          BibliographyRender,
          deps.services?.bibliographyRender ??
            stubService<BibliographyRender["Service"]>("BibliographyRender", {
              state: Effect.sync(() => ({
                vaultPresentation: bibliographyRender.vaultPresentation ?? {
                  styleId: null,
                  locale: null,
                },
                missingStyle: null,
              })),
              events: (bibliographyRender.invalidated ?? Stream.empty).pipe(
                Stream.map(() => ({ _tag: "invalidated" as const })),
              ),
              render: (items, presentation) =>
                Effect.promise(() =>
                  bibliographyRender.render
                    ? bibliographyRender.render(items, presentation)
                    : Promise.resolve({
                        kind: "unavailable",
                        reason: "engine-absent",
                      } as const),
                ).pipe(
                  Effect.map((value) => value as BibliographyRenderOutcome),
                ),
              readBibliography: (items) =>
                Effect.promise((signal) =>
                  bibliographyRender.readBibliography
                    ? bibliographyRender.readBibliography(items, { signal })
                    : Promise.resolve(null),
                ).pipe(
                  Effect.map(
                    (value) => value as BibliographyRenderResult | null,
                  ),
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
