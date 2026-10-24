// The Citation Popover: document citation entries and source-less works under the vault presentation.
import type { App, HoverParent, TFile } from "obsidian";
import type { ReactNode } from "react";

import { Cause, Context, Effect, Layer } from "@/lib/effect";
import { scopedBridge, valueOr } from "@/lib/effect-bridge";
import { bridgeLog, withLogCategory } from "@/lib/effect-log";
import { filterTag } from "@/lib/effect-stream";
import * as m from "@/lib/i18n/generated/messages";
import { ObsidianApp } from "@/lib/obsidian-app";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { requestProfileSwitch } from "@/lib/profile-recovery";
import {
  describeCandidates,
  describeJoinedCandidates,
} from "@/services/citation-index/ambiguity";
import type {
  CitationLookupAnswer,
  CitationLookupRequest,
} from "@/services/citation-index/lookup";
import {
  CitationLookup,
  lookupChanged,
  lookupStatusChanged,
} from "@/services/citation-index/lookup-service";
import type { CitationLookupStatus } from "@/services/citation-index/lookup-service";
import { CitationIndex } from "@/services/citation-index/service";
import { readReferenceSources } from "@/services/citation-index/service";
import type { DocumentCitationSet } from "@/services/citation-index/service";
import type { CitekeyResolution } from "@/services/citation-index/service";
import { shownCitationContent } from "@/services/citation-text/present";
import { CitationText } from "@/services/citation-text/service";
import type { DocumentCitations } from "@/services/citation-text/service";
import type { CitationHoverRequest } from "@/services/citekey-navigation";
import type { ResolvedLibraryScope } from "@/services/library-scope/scope";
import { LibraryScope } from "@/services/library-scope/service";
import type { Inlines } from "@/services/pandoc/ast";
import {
  documentCitationPresentation,
  documentPresentation,
  profileReaderOf,
} from "@/services/pandoc/document-presentation";
import type { ProfilePresentationFailure } from "@/services/pandoc/document-presentation";
import type { BibliographyEntry } from "@/services/pandoc/engine";
import { noteContent } from "@/services/pandoc/inline-content";
import {
  BibliographyRender,
  renderInvalidated,
} from "@/services/pandoc/render-cache";
import type {
  BibliographyRenderOutcome,
  BibliographyRenderResult,
  ReadOptions,
  RenderPresentation,
} from "@/services/pandoc/render-cache";
import { Profile } from "@/services/profile/service";
import type { ProfileReader } from "@/services/profile/service";
import { acquireReadLease } from "@/services/zotero-reads/lease";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type {
  ZoteroReadLease,
  ZoteroReadsApi,
  ZoteroReadsState,
} from "@/services/zotero-reads/service";
import { buildReferenceEntries } from "@/views/references/entries";
import type { RenderedReference } from "@/views/references/entries";

import { createCitationPopoverActions } from "./actions";
import { citationPopoverBlocks } from "./blocks";
import type { CitationPopoverBlock } from "./blocks";
import { CitationPopoverContent } from "./content";
import { HoverVisits } from "./visits";
import type { HoverVisit } from "./visits";

/** What one popover read reaches outside Effect. */
interface PopoverReads {
  app: App;
  db: {
    readonly state: ZoteroReadsState["state"];
    readonly reads: ZoteroReadsApi;
    acquireRead(): Promise<ZoteroReadLease>;
  };
  lookupStatus(): CitationLookupStatus;
  readLookup(
    request: CitationLookupRequest,
    options: { signal: AbortSignal },
  ): Promise<CitationLookupAnswer>;
  getDocumentCitationSet(
    file: TFile,
    options: Parameters<CitationIndex["Service"]["getDocumentCitationSet"]>[1],
  ): Promise<DocumentCitationSet>;
  /** Names the Library each candidate of an Ambiguous Citation Key lives in. */
  libraryScope: {
    readonly current: ResolvedLibraryScope | null;
  };
  /** The formatted citations of the hovered document, read for this popover. */
  readText(
    path: string,
    options: { signal: AbortSignal },
  ): Promise<DocumentCitations | null>;
  profile: Pick<ProfileReader, "loaded" | "profileOf">;
  /** The plugin-wide render cache, which the References Sidebar reads its own entries from. */
  vaultPresentation(): Effect.Success<
    BibliographyRender["Service"]["state"]
  >["vaultPresentation"];
  renderBibliography(
    items: Parameters<BibliographyRender["Service"]["render"]>[0],
    presentation: RenderPresentation,
  ): Promise<BibliographyRenderOutcome>;
  readBibliography(
    items: Parameters<BibliographyRender["Service"]["readBibliography"]>[0],
    options: ReadOptions & { signal: AbortSignal },
  ): Promise<BibliographyRenderResult | null>;
  log(
    level: "debug" | "warn",
    message: string,
    fields: Record<string, unknown>,
  ): void;
}

