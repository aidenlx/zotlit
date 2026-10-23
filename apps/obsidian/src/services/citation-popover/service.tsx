import type { App, HoverParent } from "obsidian";
import type { ReactNode } from "react";

import { registerEvent } from "@/lib/disposables";
// The Citation Popover: document citation entries and source-less works under the vault presentation.
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { requestProfileSwitch } from "@/lib/profile-recovery";
import {
  describeCandidates,
  describeJoinedCandidates,
} from "@/services/citation-index/ambiguity";
import type { PlainCitationLookup } from "@/services/citation-index/plain";
import { readReferenceSources } from "@/services/citation-index/service";
import type { CitationIndex } from "@/services/citation-index/service";
import { shownCitationContent } from "@/services/citation-text/present";
import type { CitationText } from "@/services/citation-text/service";
import type { CitationHoverRequest } from "@/services/citekey-navigation";
import type { PlainLibraryScope } from "@/services/library-scope/plain";
import type { Inlines } from "@/services/pandoc/ast";
import {
  documentCitationPresentation,
  documentPresentation,
} from "@/services/pandoc/document-presentation";
import type { ProfilePresentationFailure } from "@/services/pandoc/document-presentation";
import type { BibliographyEntry } from "@/services/pandoc/engine";
import { noteContent } from "@/services/pandoc/inline-content";
import type { PlainBibliographyRender } from "@/services/pandoc/render-cache/plain";
import type { ProfileReader } from "@/services/profile/service";
import { Service } from "@/services/service-base";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";
import { buildReferenceEntries } from "@/views/references/entries";
import type { RenderedReference } from "@/views/references/entries";

import { createCitationPopoverActions } from "./actions";
import { citationPopoverBlocks } from "./blocks";
import type { CitationPopoverBlock } from "./blocks";
import { CitationPopoverContent } from "./content";
import { HoverVisits } from "./visits";
import type { HoverVisit } from "./visits";

const logger = getLogger("citation-popover");

export interface CitationPopoverDeps {
  app: App;
  db: Pick<PlainZoteroReads, "state" | "reads" | "acquireRead">;
  citationLookup: Pick<PlainCitationLookup, "read" | "status" | "on">;
  citationIndex: Pick<CitationIndex, "getDocumentCitationSet">;
  /** Names the Library each candidate of an Ambiguous Citation Key lives in. */
  libraryScope: Pick<PlainLibraryScope, "current">;
  /** The formatted citations of the hovered document, read for this popover. */
  citationText: Pick<CitationText, "read">;
  profile: ProfileReader;
  /** The plugin-wide render cache, which the References Sidebar reads its own entries from. */
  bibliographyRender: Pick<
    PlainBibliographyRender,
    "render" | "readBibliography" | "on" | "vaultPresentation"
  >;
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
export class CitationPopover extends Service {
  readonly #deps;
  readonly #visits = new HoverVisits<CitationVisitState>(() => ({
    reading: null,
    content: null,
  }));
  #closed = false;
  ready: Promise<void>;

  constructor(deps: CitationPopoverDeps) {
    super();
    this.#deps = deps;
    this.ready = this.#load();
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    stack.defer(() => {
      this.#closed = true;
      this.#visits.hideAll();
    });
    this.commit(stack.move());
  }

  show(request: CitationHoverRequest): void {
    void this.#show(request);
  }

  /**
   * @returns settles once the hover's first read has drawn, or has been
   *   dropped because the pointer moved on or the popover hid. A hover needs
   *   not wait on it.
   */
  showWork(request: WorkHoverRequest): Promise<void> {
    return this.#show(request);
  }

  /** Closes the owner's visit, including a card still waiting to open. */
  hide(parent: HoverParent, targetEl?: HTMLElement): void {
    this.#visits.hide(parent, targetEl);
  }

  #show(request: PopoverRequest): Promise<void> {
    if (this.#closed) return Promise.resolve();
    const deps = this.#deps;
    const currentVisit = this.#visits.open(
      request.hoverParent,
      request.targetEl,
    );
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
    subscriptions.defer(deps.bibliographyRender.on("invalidated", draw));
    if (!("work" in request) || request.work.kind === "citekey") {
      subscriptions.defer(deps.citationLookup.on("changed", draw));
      let freshness = deps.citationLookup.status;
      subscriptions.defer(
        deps.citationLookup.on("status-changed", () => {
          const previous = freshness;
          freshness = deps.citationLookup.status;
          if (freshness === "failed") showFailure(currentVisit);
          else if (freshness === "fresh" && previous === "failed") draw();
        }),
      );
    }
    if (!("work" in request)) {
      subscriptions.use(
        registerEvent(
          deps.app.metadataCache.on("deleted", (file) => {
            if (file.path === request.sourcePath) {
              popover.hide();
            }
          }),
        ),
      );
      subscriptions.use(
        registerEvent(
          deps.app.metadataCache.on("changed", (file) => {
            if (file.path === request.sourcePath) draw();
          }),
        ),
      );
    }
    return read();
  }
}

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

/** A superseded request draws nothing and hides nothing. */
async function fill(
  deps: CitationPopoverDeps,
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
    logger.warn("Cannot read the entries of a hovered citation", {
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
  logger.debug("Citation popover entries read", {
    path: "sourcePath" in request ? request.sourcePath : undefined,
    blocks: blocks.length,
    note: note !== undefined && note.length > 0,
    shown,
  });
}

async function readWork(
  deps: CitationPopoverDeps,
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
  if (work.kind === "citekey" && deps.citationLookup.status === "pending") {
    return {
      ...empty,
      pending: true,
      blocks: [{ kind: "unresolved", citekey: work.citekey }],
    };
  }
  let indexedKey: string;
  if (work.kind === "citekey") {
    let resolution: import("../citation-index/service").CitekeyResolution;
    try {
      resolution = (
        await deps.citationLookup.read({ citekeys: [work.citekey] }, { signal })
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
  const bibliography = await deps.bibliographyRender
    .readBibliography([source.csl], { signal })
    .catch((error: unknown) => {
      logger.warn("Cannot format source-less Item", { indexedKey, error });
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
  deps: CitationPopoverDeps,
  request: CitationHoverRequest,
  signal: AbortSignal,
): Promise<PopoverRead> {
  const file = deps.app.vault.getFileByPath(request.sourcePath);
  if (!file) {
    logger.debug("Hovered citation sits in no note", {
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
  const { citations, lookup, sources } =
    await deps.citationIndex.getDocumentCitationSet(file, {
      signal,
      include: { citekeys },
    });
  // Read beside the citations it qualifies: this read resolved against the
  // snapshot as it stood here, and the popover redraws on the next hover.
  const pending = deps.citationLookup.status === "pending";
  // The hovered note's own Citation Presentation, so the popover shows what the
  // References Sidebar of that note shows — including nothing formatted at all
  // where the note's declared style or language cannot be rendered with.
  const presented = documentCitationPresentation(
    documentPresentation(deps.app.metadataCache, file, deps.profile),
    deps.bibliographyRender.vaultPresentation,
    { citations, works: sources },
  );
  const outcome =
    presented.kind === "unusable"
      ? null
      : await deps.bibliographyRender.render(
          presented.items,
          presented.presentation,
        );
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
  const text = await deps.citationText.read(file.path, { signal });
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
