// The Citation Popover: document citation entries and source-less works under the vault presentation.
import {
  Cause,
  Context,
  Effect,
  Exit,
  Fiber,
  FiberHandle,
  Layer,
  Scope,
} from "effect";
import type { HoverParent } from "obsidian";
import type { ReactNode } from "react";

import { scopedBridge } from "@/lib/effect-bridge";
import { recover } from "@/lib/effect-cause";
import { bridgeLog, withLogCategory } from "@/lib/effect-log";
import { filterTag } from "@/lib/effect-stream";
import * as m from "@/lib/i18n/generated/messages";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Vault } from "@/lib/obsidian-vault";
import { Workspace, workspaceTrigger } from "@/lib/obsidian-workspace";
import type { WorkspaceEventHost } from "@/lib/obsidian-workspace";
import { requestProfileSwitch } from "@/lib/profile-recovery";
import {
  describeCandidatesEffect,
  describeJoinedCandidates,
} from "@/services/citation-index/ambiguity";
import {
  CitationLookup,
  lookupChanged,
  lookupStatusChanged,
} from "@/services/citation-index/lookup-service";
import { CitationIndex } from "@/services/citation-index/service";
import { readReferenceSources } from "@/services/citation-index/service";
import type { CitekeyResolution } from "@/services/citation-index/service";
import { shownCitationContent } from "@/services/citation-text/present";
import { CitationText } from "@/services/citation-text/service";
import type { CitationHoverRequest } from "@/services/citekey-navigation";
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
import { Profile } from "@/services/profile/service";
import { ZoteroReads } from "@/services/zotero-reads/service";
import { buildReferenceEntries } from "@/views/references/entries";
import type { RenderedReference } from "@/views/references/entries";

import { createCitationPopoverActions } from "./actions";
import { citationPopoverBlocks } from "./blocks";
import type { CitationPopoverBlock } from "./blocks";
import { CitationPopoverContent } from "./content";
import { HoverVisits } from "./visits";
import type { HoverVisit } from "./visits";

/** The services one popover read yields. */
type PopoverServices =
  | Vault
  | MetadataCache
  | ZoteroReads
  | CitationLookup
  | CitationIndex
  | LibraryScope
  | CitationText
  | BibliographyRender
  | Profile;

/** What the plain code a read hands its entries to reaches outside the read. */
interface PopoverEdges {
  /** The workspace the popover raises its menu and Profile switch events on. */
  host: WorkspaceEventHost;
  /**
   * Runs an entry action's fresh Item read on the visit's Scope, so the read
   * ends with the visit. Resolves `null` once the visit ended under it.
   */
  runAction<A, E>(effect: Effect.Effect<A, E>): Promise<A | null>;
  log: (
    level: "debug" | "warn",
    message: string,
    fields: Record<string, unknown>,
  ) => void;
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
  | Vault
  | Workspace
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
    const workspace = yield* Workspace;
    const metadata = yield* MetadataCache;
    const lookup = yield* CitationLookup;
    const render = yield* BibliographyRender;
    const bridge = yield* scopedBridge;
    const layerScope = yield* Effect.scope;
    const context = yield* Effect.context<PopoverServices>();
    const visits = new HoverVisits<CitationVisitState>(() => ({
      content: null,
    }));
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        visits.hideAll();
      }),
    );

    const logs = bridgeLog(bridge, "citation-popover");
    const host: WorkspaceEventHost = {
      workspace: workspaceTrigger(workspace, bridge.runSync),
    };
    const log: PopoverEdges["log"] = (level, message, fields) =>
      logs[level](message, fields);

    /**
     * Opens the visit `request` hovers, with a Scope of its own that hiding or
     * moving the popover closes. Each read of the visit is a fiber on that
     * Scope, and the next read interrupts the one before it.
     *
     * @returns the fiber of the visit's first read; none after release.
     */
    const showVisit = Effect.fn("CitationPopover.showVisit")(function* (
      request: PopoverRequest,
    ) {
      if (bridge.closed()) return undefined;
      const currentVisit = visits.open(request.hoverParent, request.targetEl);
      const { popover, subscriptions } = currentVisit;
      const scope = yield* Scope.fork(layerScope);
      subscriptions.defer(() =>
        bridge.runAndForget(Scope.close(scope, Exit.void)),
      );
      const reading = yield* FiberHandle.make<void, never>().pipe(
        Scope.provide(scope),
      );
      const edges: PopoverEdges = {
        host,
        log,
        runAction: (effect) =>
          bridge.runPromise(
            Effect.forkIn(effect, scope).pipe(
              Effect.flatMap((fiber) => Fiber.await(fiber)),
              Effect.flatMap((exit) =>
                Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
                  ? Effect.succeed(null)
                  : exit,
              ),
            ),
          ),
      };
      const read = FiberHandle.run(
        reading,
        fill(edges, currentVisit, request).pipe(
          // A read that fails after its entries were read, such as a draw
          // that throws, still reaches the log.
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logError(
                  "Cannot show the entries of a hovered citation",
                ).pipe(Effect.annotateLogs({ error: Cause.squash(cause) })),
          ),
          Effect.provideContext(context),
          withLogCategory("citation-popover"),
        ),
      );
      const draw = (): void => {
        bridge.runSync(read);
      };
      subscriptions.defer(bridge.subscribe(renderInvalidated(render), draw));
      if (!("work" in request) || request.work.kind === "citekey") {
        subscriptions.defer(bridge.subscribe(lookupChanged(lookup), draw));
        let freshness = (yield* lookup.current).status;
        subscriptions.defer(
          bridge.subscribe(lookupStatusChanged(lookup), () => {
            const previous = freshness;
            freshness = bridge.runSync(lookup.current).status;
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
      return yield* read;
    });

    return CitationPopover.of({
      show: Effect.fn("CitationPopover.show")(function* (request) {
        yield* showVisit(request);
      }),
      showWork: Effect.fn("CitationPopover.showWork")(function* (request) {
        const first = yield* showVisit(request);
        if (!first) return;
        // A later hover or hide dropping the first read completes the show; any
        // other failure is the caller's.
        const exit = yield* Fiber.await(first);
        if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
          return yield* Effect.failCause(exit.cause);
      }),
      hide: Effect.fn("CitationPopover.hide")((parent, targetEl) =>
        Effect.sync(() => visits.hide(parent, targetEl)),
      ),
    });
  }).pipe(withLogCategory("citation-popover")),
);

