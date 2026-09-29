// The Template Directory as the docs site publishes it: the data each page reads, and where each page lives.

import type { PartialContext } from "./entry.ts";
import type { Facet, IndexedEntry } from "./search.ts";

/** The index page's path; each entry page sits below it at its entry id. */
export const DIRECTORY_PATH = "/templates";

export function entryPath(id: string): string {
  return `${DIRECTORY_PATH}/${id}`;
}

/** Everything the Directory's pages show, built from the Directory when the site builds. */
export interface DirectorySite {
  readonly entries: readonly SiteEntry[];
  /** The values each facet offers, in the order the index lists them. */
  readonly facets: Readonly<Record<Facet, readonly FacetOption[]>>;
}

/**
 * One value a facet offers. The entry format names research tasks, features,
 * and item types; the site's own messages name kinds and levels.
 */
export interface FacetOption {
  readonly value: string;
  readonly label?: string;
}

/** One entry page's content. */
export interface SiteEntry extends IndexedEntry {
  readonly audience: string;
  readonly effort: string;
  /** The reader-facing description, Markdown. */
  readonly description: string;
  readonly minAppVersion: string;
  /** Every partial the entry calls, directly or through another partial. */
  readonly calls: readonly string[];
  /** The artifact, byte for byte, as the reader downloads it. */
  readonly file: { readonly name: string; readonly text: string };
  /** What the reader pastes: the whole document for a Profile, the part a field takes for a recipe. */
  readonly copyText: string;
  readonly details: EntryDetails;
  readonly notes: readonly NoteSampleView[];
  readonly annotations: readonly AnnotationSampleView[];
}

/** What the page needs to say where a recipe goes. */
export type EntryDetails =
  | { readonly kind: "profile" }
  | { readonly kind: "partial"; readonly context: PartialContext }
  | { readonly kind: "citation" }
  | { readonly kind: "note-name" }
  | {
      readonly kind: "property";
      /** The property name; null for a Spread Entry, which names its own. */
      readonly key: string | null;
      readonly merge: "replace" | "append" | "keep";
    };

/** One Directory Sample, as the entry renders it. */
export interface NoteSampleView {
  readonly id: string;
  /** The item type as a reader names it. */
  readonly label: string;
  readonly noteName: string | null;
  /** The properties the entry writes, in order; null when it writes none. */
  readonly properties: readonly SampleProperty[] | null;
  /** The same properties as the note's YAML block. */
  readonly frontmatter: string | null;
  /** The note body, Markdown; null for an entry that writes no body. */
  readonly body: string | null;
}

export interface SampleProperty {
  readonly key: string;
  /** The value as the note shows it; a list shows each item on its own. */
  readonly value: string | readonly string[];
}

/** One Sample Annotation, as the entry's annotation format renders it. */
export interface AnnotationSampleView {
  readonly id: string;
  readonly label: string;
  readonly output: string | null;
}

/** The fields of an entry the index page searches and lists. */
export function indexedEntry(entry: SiteEntry): IndexedEntry {
  const {
    id,
    kind,
    level,
    title,
    summary,
    tasks,
    itemTypes,
    features,
    problems,
    keywords,
    recommended,
  } = entry;
  return {
    id,
    kind,
    level,
    title,
    summary,
    tasks,
    itemTypes,
    features,
    problems,
    keywords,
    recommended,
  };
}
