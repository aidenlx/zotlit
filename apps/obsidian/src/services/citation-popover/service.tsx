// The Citation Popover: document citation entries and source-less works under the vault presentation.

import { abortable } from "@std/async/abortable";
import type { App, HoverParent } from "obsidian";

import { registerEvent } from "@/lib/disposables";
import type { Held } from "@/lib/held-reads";
import { getLogger } from "@/lib/log";
import { requestProfileSwitch } from "@/lib/profile-recovery";
import { describeCandidates } from "@/services/citation-index/ambiguity";
import { readReferenceSources } from "@/services/citation-index/service";
import type { CitationIndex } from "@/services/citation-index/service";
import { shownCitationContent } from "@/services/citation-text/present";
import type {
  CitationText,
  DocumentCitations,
} from "@/services/citation-text/service";
import type { CitationHoverRequest } from "@/services/citekey-navigation";
import type { DatabaseService } from "@/services/database/service";
import type { LibraryScopeService } from "@/services/library-scope/service";
import type { Inlines } from "@/services/pandoc/ast";
import {
  documentCitationPresentation,
  documentPresentation,
} from "@/services/pandoc/document-presentation";
import type { ProfilePresentationFailure } from "@/services/pandoc/document-presentation";
import type { BibliographyEntry } from "@/services/pandoc/engine";
import { noteContent } from "@/services/pandoc/inline-content";
import type { BibliographyRenderCache } from "@/services/pandoc/render-cache";
import type { ProfileReader } from "@/services/profile/service";
import { Service } from "@/services/service-base";
import { buildReferenceEntries } from "@/views/references/entries";
import type { RenderedReference } from "@/views/references/entries";

import { createCitationPopoverActions } from "./actions";
import { citationPopoverBlocks } from "./blocks";
import type { CitationPopoverBlock } from "./blocks";
import { CitationPopoverContent } from "./content";
import { CitationHoverPopover } from "./popover";

const logger = getLogger("citation-popover");