/** What a failed read carries, unwrapped from the `tryPromise` it came through. */
function failureOf(cause: Cause.Cause<unknown>): unknown {
  const error = Cause.squash(cause);
  return Cause.isUnknownError(error) ? error.cause : error;
}

/**
 * Reads the hover's entries and draws them. An interrupted read draws nothing
 * and hides nothing: the next read of the visit, the hidden popover, or the
 * released plugin ended it.
 */
const fill = Effect.fn("CitationPopover.fill")(function* (
  edges: PopoverEdges,
  visit: PopoverVisit,
  request: PopoverRequest,
): Effect.fn.Return<void, never, PopoverServices> {
  const { popover } = visit;
  const reads = yield* ZoteroReads;
  const read = yield* (
    "work" in request ? readWork(request) : readBlocks(request)
  ).pipe(
    recover(
      (cause) =>
        Effect.logWarning("Cannot read the entries of a hovered citation").pipe(
          Effect.annotateLogs({
            path: "sourcePath" in request ? request.sourcePath : undefined,
            error: failureOf(cause),
          }),
          Effect.andThen(Effect.sync(() => showFailure(visit))),
        ),
      Effect.succeed(null),
    ),
  );
  if (read === null) return;
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
    host: edges.host,
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
            const join = await edges.runAction(
              readReferenceSources(reads, [
                { indexedKey: read.indexedKey!, linkpath: null },
              ]),
            );
            // The popover moved on to another visit while the read ran: this
            // action neither runs nor touches what the popover shows now.
            if (join === null) return null;
            const { sources, database } = join;
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
    switchProfile: (path) => requestProfileSwitch(edges.host, path),
    log: edges.log,
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
  yield* Effect.logDebug("Citation popover entries read").pipe(
    Effect.annotateLogs({
      path: "sourcePath" in request ? request.sourcePath : undefined,
      blocks: blocks.length,
      note: note !== undefined && note.length > 0,
      shown,
    }),
  );
});