/** One work shown independently of a document or citation occurrence. */
export interface WorkHoverRequest extends Pick<
  CitationHoverRequest,
  "event" | "hoverParent" | "targetEl"
> {
  work:
    | { kind: "item"; indexedKey: string }
    | { kind: "citekey"; citekey: string };
  /** Open the exact Item displayed, using its current Literature Note. */
  open: (
    indexedKey: string,
    pane: Parameters<CitationHoverRequest["open"]>[1],
  ) => void;
}

type PopoverRequest = CitationHoverRequest | WorkHoverRequest;

/** What one hovered target's popover reads and shows. */
interface CitationVisitState {
  reading: AbortController | null;
  content: ReactNode;
}

type PopoverVisit = HoverVisit<CitationVisitState>;

/**
 * Shows what a hovered citation cites: each work's formatted bibliography entry
 * stacked in citation order, with the actions that reach that work.
 *
 * The popover opens on the hover itself and fills once the entries are read, so
 * Obsidian's own timing decides when it appears rather than the read does. The
 * entries come from the same bibliography render the References Sidebar shows,
 * so both surfaces agree on the References Style and go stale together — an
 * open popover reads its own entries again on the drop, and the read it was
 * already waiting on is left where it lands. The hovered note's own properties
 * are the other input, so an edit to them redraws an open popover the same way.
 *
 * Every read stands on the note as it is now: the entries, the Entry Serials,
 * and a note-class style's own note text are all read again, so a Citation
 * Presentation change leaves nothing of the previous style on screen.
 */
export class CitationPopover extends Context.Service<
  CitationPopover,
  {
    show(request: CitationHoverRequest): Effect.Effect<void>;
    /** Completes once the hover's first read has drawn, or was dropped because the pointer moved on or the popover hid. */
    showWork(request: WorkHoverRequest): Effect.Effect<void>;
    /** Closes the owner's visit, including a card still waiting to open. */
    hide(parent: HoverParent, targetEl?: HTMLElement): Effect.Effect<void>;
  }
>()("zotlit/citation-popover/CitationPopover") {}

/** What one read of a hovered citation puts on screen. */
interface PopoverRead {
  /** One block per work the hover carries, in the order it names them. */
  blocks: CitationPopoverBlock[];
  /** The note a note-class style wrote for the hovered occurrence. */
  note: Inlines | undefined;
  profileFailure: ProfilePresentationFailure | undefined;
  /**
   * The citekey resolution snapshot could not answer when this read ran, so
   * an unresolved block is a lookup in progress rather than a missing Item.
   */
  pending: boolean;
  /** Exact identity of the single source-less entry. */
  indexedKey?: string;
  unavailable?: "database" | "item";
}

export const layerCitationPopover: Layer.Layer<
  CitationPopover,
  never,
  | ObsidianApp
  | MetadataCache
  | ZoteroReads
  | CitationLookup
  | CitationIndex
  | LibraryScope
  | CitationText
  | BibliographyRender
  | Profile
