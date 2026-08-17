// The Citation Popover: the entries one hovered citation shows, read for the document it is written in.

import type { App } from "obsidian";

import { getLogger } from "@/lib/log";
import { readReferenceSources } from "@/services/citation-index/service";
import type { CitationIndex } from "@/services/citation-index/service";
import type { CitationText } from "@/services/citation-text/service";
import type { CitationHoverRequest } from "@/services/citekey-navigation";
import type { DatabaseService } from "@/services/database/service";
import { documentPresentation } from "@/services/pandoc/document-presentation";
import type { BibliographyEntry } from "@/services/pandoc/engine";
import { noteContent } from "@/services/pandoc/inline-content";
import type { BibliographyRenderCache } from "@/services/pandoc/render-cache";
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
  citationIndex: Pick<CitationIndex, "getDocumentCitationSet">;
  /** Says whether the hovered document's citations show Entry Serials. */
  citationText: Pick<CitationText, "peek">;
  /** The plugin-wide render cache, which the References Sidebar reads its own entries from. */
  bibliographyRender: Pick<BibliographyRenderCache, "render" | "on">;
}

export interface CitationPopover {
  /** Show the Citation Popover of one hovered citation. */
  show: (request: CitationHoverRequest) => void;
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
 */
export function createCitationPopover(
  deps: CitationPopoverDeps,
): CitationPopover {
  return {
    show(request) {
      const popover = new CitationHoverPopover(
        request.hoverParent,
        request.targetEl,
      );
      let reading = 0;
      const draw = (): void => {
        const own = ++reading;
        void fill(deps, popover, { request, current: () => own === reading });
      };
      // Both listeners live exactly as long as this popover does.
      popover.register(deps.bibliographyRender.on("invalidated", draw));
      popover.registerEvent(
        deps.app.metadataCache.on("changed", (file) => {
          if (file.path === request.sourcePath) draw();
        }),
      );
      draw();
    },
  };
}

/**
 * @param current whether this read is still the popover's own; a read the
 *   render cache outlived draws nothing and hides nothing.
 */
async function fill(
  deps: CitationPopoverDeps,
  popover: CitationHoverPopover,
  {
    request,
    current,
  }: { request: CitationHoverRequest; current: () => boolean },
): Promise<void> {
  let blocks: CitationPopoverBlock[];
  try {
    blocks = await readBlocks(deps, request);
  } catch (error) {
    if (!current()) return;
    logger.warn("Cannot read the entries of a hovered citation", {
      path: request.sourcePath,
      error,
    });
    popover.hide();
    return;
  }
  if (!current()) return;
  // Every work the hover carries becomes a block, so an empty stack means
  // the document itself could not be read — nothing the popover can say.
  if (blocks.length === 0) {
    popover.hide();
    return;
  }
  const actions = createCitationPopoverActions({
    open: request.open,
    hide: () => popover.hide(),
  });
  // A note-class style writes its citation as a note the surfaces stand serials
  // in place of, so the popover is where that text is read — taken from the
  // formatted text of the very occurrence the pointer is on.
  const note = request.formatted ? noteContent(request.formatted) : undefined;
  const shown = popover.render(
    <CitationPopoverContent blocks={blocks} note={note} actions={actions} />,
  );
  logger.debug("Citation popover entries read", {
    path: request.sourcePath,
    blocks: blocks.length,
    note: note !== undefined && note.length > 0,
    shown,
  });
}

async function readBlocks(
  deps: CitationPopoverDeps,
  request: CitationHoverRequest,
): Promise<CitationPopoverBlock[]> {
  const file = deps.app.vault.getFileByPath(request.sourcePath);
  if (!file) {
    logger.debug("Hovered citation sits in no note", {
      path: request.sourcePath,
    });
    return [];
  }
  const { citations } = await deps.citationIndex.getDocumentCitationSet(file);
  const { sources } = readReferenceSources(deps.db, citations);
  // The hovered note's own Citation Presentation, so the popover shows what the
  // References Sidebar of that note shows — including nothing formatted at all
  // where the note's declared style or language cannot be rendered with.
  const declared = documentPresentation(deps.app.metadataCache, file);
  const outcome =
    declared.kind === "unusable"
      ? null
      : await deps.bibliographyRender.render(
          [...sources.values()].map((source) => source.csl),
          declared.presentation,
        );
  const entries = buildReferenceEntries(citations, sources, {
    bibliography:
      outcome?.kind === "rendered"
        ? { entries: renderedEntries(outcome.entries), complete: true }
        : undefined,
  });
  return citationPopoverBlocks(request.works, entries, {
    serials: deps.citationText.peek(file.path)?.entrySerials ?? false,
  });
}

/** The formatted entries by CSL id, which is the item identity they are joined under. */
function renderedEntries(
  entries: readonly BibliographyEntry[],
): Map<string, RenderedReference> {
  return new Map(
    entries.map(({ id, marker, content }) => [id, { marker, content }]),
  );
}