const readWork = Effect.fn("CitationPopover.readWork")(function* (
  request: WorkHoverRequest,
): Effect.fn.Return<PopoverRead, unknown, PopoverServices> {
  const reads = yield* ZoteroReads;
  const lookup = yield* CitationLookup;
  const libraries = yield* LibraryScope;
  const render = yield* BibliographyRender;
  const work = request.work;
  const empty: PopoverRead = {
    blocks: [],
    note: undefined,
    profileFailure: undefined,
    pending: false,
  };
  if ((yield* reads.current).state === "degraded")
    return { ...empty, unavailable: "database" };
  if (work.kind === "citekey" && (yield* lookup.current).status === "pending") {
    return {
      ...empty,
      pending: true,
      blocks: [{ kind: "unresolved", citekey: work.citekey }],
    };
  }
  let indexedKey: string;
  if (work.kind === "citekey") {
    const answer = yield* lookup
      .read({ citekeys: [work.citekey], indexedKeys: [], annotationKeys: [] })
      .pipe(recover(() => Effect.void, Effect.succeed(null)));
    if (answer === null) return { ...empty, unavailable: "database" };
    const resolution: CitekeyResolution = answer.resolve(work.citekey);
    if (resolution.kind !== "unique") {
      return {
        ...empty,
        blocks: [
          resolution.kind === "ambiguous"
            ? {
                kind: "ambiguous",
                citekey: work.citekey,
                candidates: yield* describeCandidatesEffect(
                  {
                    db: reads,
                    libraryScope: {
                      current: yield* libraries.current,
                    },
                  },
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
  const { sources, database } = yield* readReferenceSources(reads, [
    { indexedKey, linkpath: null },
  ]);
  if (database === "unreadable") return { ...empty, unavailable: "database" };
  const source = sources.get(indexedKey);
  if (!source) return { ...empty, unavailable: "item" };
  // Read through to the render that stands: the popover shows one entry and
  // has no stale list of its own to keep on screen meanwhile.
  const bibliography = yield* render
    .readBibliography([source.csl])
    .pipe(
      recover(
        (cause) =>
          Effect.logWarning("Cannot format source-less Item").pipe(
            Effect.annotateLogs({ indexedKey, error: Cause.squash(cause) }),
          ),
        Effect.succeed(null),
      ),
    );
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
});

const readBlocks = Effect.fn("CitationPopover.readBlocks")(function* (
  request: CitationHoverRequest,
): Effect.fn.Return<PopoverRead, unknown, PopoverServices> {
  const vault = yield* Vault;
  const metadata = yield* MetadataCache;
  const index = yield* CitationIndex;
  const lookupService = yield* CitationLookup;
  const render = yield* BibliographyRender;
  const text = yield* CitationText;
  const libraryScope = yield* LibraryScope;
  const profiles = yield* Profile;
  const file = yield* vault.getFileByPath(request.sourcePath);
  if (!file) {
    yield* Effect.logDebug("Hovered citation sits in no note").pipe(
      Effect.annotateLogs({ path: request.sourcePath }),
    );
    return {
      blocks: [],
      note: undefined,
      profileFailure: undefined,
      pending: false,
    };
  }
  const citekeys = request.works.map(({ citekey }) => citekey);
  const { citations, lookup, sources } = yield* index.getDocumentCitationSet(
    file,
    { include: { citekeys } },
  );
  // Read beside the citations it qualifies: this read resolved against the
  // snapshot as it stood here, and the popover redraws on the next hover.
  const pending = (yield* lookupService.current).status === "pending";
  // The hovered note's own Citation Presentation, so the popover shows what the
  // References Sidebar of that note shows — including nothing formatted at all
  // where the note's declared style or language cannot be rendered with.
  // `documentPresentation` is synchronous plain code: it reads the note's
  // metadata and Profile through this read's own services.
  const run = Effect.runSyncWith(
    yield* Effect.context<MetadataCache | Profile>(),
  );
  const presented = documentCitationPresentation(
    documentPresentation(
      { getFileCache: (target) => run(metadata.fileCache(target)) },
      file,
      profileReaderOf(profiles, run),
    ),
    (yield* render.state).vaultPresentation,
    { citations, works: sources },
  );
  const outcome =
    presented.kind === "unusable"
      ? null
      : yield* render.render(presented.items, presented.presentation);
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
  const documentText = yield* text.read(file.path);
  const libraries = new Map(
    ((yield* libraryScope.current)?.available ?? []).map((library) => [
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
    request.shown && documentText
      ? shownCitationContent(request.shown, documentText)
      : undefined;
  return {
    blocks: citationPopoverBlocks(request.works, entries, {
      serials: documentText?.entrySerials ?? false,
      ambiguous,
    }),
    note: formatted ? noteContent(formatted.text.content) : undefined,
    profileFailure:
      presented.kind === "unusable" && presented.property === "profile"
        ? presented
        : undefined,
    pending,
  };
});

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
