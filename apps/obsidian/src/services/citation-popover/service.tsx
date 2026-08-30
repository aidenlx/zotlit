import type { App } from "obsidian";
// The Citation Popover: the entries one hovered citation shows, read for the document it is written in.

import { getLogger } from "@/lib/log";
import { describeCandidates } from "@/services/citation-index/ambiguity";
import { readReferenceSources } from "@/services/citation-index/service";
import type { CitationIndex } from "@/services/citation-index/service";
import { shownCitationContent } from "@/services/citation-text/present";
import type { CitationText } from "@/services/citation-text/service";
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
import type { SettingsService } from "@/services/settings/service";
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
    "getDocumentCitationSet" | "resolveCitekey"
  >;
  /** Names the Library each candidate of an Ambiguous Citation Key lives in. */
  libraryScope: Pick<LibraryScopeService, "current">;
  /** The formatted citations of the hovered document, read for this popover. */
  citationText: Pick<CitationText, "load">;
  settings: Pick<SettingsService, "current">;
  profile: ProfileReader;
  /** The plugin-wide render cache, which the References Sidebar reads its own entries from. */
  bibliographyRender: Pick<
    BibliographyRenderCache,
    "render" | "on" | "vaultPresentation"
  >;
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
 *
 * Every read stands on the note as it is now: the entries, the Entry Serials,
 * and a note-class style's own note text are all read again, so a Citation
 * Presentation change leaves nothing of the previous style on screen.
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

/** What one read of a hovered citation puts on screen. */
interface PopoverRead {
  /** One block per work the hover carries, in the order it names them. */
  blocks: CitationPopoverBlock[];
  /** The note a note-class style wrote for the hovered occurrence. */
  note: Inlines | undefined;
  profileFailure: ProfilePresentationFailure | undefined;
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
  let read: PopoverRead;
  try {
    read = await readBlocks(deps, request);
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
  const { blocks, note, profileFailure } = read;
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
  const shown = popover.render(
    <CitationPopoverContent
      blocks={blocks}
      note={note}
      profileFailure={profileFailure}
      actions={actions}
    />,
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
): Promise<PopoverRead> {
  await deps.profile.ready;
  const file = deps.app.vault.getFileByPath(request.sourcePath);
  if (!file) {
    logger.debug("Hovered citation sits in no note", {
      path: request.sourcePath,
    });
    return { blocks: [], note: undefined, profileFailure: undefined };
  }
  const { citations } = await deps.citationIndex.getDocumentCitationSet(file);
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
      outcome?.kind === "rendered"
        ? { entries: renderedEntries(outcome.entries), complete: true }
        : undefined,
  });
  // The document's own citations as they stand now, rather than as the hover
  // found them: a Citation Presentation change drops what was held for this
  // note, and this read is what puts the note text and the serials back.
  const text = await deps.citationText.load(file);
  // A note-class style writes its citation as a note the surfaces stand serials
  // in place of, so the popover is where that text is read — taken from the
  // formatted text of the very occurrence the pointer is on, and from no other
  // occurrence once an edit has moved the one the hover stands on.
  const formatted = request.shown && shownCitationContent(request.shown, text);
  return {
    blocks: citationPopoverBlocks(request.works, entries, {
      serials: text.entrySerials,
      // Read as the popover fills, so an Ambiguous Citation Key states the
      // candidates the current Library Scope names — and no candidate is
      // described for the citations that resolve.
      ambiguous: (citekey) => {
        const resolution = deps.citationIndex.resolveCitekey(citekey);
        return resolution.kind === "ambiguous"
          ? describeCandidates(deps, resolution.candidates)
          : null;
      },
    }),
    note: formatted ? noteContent(formatted.text.content) : undefined,
    profileFailure:
      presented.kind === "unusable" && presented.property === "profile"
        ? presented
        : undefined,
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