> = Layer.effect(
  CitationPopover,
  Effect.gen(function* () {
    const app = yield* ObsidianApp;
    const metadata = yield* MetadataCache;
    const reads = yield* ZoteroReads;
    const lookup = yield* CitationLookup;
    const index = yield* CitationIndex;
    const libraries = yield* LibraryScope;
    const text = yield* CitationText;
    const render = yield* BibliographyRender;
    const profiles = yield* Profile;
    const bridge = yield* scopedBridge;
    const visits = new HoverVisits<CitationVisitState>(() => ({
      reading: null,
      content: null,
    }));
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        visits.hideAll();
      }),
    );

    const logs = bridgeLog(bridge, "citation-popover");
    const log = (
      level: "debug" | "warn",
      message: string,
      fields: Record<string, unknown>,
    ) => logs[level](message, fields);
    // Keep each service's read contract after the plugin closes.
    const held = async <A, E>(
      effect: Effect.Effect<A, E>,
      released: A,
      options?: { signal?: AbortSignal },
    ): Promise<A> =>
      valueOr(await bridge.runPromiseExit(effect, options), released);
    const lookupReleased = () =>
      new DOMException("Citation Lookup released", "AbortError");
    const deps: PopoverReads = {
      app,
      db: {
        get state() {
          return bridge.runSync(reads.current).state;
        },
        get reads() {
          return reads.reads;
        },
        acquireRead: () => acquireReadLease(reads, bridge),
      },
      lookupStatus: () => bridge.runSync(lookup.current).status,
      async readLookup(request, { signal }) {
        if (bridge.closed()) throw lookupReleased();
        const selected = {
          citekeys: [...(request.citekeys ?? [])],
          indexedKeys: [...(request.indexedKeys ?? [])],
          annotationKeys: [...(request.annotationKeys ?? [])],
        };
        const answer = await held(lookup.read(selected), undefined, {
          signal,
        }).catch((error: unknown) => {
          // A failure after unload is the release, like an interrupt.
          throw bridge.closed() ? lookupReleased() : error;
        });
        if (answer === undefined) throw lookupReleased();
        return answer;
      },
      async getDocumentCitationSet(file, options) {
        const result = await held(
          index.getDocumentCitationSet(file, options),
          undefined,
          { signal: options?.signal },
        ).catch((error: unknown) => {
          // The read is a `tryPromise`: throw what the index rejected with.
          throw Cause.isUnknownError(error) ? error.cause : error;
        });
        if (result === undefined)
          throw new DOMException("Citation Index released", "AbortError");
        return result;
      },
      libraryScope: {
        get current() {
          return bridge.runSync(libraries.current);
        },
      },
      async readText(path, { signal }) {
        if (bridge.closed()) return null;
        return held(text.read(path, { signal }), null, { signal });
      },
      vaultPresentation: () => bridge.runSync(render.state).vaultPresentation,
      async renderBibliography(items, presentation) {
        return held(render.render(items, presentation), {
          kind: "unavailable",
          reason: "failed",
        } as const);
      },
      async readBibliography(items, { signal }) {
        const result = await held(
          render.readBibliography(items, { signal }),
          undefined,
          { signal },
        );
        if (result === undefined)
          throw new DOMException("Held read released", "AbortError");
        return result;
      },
      profile: profileReaderOf(profiles, bridge.runSync),
      log,
    };
    function showVisit(request: PopoverRequest): Promise<void> {
      if (bridge.closed()) return Promise.resolve();
      const currentVisit = visits.open(request.hoverParent, request.targetEl);
      const { popover, subscriptions, state } = currentVisit;
      subscriptions.defer(() => state.reading?.abort());
      const read = (): Promise<void> => {
        state.reading?.abort();
        const reading = new AbortController();
        state.reading = reading;
        return fill(deps, currentVisit, {
          request,
          signal: reading.signal,
        });
      };
      const draw = (): void => {
        void read();
      };
      subscriptions.defer(bridge.subscribe(renderInvalidated(render), draw));
      if (!("work" in request) || request.work.kind === "citekey") {
        subscriptions.defer(bridge.subscribe(lookupChanged(lookup), draw));
        let freshness = deps.lookupStatus();
        subscriptions.defer(
          bridge.subscribe(lookupStatusChanged(lookup), () => {
            const previous = freshness;
            freshness = deps.lookupStatus();
            if (freshness === "failed") showFailure(currentVisit);
            else if (freshness === "fresh" && previous === "failed") draw();
          }),
        );
      }
      if (!("work" in request)) {
        subscriptions.defer(
          bridge.subscribe(
            filterTag(metadata.changes, "deleted"),
            ({ file }) => {
              if (file.path === request.sourcePath) popover.hide();
            },
          ),
        );
        subscriptions.defer(
          bridge.subscribe(
            filterTag(metadata.changes, "changed"),
            ({ file }) => {
              if (file.path === request.sourcePath) draw();
            },
          ),
        );
      }
      return read();
    }

    return CitationPopover.of({
      show: (request) =>
        Effect.sync(() => {
          void showVisit(request);
        }),
      showWork: (request) => Effect.promise(() => showVisit(request)),
      hide: (parent, targetEl) =>
        Effect.sync(() => visits.hide(parent, targetEl)),
    });
  }).pipe(withLogCategory("citation-popover")),
);

