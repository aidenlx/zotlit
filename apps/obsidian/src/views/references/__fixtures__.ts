// A References test host over controlled service reads and in-memory Obsidian sources.
import { Effect, Layer, Stream } from "effect";
import type { TFile } from "obsidian";

import { testEvent } from "@/lib/__fixtures__/event-stream";
import type { HostSources } from "@/lib/__fixtures__/obsidian-host-app";
import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import { MemoryMetadataCache } from "@/lib/__fixtures__/obsidian-metadata-cache";
import { MemoryVault } from "@/lib/__fixtures__/obsidian-vault";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { layerUnreadViewServices } from "@/lib/__fixtures__/view-atoms";
import { buildRuntime } from "@/lib/effect-layer";
import { vaultError } from "@/lib/vault-errors";
import { makeViewRegistry } from "@/lib/view-atoms";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import type { CitationLookupState } from "@/services/citation-index/lookup-service";
import { CitationIndex } from "@/services/citation-index/service";
import type { DocumentCitationSet } from "@/services/citation-index/service";
import type { DocumentCitations } from "@/services/citation-text/present";
import { CitationText } from "@/services/citation-text/service";
import { CitekeyEditor } from "@/services/citekey-editor/service";
import { BibliographyRender } from "@/services/pandoc/render-cache";
import type {
  BibliographyRenderOutcome,
  BibliographyRenderEvent,
} from "@/services/pandoc/render-cache";
import { PandocEngine } from "@/services/pandoc/service";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { Profile } from "@/services/profile/service";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsEvent } from "@/services/zotero-reads/service";

import { holdReferencesModel, makeReferencesModel } from "./model";

export interface ReferencesHostOptions {
  sources?: HostSources;
  services?: Layer.Layer<CitationIndex | CitationLookup>;
  zoteroEvents?: Stream.Stream<ZoteroReadsEvent>;
  getDocumentCitationSet?: CitationIndex["Service"]["getDocumentCitationSet"];
  render?: BibliographyRender["Service"]["render"];
  decline?: Effect.Effect<void>;
  openIndexedKey?: CitekeyEditor["Service"]["openIndexedKey"];
}

export async function makeReferencesHost(options: ReferencesHostOptions = {}) {
  const vault = new MemoryVault();
  const metadataCache = new MemoryMetadataCache();
  const workspace = new MemoryWorkspace({ layoutReady: true });
  const profile = profileReader(undefined, metadataCache);
  const lookupEvents = testEvent<CitationLookupState>();
  let lookup: CitationLookupState = {
    status: "fresh",
    revision: "1",
    stopped: false,
  };
  const zotero = testEvent<ZoteroReadsEvent>();
  const bibliography = testEvent<BibliographyRenderEvent>();
  const text =
    testEvent<import("@/services/citation-text/service").CitationTextEvent>();
  const index =
    testEvent<import("@/services/citation-index/service").CitationIndexEvent>();
  const scans: (PromiseWithResolvers<DocumentCitationSet> & { file: TFile })[] =
    [];
  const renders: PromiseWithResolvers<BibliographyRenderOutcome>[] = [];
  const cancelled: string[] = [];
  const cancelledRenders: number[] = [];
  let heldCitations: DocumentCitations | null = null;
  const stack = new AsyncDisposableStack();
  const runtime = buildRuntime(
    Layer.mergeAll(
      layerUnreadViewServices,
      layerHost(options.sources ?? { vault, metadataCache, workspace }),
      Layer.mock(Profile, {
        loaded: Effect.succeed(true),
        changes: Stream.empty,
        profileOf: (file) => Effect.sync(() => profile.profileOf(file)),
      }),
      Layer.mock(CitationLookup, {
        changes: Stream.concat(
          Stream.suspend(() => Stream.make(lookup)),
          lookupEvents.stream,
        ),
      }),
      Layer.mock(CitationIndex, {
        events: index.stream,
        getDocumentCitationSet:
          options.getDocumentCitationSet ??
          ((file) =>
            Effect.tryPromise({
              try: (signal) => {
                const scan = {
                  ...Promise.withResolvers<DocumentCitationSet>(),
                  file,
                };
                scans.push(scan);
                signal.addEventListener("abort", () =>
                  cancelled.push(file.path),
                );
                return scan.promise;
              },
              catch: vaultError("cachedRead", file.path),
            })),
      }),
      Layer.mock(CitationText, {
        events: text.stream,
        peek: () =>
          Effect.sync(() =>
            heldCitations === null
              ? null
              : {
                  value: heldCitations,
                  status: "fresh",
                  settled: Promise.resolve(heldCitations),
                },
          ),
      }),
      Layer.mock(PandocEngine, {
        changes: Stream.make({
          kind: "installed",
          version: "test",
          binary: { directory: "pandoc-engine", name: "pandoc.wasm" },
        }),
        decline: options.decline ?? Effect.void,
      }),
      Layer.mock(BibliographyRender, {
        state: Effect.succeed({
          vaultPresentation: { styleId: null, locale: null },
          missingStyle: null,
        }),
        events: bibliography.stream,
        render:
          options.render ??
          (() =>
            Effect.tryPromise((signal) => {
              const render = Promise.withResolvers<BibliographyRenderOutcome>();
              const number = renders.push(render);
              signal.addEventListener("abort", () =>
                cancelledRenders.push(number),
              );
              return render.promise;
            })),
      }),
      Layer.mock(CitekeyEditor, {
        openIndexedKey: options.openIndexedKey ?? (() => Effect.void),
      }),
      Layer.mock(ZoteroReads, {
        reads: stubService<ZoteroReads["Service"]["reads"]>(
          "ZoteroReadsApi",
          {},
        ),
        events: options.zoteroEvents ?? zotero.stream,
        changes: Stream.make({
          state: "ready",
          error: null,
          moved: false,
          dbFileMissing: false,
          activeReadMode: null,
        }),
      }),
      options.services ?? Layer.empty,
    ),
    stack,
  );
  const registry = makeViewRegistry(await runtime.context(), { idleTTL: 0 });
  return {
    registry,
    vault,
    metadataCache,
    workspace,
    scans,
    renders,
    cancelled,
    cancelledRenders,
    index,
    text,
    bibliography,
    follow: (path: string | null) => {
      const file = path ? (vault.getFileByPath(path) ?? vault.add(path)) : null;
      if (file)
        file.extension = file.path.slice(file.path.lastIndexOf(".") + 1);
      workspace.open(file);
      return file;
    },
    setLookup: (
      status: CitationLookupState["status"],
      revision = lookup.revision,
    ) => {
      lookup = { ...lookup, status, revision };
      lookupEvents.emit(lookup);
    },
    setCitationText: (path: string, value: DocumentCitations | null) => {
      heldCitations = value;
      text.emit({ type: "changed", path });
    },
    changeZotero: () => zotero.emit({ _tag: "changed" }),
    invalidate: () => bibliography.emit({ _tag: "invalidated" }),
    openSession: () => {
      const model = makeReferencesModel();
      const release = holdReferencesModel(registry, model);
      return {
        model,
        state: () => registry.get(model.state),
        [Symbol.dispose]: release,
      };
    },
    close: async () => {
      registry.dispose();
      await stack.disposeAsync();
    },
  };
}
export type ReferencesHost = Awaited<ReturnType<typeof makeReferencesHost>>;