export interface CitationPopoverDeps {
  app: App;
  db: Pick<DatabaseService, "state" | "client">;
  citationIndex: Pick<
    CitationIndex,
    "getDocumentCitationSet" | "resolveCitekey" | "resolution" | "on"
  >;
  /** Names the Library each candidate of an Ambiguous Citation Key lives in. */
  libraryScope: Pick<LibraryScopeService, "current">;
  /** The formatted citations of the hovered document, read for this popover. */
  citationText: Pick<CitationText, "on" | "peek">;
  profile: ProfileReader;
  /** The plugin-wide render cache, which the References Sidebar reads its own entries from. */
  bibliographyRender: Pick<
    BibliographyRenderCache,
    "render" | "on" | "vaultPresentation"
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

interface PopoverVisit {
  popover: CitationHoverPopover;
  window: Window;
  subscriptions: DisposableStack;
  reading: AbortController | null;
}

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
  readonly #visits = new Map<HoverParent, PopoverVisit>();
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
      for (const { popover } of this.#visits.values()) popover.hide();
    });
    this.commit(stack.move());
  }

  show(request: CitationHoverRequest): void {
    this.#show(request);
  }

  showWork(request: WorkHoverRequest): void {
    this.#show(request);
  }

  /** Closes the owner's visit, including a card still waiting to open. */
  hide(parent: HoverParent, targetEl?: HTMLElement): void {
    const popover = this.#visits.get(parent)?.popover;
    if (popover && (!targetEl || popover.targetEl === targetEl)) popover.hide();
  }

  #show(request: PopoverRequest): void {
    if (this.#closed) return;
    const deps = this.#deps;
    const { hoverParent, targetEl } = request;
    let visit = this.#visits.get(hoverParent);
    if (visit && visit.window !== targetEl.win) {
      visit.popover.hide();
      visit = undefined;
    }
    if (!visit) {
      const popover = new CitationHoverPopover(hoverParent, targetEl);
      const opened: PopoverVisit = {
        popover,
        window: targetEl.win,
        subscriptions: new DisposableStack(),
        reading: null,
      };
      this.#visits.set(hoverParent, opened);
      popover.register(() => {
        opened.reading?.abort();
        opened.subscriptions.dispose();
        this.#visits.delete(hoverParent);
      });
      visit = opened;
    } else {
      visit.reading?.abort();
      visit.subscriptions.dispose();
      visit.subscriptions = new DisposableStack();
      // Clear the old work and its actions before moving the card.
      visit.popover.render(null);
      visit.popover.retarget(targetEl);
    }
    const currentVisit = visit;
    const { popover, subscriptions } = visit;
    const draw = (): void => {
      currentVisit.reading?.abort();
      const reading = new AbortController();
      currentVisit.reading = reading;
      void fill(deps, popover, {
        request,
        signal: reading.signal,
      });
    };
    subscriptions.defer(deps.bibliographyRender.on("invalidated", draw));
    if ("work" in request) {
      if (request.work.kind === "citekey")
        subscriptions.defer(deps.citationIndex.on("resolution-changed", draw));
    } else {
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
    draw();
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
  popover: CitationHoverPopover,
  { request, signal }: { request: PopoverRequest; signal: AbortSignal },
): Promise<void> {
  let read: PopoverRead;
  try {
    read = await ("work" in request
      ? readWork(deps, request)
      : readBlocks(deps, request, signal));
  } catch (error) {
    if (signal.aborted) return;
    logger.warn("Cannot read the entries of a hovered citation", {
      path: "sourcePath" in request ? request.sourcePath : undefined,
      error,
    });
    popover.hide();
    return;
  }
  if (signal.aborted) return;
  const { blocks, note, profileFailure, pending, unavailable } = read;
  // Every work the hover carries becomes a block, so an empty stack means
  // the document itself could not be read — nothing the popover can say.
  if (blocks.length === 0 && !unavailable) {
    popover.hide();
    return;
  }
  const actions = createCitationPopoverActions({
    open: (block, pane) => {
      if ("work" in request) {
        if (read.indexedKey) request.open(read.indexedKey, pane);
      } else if (block.citekey !== null) {
        request.open(block.citekey, pane);
      }
    },
    prepare:
      "work" in request && read.indexedKey
        ? (block) => {
            const { sources, database } = readReferenceSources(deps.db, [
              { indexedKey: read.indexedKey!, linkpath: null },
            ]);
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
  const shown = popover.render(
    <CitationPopoverContent
      blocks={blocks}
      note={note}
      profileFailure={profileFailure}
      actions={actions}
      pending={pending}
      unavailable={unavailable}
    />,
  );
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
): Promise<PopoverRead> {
  await deps.profile.ready;
  const work = request.work;
  const resolution =
    work.kind === "citekey"
      ? deps.citationIndex.resolveCitekey(work.citekey)
      : null;
  const indexedKey =
    work.kind === "item"
      ? work.indexedKey
      : resolution?.kind === "unique"
        ? resolution.item.indexedKey
        : undefined;
  const empty: PopoverRead = {
    blocks: [],
    note: undefined,
    profileFailure: undefined,
    pending: false,
  };
  if (deps.db.state !== "ready") return { ...empty, unavailable: "database" };
  if (work.kind === "citekey" && indexedKey === undefined) {
    return {
      ...empty,
      pending: resolution === null,
      blocks: [
        resolution?.kind === "ambiguous"
          ? {
              kind: "ambiguous",
              citekey: work.citekey,
              candidates: describeCandidates(deps, resolution.candidates),
            }
          : { kind: "unresolved", citekey: work.citekey },
      ],
    };
  }
  if (indexedKey === undefined) return empty;
  const { sources, database } = readReferenceSources(deps.db, [
    { indexedKey, linkpath: null },
  ]);
  if (database === "unreadable") return { ...empty, unavailable: "database" };
  const source = sources.get(indexedKey);
  if (!source) return { ...empty, unavailable: "item" };
  const outcome = await deps.bibliographyRender
    .render([source.csl])
    .catch((error: unknown) => {
      logger.warn("Cannot format source-less Item", { indexedKey, error });
      return null;
    });
  const bibliography =
    outcome?.kind === "held"
      ? outcome.record.status === "revalidating"
        ? await outcome.record.settled
        : outcome.record.status === "failed"
          ? null
          : outcome.record.value
      : null;
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
  await deps.profile.ready;
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
  const { citations } = await deps.citationIndex.getDocumentCitationSet(file);
  // Read beside the citations it qualifies: this read resolved against the
  // snapshot as it stood here, and the popover redraws on the next hover.
  const pending = deps.citationIndex.resolution === null;
  const { sources } = readReferenceSources(deps.db, citations);
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
  const entries = buildReferenceEntries(citations, sources, {
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
  const text = await settledCitationText(deps.citationText, file.path, signal);
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
      // Read as the popover fills, so an Ambiguous Citation Key states the
      // candidates the current Library Scope names — and no candidate is
      // described for the citations that resolve.
      ambiguous: (citekey) => {
        const resolution = deps.citationIndex.resolveCitekey(citekey);
        return resolution?.kind === "ambiguous"
          ? describeCandidates(deps, resolution.candidates)
          : null;
      },
    }),
    note: formatted ? noteContent(formatted.text.content) : undefined,
    profileFailure:
      presented.kind === "unusable" && presented.property === "profile"
        ? presented
        : undefined,
    pending,
  };
}

/** Reads through first-load and revalidation commits for an asynchronous surface. */
async function settledCitationText(
  citationText: Pick<CitationText, "on" | "peek">,
  path: string,
  signal: AbortSignal,
): Promise<DocumentCitations | null> {
  while (true) {
    signal.throwIfAborted();
    const held = citationText.peek(path);
    if (held === null) {
      const wake = Promise.withResolvers<
        Held<DocumentCitations> | null | undefined
      >();
      using subscriptions = new DisposableStack();
      subscriptions.defer(
        citationText.on("changed", (changedPath) => {
          if (changedPath === path) wake.resolve(undefined);
        }),
      );
      subscriptions.defer(
        citationText.on("invalidated", () => wake.resolve(undefined)),
      );
      subscriptions.defer(
        citationText.on("settled", (settledPath, settled) => {
          if (settledPath === path) wake.resolve(settled);
        }),
      );
      const settled = await abortable(wake.promise, signal);
      if (settled !== undefined) return settled?.value ?? null;
      continue;
    }
    if (held.status === "revalidating") {
      await abortable(held.settled, signal);
      continue;
    }
    return held.value;
  }
}

/** The formatted entries by CSL id, which is the item identity they are joined under. */
function renderedEntries(
  entries: readonly BibliographyEntry[],
): Map<string, RenderedReference> {
  return new Map(
    entries.map(({ id, marker, content }) => [id, { marker, content }]),
  );
}