/** A superseded request draws nothing and hides nothing. */
async function fill(
  deps: PopoverReads,
  visit: PopoverVisit,
  { request, signal }: { request: PopoverRequest; signal: AbortSignal },
): Promise<void> {
  const { popover } = visit;
  let read: PopoverRead;
  try {
    read = await ("work" in request
      ? readWork(deps, request, signal)
      : readBlocks(deps, request, signal));
  } catch (error) {
    if (signal.aborted) return;
    deps.log("warn", "Cannot read the entries of a hovered citation", {
      path: "sourcePath" in request ? request.sourcePath : undefined,
      error,
    });
    showFailure(visit);
    return;
  }
  if (signal.aborted) return;
  if (read.unavailable === "database" && visit.state.content) {
    showFailure(visit);
    return;
  }
  const { blocks, note, profileFailure, pending, unavailable } = read;
  // Every work the hover carries becomes a block, so an empty stack means
  // the document itself could not be read — nothing the popover can say.
  if (blocks.length === 0 && !unavailable) {
    popover.hide();
    return;
  }
  const actions = createCitationPopoverActions({
    app: deps.app,
    open: (block, pane) => {
      if ("work" in request) {
        if (read.indexedKey) request.open(read.indexedKey, pane);
      } else if (block.citekey !== null) {
        request.open(block.citekey, pane);
      }
    },
    prepare:
      "work" in request && read.indexedKey
        ? async (block) => {
            const { sources, database } = await readReferenceSources(deps.db, [
              { indexedKey: read.indexedKey!, linkpath: null },
            ]);
            // The popover moved on to another visit while the read ran: this
            // action neither runs nor touches what the popover shows now.
            if (signal.aborted) return null;
            const source = sources.get(read.indexedKey!);
            if (database === "unreadable" || !source) {
              popover.render(
                <CitationPopoverContent
                  blocks={[]}
                  actions={actions}
                  unavailable={database === "unreadable" ? "database" : "item"}
                />,
              );
              return null;
            }
            return {
              ...block,
              itemKey: source.itemKey,
              groupID: source.groupID,
              attachments: source.attachments,
            };
          }
        : undefined,
    hide: () => popover.hide(),
    switchProfile: (path) => requestProfileSwitch(deps.app, path),
    log: deps.log,
  });
  visit.state.content = (
    <CitationPopoverContent
      blocks={blocks}
      note={note}
      profileFailure={profileFailure}
      actions={actions}
      pending={pending}
      unavailable={unavailable}
    />
  );
  const shown = popover.render(visit.state.content);
  deps.log("debug", "Citation popover entries read", {
    path: "sourcePath" in request ? request.sourcePath : undefined,
    blocks: blocks.length,
    note: note !== undefined && note.length > 0,
    shown,
  });
}

async function readWork(
  deps: PopoverReads,
  request: WorkHoverRequest,
  signal: AbortSignal,
): Promise<PopoverRead> {
  const work = request.work;
  const empty: PopoverRead = {
    blocks: [],
    note: undefined,
    profileFailure: undefined,
    pending: false,
  };
  if (deps.db.state === "degraded")
    return { ...empty, unavailable: "database" };
  if (work.kind === "citekey" && deps.lookupStatus() === "pending") {
    return {
      ...empty,
      pending: true,
      blocks: [{ kind: "unresolved", citekey: work.citekey }],
    };
  }
  let indexedKey: string;
  if (work.kind === "citekey") {
    let resolution: CitekeyResolution;
    try {
      resolution = (
        await deps.readLookup({ citekeys: [work.citekey] }, { signal })
      ).resolve(work.citekey);
    } catch (error) {
      if (signal.aborted) throw error;
      return { ...empty, unavailable: "database" };
    }
    if (resolution.kind !== "unique") {
      return {
        ...empty,
        blocks: [
          resolution.kind === "ambiguous"
            ? {
                kind: "ambiguous",
                citekey: work.citekey,
                candidates: await describeCandidates(
                  deps,
                  resolution.candidates,
                ),
              }
            : { kind: "unresolved", citekey: work.citekey },
        ],
      };
    }
    indexedKey = resolution.item.indexedKey;
  } else {
    indexedKey = work.indexedKey;
  }
  const { sources, database } = await readReferenceSources(deps.db, [
    { indexedKey, linkpath: null },
  ]);
  if (database === "unreadable") return { ...empty, unavailable: "database" };
  const source = sources.get(indexedKey);
  if (!source) return { ...empty, unavailable: "item" };
  // Read through to the render that stands: the popover shows one entry and
  // has no stale list of its own to keep on screen meanwhile.
  const bibliography = await deps
    .readBibliography([source.csl], { signal })
    .catch((error: unknown) => {
      if (signal.aborted) return null;
      deps.log("warn", "Cannot format source-less Item", {
        indexedKey,
        error,
      });
      return null;
    });
  const entry = bibliography?.entries.find(
    (entry) => entry.id === String(source.csl.id),
  );
  return {
    ...empty,
    indexedKey,
    blocks: [
      {
        kind: "entry",
        citekey: source.citekey,
        marker: undefined,
        serial: undefined,
        content: entry?.content.length ? entry.content : null,
        summary: source.summary,
        itemKey: source.itemKey,
        groupID: source.groupID,
        attachments: source.attachments,
      },
    ],
  };
}

