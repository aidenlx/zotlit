// The shared core that derives Citations from Literature Note wikilinks.

import type { SettingsService } from "@/services/settings/service";

import { citationRunItem, citationRunSource } from "./citation-fragment";
import type { CitationRunItem, CitationSource } from "./citation-fragment";
import { getLogger } from "./log";

const logger = getLogger("wikilink-citation");

/** The `cite:` marker that tells a wikilink subpath from a heading or block one. */
const FRAGMENT_PREFIX = "cite:";

/** A linkpath and the Citation Fragment its subpath carries, if any. */
interface CitationLinkTarget {
  /** The link target with its subpath removed. */
  linkpath: string;
  /**
   * The text after `#cite:`, or null when the link carries no Citation
   * Fragment.
   */
  fragment: string | null;
}

/**
 * Splits a link target the way Obsidian's own `parseLinktext` does, then keeps
 * only what the display can show: a bare linkpath, or a linkpath whose subpath
 * is a Citation Fragment. A heading or block subpath keeps its own meaning, and
 * a subpath-only link names no note at all.
 *
 * @returns the target, or null when the link is none of the display's business.
 */
function citationTarget(linktext: string): CitationLinkTarget | null {
  const hash = linktext.indexOf("#");
  if (hash === -1) {
    return linktext === "" ? null : { linkpath: linktext, fragment: null };
  }
  const linkpath = linktext.slice(0, hash);
  if (linkpath === "") return null;
  const subpath = linktext.slice(hash + 1);
  if (!subpath.startsWith(FRAGMENT_PREFIX)) return null;
  return { linkpath, fragment: subpath.slice(FRAGMENT_PREFIX.length) };
}

/** The Literature Note a linkpath names, as the display derivation reads it. */
export interface LiteratureNoteTarget {
  /** The note's vault path; its filename backs the display-text fallback. */
  path: string;
  /** Its Indexed Key — the Zotero Item a rendered citation is formatted from. */
  indexedKey: string;
  /** Its native Zotero citation key, or null when the Item carries none. */
  citationKey: string | null;
}

export interface WikilinkCitationContext {
  /**
   * The Literature Note a linkpath resolves to, or null when it resolves to an
   * ordinary note or to nothing. The same predicate the Citation Index applies,
   * so the editor and the sidebar cannot disagree about what a Citation is.
   */
  literatureNote: (linkpath: string) => LiteratureNoteTarget | null;
  /** Whether Literature Note wikilinks participate in citation features. */
  enabled: boolean;
}

/** The Citation one Literature Note wikilink writes. */
export interface WikilinkCitation {
  /** The work the Citation names, as a derived Pandoc source would name it. */
  item: CitationRunItem;
  /** {@link LiteratureNoteTarget.indexedKey} of the work it names. */
  indexedKey: string;
}

/**
 * The Citation one wikilink writes.
 *
 * Left alone, each for its own reason: a heading or block subpath, because it
 * is not a Citation Fragment; a link resolving to no Literature Note; a
 * link while the caller disables citation treatment; and a malformed Citation
 * Fragment, which stays raw rather than guessing at what the exporter would
 * reject.
 *
 * @returns the Citation, or null when the link keeps Obsidian's own display.
 */
export function wikilinkCitation(
  linktext: string,
  context: WikilinkCitationContext,
): WikilinkCitation | null {
  const target = citationTarget(linktext);
  if (target === null) return null;
  if (!context.enabled) return null;
  const note = context.literatureNote(target.linkpath);
  if (note === null) return null;
  const item = citationRunItem({
    citationKey: note.citationKey,
    notePath: note.path,
    fragment: target.fragment,
  });
  if (item === null) return null;
  return {
    item,
    indexedKey: note.indexedKey,
  };
}

/** One member of a Citation Run: what wrote it, and the Citation it wrote. */
export interface RunMember<T> {
  /** The link the surface read, in that surface's own terms. */
  source: T;
  citation: WikilinkCitation;
}

