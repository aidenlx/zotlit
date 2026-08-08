// The shared core of wikilink citation display: which Literature Note
// wikilinks show a Citation Display Text, and what that text says. Live Preview
// and reading mode both derive their display here, so the two surfaces cannot
// disagree about what one link shows.

import type { SettingsService } from "@/services/settings/service";

import { citationDisplayText } from "./citation-fragment";
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
  /** The note's Citation Key Property value, or null when it carries none. */
  citationKey: string | null;
}

export interface WikilinkCitationContext {
  /**
   * The Literature Note a linkpath resolves to, or null when it resolves to an
   * ordinary note or to nothing. The same predicate the Citation Index applies,
   * so the editor and the sidebar cannot disagree about what a Citation is.
   */
  literatureNote: (linkpath: string) => LiteratureNoteTarget | null;
  /**
   * Whether a link carrying no Citation Fragment may show a Citation Display
   * Text — Wikilink Citations and the wikilink display toggle both on. A link
   * that carries one shows it either way: the fragment is unambiguous ZotLit
   * intent, and Pandoc export honors it regardless of settings.
   */
  fragmentlessDisplay: boolean;
}

/**
 * The Citation Display Text one wikilink shows in place of its raw path and
 * Citation Fragment.
 *
 * Left alone, each for its own reason: a heading or block subpath, because it
 * is not a Citation Fragment; a link resolving to no Literature Note; a
 * fragment-less link while the display toggle is off; and a malformed Citation
 * Fragment, which stays raw rather than guessing at what the exporter would
 * reject.
 *
 * @returns the text, or null when the link keeps Obsidian's own display.
 */
export function wikilinkDisplayText(
  linktext: string,
  context: WikilinkCitationContext,
): string | null {
  const target = citationTarget(linktext);
  if (target === null) return null;
  if (target.fragment === null && !context.fragmentlessDisplay) return null;
  const note = context.literatureNote(target.linkpath);
  if (note === null) return null;
  const display = citationDisplayText({
    citationKey: note.citationKey,
    notePath: note.path,
    fragment: target.fragment,
  });
  return display.kind === "raw" ? null : display.text;
}

/**
 * The settings both wikilink display surfaces read, kept current for as long as
 * the surface watches them.
 *
 * One tracker per surface, so Live Preview and reading mode answer to the same
 * two settings without either restating which ones they are.
 */
export class WikilinkDisplaySettings {
  #fragmentlessDisplay = false;
  #citationKeyProperty: string | null = null;

  /** {@link WikilinkCitationContext.fragmentlessDisplay} */
  get fragmentlessDisplay(): boolean {
    return this.#fragmentlessDisplay;
  }

  /** The frontmatter property a Literature Note's citation key comes from. */
  get citationKeyProperty(): string | null {
    return this.#citationKeyProperty;
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
      // Wikilink Citations is the master switch for reading wikilinks as
      // Citations at all; the display toggle decides whether the fragment-less
      // ones show their Citation Display Text.
      const fragmentlessDisplay =
        next["citation.wikilink-citations"] &&
        next["citation.wikilink-display"];
      const citationKeyProperty = next["citation.key-links-frontmatter-key"];
      const changed =
        fragmentlessDisplay !== this.#fragmentlessDisplay ||
        citationKeyProperty !== this.#citationKeyProperty;
      this.#fragmentlessDisplay = fragmentlessDisplay;
      this.#citationKeyProperty = citationKeyProperty;
      if (seeding || !changed) return;
      logger.debug("Wikilink display settings changed", {
        fragmentlessDisplay,
        citationKeyProperty,
      });
      redraw();
    });
  }
}
