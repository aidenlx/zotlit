// The Template Directory as the docs site publishes it: the data each page reads, and where each page lives.

import type { EntryKind, PartialContext } from "./entry.ts";
import type { SampleName } from "./samples.ts";
import type { Facet, IndexedEntry } from "./search.ts";
import type { AnnotationColor } from "./verify.ts";

/** The index page's path; each entry page sits below it at its entry id. */
export const DIRECTORY_PATH = "/templates";

/**
 * An entry's id: the folder of its kind and its slug, which its page path, its
 * card URL, and its Markdown edition repeat.
 */
export function entryId(folder: string, slug: string): string {
  return `${folder}/${slug}`;
}

/** The kind folder and the slug an entry id joins. */
export function entryIdParts(id: string): [folder: string, slug: string] {
  const separator = id.indexOf("/");
  return [id.slice(0, separator), id.slice(separator + 1)];
}

export function entryPath(id: string): string {
  return `${DIRECTORY_PATH}/${id}`;
}

/** Everything the Directory's pages show, built from the Directory when the site builds. */
export interface DirectorySite {
  readonly entries: readonly SiteEntry[];
  /** The values each facet offers, in the order the index lists them. */
  readonly facets: Readonly<Record<Facet, readonly FacetOption[]>>;
}

/** One value a facet offers; the site's messages name it. */
export interface FacetOption {
  readonly value: string;
}

/** One entry page's content. */
export interface SiteEntry extends IndexedEntry {
  /** The reader-facing description, Markdown. */
  readonly description: string;
  readonly minAppVersion: string;
  /**
   * A Profile only: the item types its match takes, which it is chosen for
   * automatically; null when the reader chooses it for each note.
   */
  readonly matchedItemTypes: readonly string[] | null;
  /** Every partial the entry calls, directly or through another partial, by name. */
  readonly calls: readonly string[];
  /** The partial entries behind `calls`, in that order, as the page links them. */
  readonly calledPartials: readonly PartialLink[];
  /** The artifact, byte for byte, as the reader downloads it. */
  readonly file: { readonly name: string; readonly text: string };
  /** What the reader pastes: the whole document for a Profile, the part a field takes for a recipe. */
  readonly copyText: string;
  readonly details: EntryDetails;
  /** A Profile only: the parts of its file the page folds under Source; null for every other kind. */
  readonly profileSource: ProfileSource | null;
  /**
   * A Profile only: what each Zotero highlight color means in its notes;
   * null when its highlights do not differ by color.
   */
  readonly colorKey: ColorKey | null;
  readonly notes: readonly NoteSampleView[];
  readonly annotations: readonly AnnotationSampleView[];
  /** Citation text entries only: each citation it inserts. */
  readonly citations: readonly CitationSampleView[];
}

/** What a Profile's Source section folds beside the whole file. */
export interface ProfileSource {
  /** The note part of the file: from the end of its manifest through the Annotation Section. */
  readonly note: string;
  /** The partials the file packs, one tab each. */
  readonly partials: readonly SourcePartial[];
}

/** A partial entry as a page links it: its id, and the words that name and describe it. */
export interface PartialLink {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
}

/** A partial a Profile packs, by the name its calls use. */
export interface SourcePartial {
  readonly name: string;
  /** The partial's own entry, when the Directory has one. */
  readonly page: PartialLink | null;
}

/** The meaning each Zotero highlight color has in a Profile's notes. */
export interface ColorKey {
  readonly rows: readonly ColorKeyRow[];
  /** The id of the entry that explains how to change the meanings; null when the Profile brings none. */
  readonly changeWith: string | null;
}

export interface ColorKeyRow {
  /** The Zotero color's name; null for every other color. */
  readonly color: string | null;
  /** The color's hex, for its swatch; null for every other color. */
  readonly hex: string | null;
  /** The callout title the Profile gives the color. */
  readonly meaning: string;
}

/** What the page needs to say where a recipe goes. */
export type EntryDetails =
  | { readonly kind: "profile" }
  | {
      readonly kind: "partial";
      readonly context: PartialContext;
      /** The Liquid a Profile writes to call the partial. */
      readonly call: string;
    }
  | { readonly kind: "citation" }
  | { readonly kind: "note-name" }
  | {
      readonly kind: "property";
      /** The property name; null for a Spread Entry, which names its own. */
      readonly key: string | null;
      readonly merge: "replace" | "append" | "keep";
    };

/** One Directory Sample, as the entry renders it; the site's messages name it. */
export interface NoteSampleView extends SampleName {
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
  /**
   * Where the property comes from: "set" for one the entry's rule writes,
   * "system" for one of the two ZotLit adds to every Profile's note.
   */
  readonly mark: "set" | "system";
  /**
   * The value as the note shows it; a list shows each item on its own, and
   * null is a property the reader fills in.
   */
  readonly value: string | readonly string[] | null;
}

/** One citation, as a citation text inserts it under each variant. */
/** The example it cites is named by the site's messages. */
export interface CitationSampleView extends SampleName {
  readonly main: string | null;
  readonly alt: string | null;
}

/** One Sample Annotation, as the entry's annotation format renders it. */
export interface AnnotationSampleView {
  readonly id: string;
  /** The annotation's type and color, which name it. */
  readonly type: string;
  readonly color: AnnotationColor;
  readonly output: string | null;
}

/** A note's raw Markdown, as ZotLit writes it: the YAML block, then the body. */
export function noteMarkdown({
  frontmatter,
  body,
}: Pick<NoteSampleView, "frontmatter" | "body">): string {
  const block = frontmatter === null ? "" : `---\n${frontmatter}---\n`;
  return `${block}${body ?? ""}`;
}

/** An entry that is a part of a note: a partial, a property, a note name, or a citation text. */
export type PartEntry = SiteEntry & {
  readonly kind: Exclude<EntryKind, "profile">;
};

export function isPartEntry(entry: SiteEntry): entry is PartEntry {
  return entry.kind !== "profile";
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