/**
 * The Citation a whole run writes, with the work each of its keys names.
 *
 * A derived citekey is note text — an Item carrying no native citation key is
 * named by its Literature Note's filename — so two Items can derive one
 * spelling. The Indexed Keys are what identify the Citation.
 *
 * @see apps/obsidian/src/services/citation-text/present.ts — `HeldCitation`
 */
export interface RunCitationSource extends CitationSource {
  /** {@link WikilinkCitation.indexedKey} of each of `keys`, in the same order. */
  works: string[];
}

export function citationOfRun<T>(
  run: readonly RunMember<T>[],
): RunCitationSource {
  return {
    ...citationRunSource(run.map(({ citation }) => citation.item)),
    works: run.map(({ citation }) => citation.indexedKey),
  };
}

/**
 * Groups a surface's links into Citation Runs, so a run renders as the one
 * grouped Citation export writes it as.
 *
 * A run continues while a `;` with nothing but spaces or tabs around it joins
 * two Citations — the same rule the Pandoc filter applies, where only a `Space`
 * may sit around the separator and a `SoftBreak` ends the run. A link that
 * writes no Citation ends a run as surely as prose does, which is why grouping
 * reads the surface's links rather than its Citations.
 *
 * @param links every link of one surface, in document order.
 * @param citationOf the Citation a link writes, or null when it writes none.
 * @param textBetween the text separating two links, or null when they are too
 *   far apart to join at all — a paragraph away, or in another container.
 * @returns the runs, in document order, each holding at least one member.
 * @see apps/obsidian/src/services/pandoc/filter/zotlit-cite.lua — `process_inlines`
 */
export function citationRuns<T>(
  links: readonly T[],
  citationOf: (link: T) => WikilinkCitation | null,
  textBetween: (previous: T, next: T) => string | null,
): RunMember<T>[][] {
  const runs: RunMember<T>[][] = [];
  /** The link the last Citation was written by, or null when it wrote none. */
  let previous: T | null = null;
  for (const link of links) {
    const citation = citationOf(link);
    if (citation === null) {
      previous = null;
      continue;
    }
    const separator = previous === null ? null : textBetween(previous, link);
    previous = link;
    const open = runs.at(-1);
    if (open !== undefined && separator !== null && JOINS_RUN.test(separator)) {
      open.push({ source: link, citation });
      continue;
    }
    runs.push([{ source: link, citation }]);
  }
  return runs;
}

/** The separator that joins two Citations into one run. */
const JOINS_RUN = /^[ \t]*;[ \t]*$/u;

/**
 * The settings both wikilink display surfaces read, kept current for as long as
 * the surface watches them.
 *
 * One tracker per surface, so Live Preview and reading mode answer to the same
 * two settings without either restating which ones they are.
 */
export class WikilinkDisplaySettings {
  #enabled = false;

  /** {@link WikilinkCitationContext.enabled} */
  get enabled(): boolean {
    return this.#enabled;
  }

  /**
   * Follows the settings, and asks for a redraw whenever they change what a
   * link displays.
   *
   * `SettingsService.subscribe` invokes its listener immediately, so the first
   * snapshot only seeds the values: everything drawn so far already read them,
   * and a startup redraw would show nothing new. A first snapshot of null seeds
   * the defaults, and the settings that arrive after it redraw like any change.
   *
   * @returns the unsubscribe.
   */
  watch(
    settings: Pick<SettingsService, "subscribe">,
    redraw: () => void,
  ): () => void {
    let seeded = false;
    return settings.subscribe((next) => {
      const seeding = !seeded;
      seeded = true;
      if (!next) return;
      const enabled =
        next["citation.wikilink-citations"] && next["citation.show-formatted"];
      const changed = enabled !== this.#enabled;
      this.#enabled = enabled;
      if (seeding || !changed) return;
      logger.debug("Wikilink display settings changed", { enabled });
      redraw();
    });
  }
}