async function readBlocks(
  deps: PopoverReads,
  request: CitationHoverRequest,
  signal: AbortSignal,
): Promise<PopoverRead> {
  const file = deps.app.vault.getFileByPath(request.sourcePath);
  if (!file) {
    deps.log("debug", "Hovered citation sits in no note", {
      path: request.sourcePath,
    });
    return {
      blocks: [],
      note: undefined,
      profileFailure: undefined,
      pending: false,
    };
  }
  const citekeys = request.works.map(({ citekey }) => citekey);
  const { citations, lookup, sources } = await deps.getDocumentCitationSet(
    file,
    {
      signal,
      include: { citekeys },
    },
  );
  // Read beside the citations it qualifies: this read resolved against the
  // snapshot as it stood here, and the popover redraws on the next hover.
  const pending = deps.lookupStatus() === "pending";
  // The hovered note's own Citation Presentation, so the popover shows what the
  // References Sidebar of that note shows — including nothing formatted at all
  // where the note's declared style or language cannot be rendered with.
  const presented = documentCitationPresentation(
    documentPresentation(deps.app.metadataCache, file, deps.profile),
    deps.vaultPresentation(),
    { citations, works: sources },
  );
  const outcome =
    presented.kind === "unusable"
      ? null
      : await deps.renderBibliography(presented.items, presented.presentation);
  const entries = buildReferenceEntries(citations, {
    bibliography:
      outcome?.kind === "held"
        ? {
            entries: renderedEntries(outcome.record.value.entries),
            complete: true,
          }
        : undefined,
  });
  // The document's own citations as they stand now, rather than as the hover
  // found them: a Citation Presentation change drops what was held for this
  // note, and this read is what puts the note text and the serials back.
  const text = await deps.readText(file.path, { signal });
  const libraries = new Map(
    (deps.libraryScope.current?.available ?? []).map((library) => [
      library.libraryID,
      library,
    ]),
  );
  const ambiguous = (citekey: string) => {
    const resolution = lookup.resolve(citekey);
    return resolution.kind === "ambiguous"
      ? describeJoinedCandidates(resolution.candidates, sources, libraries)
      : null;
  };
  // A note-class style writes its citation as a note the surfaces stand serials
  // in place of, so the popover is where that text is read — taken from the
  // formatted text of the very occurrence the pointer is on, and from no other
  // occurrence once an edit has moved the one the hover stands on.
  const formatted =
    request.shown && text
      ? shownCitationContent(request.shown, text)
      : undefined;
  return {
    blocks: citationPopoverBlocks(request.works, entries, {
      serials: text?.entrySerials ?? false,
      ambiguous,
    }),
    note: formatted ? noteContent(formatted.text.content) : undefined,
    profileFailure:
      presented.kind === "unusable" && presented.property === "profile"
        ? presented
        : undefined,
    pending,
  };
}

/** The formatted entries by CSL id, which is the item identity they are joined under. */
function renderedEntries(
  entries: readonly BibliographyEntry[],
): Map<string, RenderedReference> {
  return new Map(
    entries.map(({ id, marker, content }) => [id, { marker, content }]),
  );
}

/** Failed freshness keeps the content delivered for this visit. */
function showFailure(visit: PopoverVisit): void {
  visit.popover.render(
    <>
      <div role="status" data-citation-lookup-status="failed">
        {m.citation_popover_database_unavailable()}
      </div>
      {visit.state.content}
    </>,
  );
}
