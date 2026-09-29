// The Directory Entry format: entry kinds, facet vocabularies, and the schema of an entry's `entry.md` metadata.

import * as v from "valibot";

import ir from "@zotlit/db/contract/ir.json" with { type: "json" };

/**
 * Every kind of Directory Entry, with the folder its entries live in and the
 * file name of the artifact a reader imports or copies.
 */
export const ENTRY_KINDS = {
  profile: {
    folder: "profiles",
    artifact: (slug: string) => `zotlit-profile.${slug}.md`,
  },
  partial: {
    folder: "partials",
    artifact: (slug: string) => `zotlit-partial.${slug}.md`,
  },
  citation: {
    folder: "citations",
    artifact: () => "zotlit-citation.md",
  },
  "note-name": {
    folder: "note-names",
    artifact: () => "note-name.liquid",
  },
  property: {
    folder: "properties",
    artifact: () => "property.yaml",
  },
} as const satisfies Record<
  string,
  { folder: string; artifact: (slug: string) => string }
>;

export type EntryKind = keyof typeof ENTRY_KINDS;

/**
 * Profile entries are ready-made setups; every other kind is a recipe for a
 * reader who customizes.
 */
export type EntryLevel = "ready-to-use" | "customize";

/** The research tasks a reader searches by, with the label a reader sees. */
export const RESEARCH_TASKS = {
  "general-reading": "General reading",
  "literature-review": "Literature review",
  "close-reading": "Close reading",
  "reading-books": "Reading books",
  "archival-research": "Archive sources",
  teaching: "Teaching and course reading",
  writing: "Writing with citations",
} as const;

export type ResearchTask = keyof typeof RESEARCH_TASKS;

/** What a note or recipe offers, as a reader filters for it. */
export const ENTRY_FEATURES = {
  "source-links": "Links to Zotero, the PDF, the DOI, and the web page",
  abstract: "Folded abstract",
  "page-links": "Page links",
  comments: "Zotero comments under highlights",
  images: "Image annotations",
  "color-highlights": "Highlight colors",
  "grouped-by-color": "Annotations grouped by color",
  "own-notes": "A place for your own notes",
  prompts: "Reading prompts",
  properties: "Properties for Bases",
  "child-notes": "Zotero child notes",
  "related-items": "Related items",
  "block-references": "Block references",
  tasks: "Tasks from comments",
  citations: "In-text citations",
} as const;

export type EntryFeature = keyof typeof ENTRY_FEATURES;

/** The Root a Shared Partial renders with, which decides where it can be called. */
export const PARTIAL_CONTEXTS = ["note", "annotation", "citation"] as const;

export type PartialContext = (typeof PARTIAL_CONTEXTS)[number];

/** Every Zotero item type the current template contract knows. */
export const ITEM_TYPES: readonly string[] = Object.keys(ir.itemTypes);

const text = v.pipe(v.string(), v.trim(), v.nonEmpty());

const facets = {
  tasks: v.pipe(
    v.array(v.picklist(Object.keys(RESEARCH_TASKS) as ResearchTask[])),
    v.nonEmpty(),
  ),
  /** Item types the entry is made for; an empty list means any item type. */
  itemTypes: v.optional(v.array(v.picklist(ITEM_TYPES)), []),
  features: v.optional(
    v.array(v.picklist(Object.keys(ENTRY_FEATURES) as EntryFeature[])),
    [],
  ),
  /** The problems the entry solves, in the reader's own words. */
  problems: v.pipe(v.array(text), v.nonEmpty()),
  /** Search words, including ZotLit v1 and Zotero Integration vocabulary. */
  keywords: v.optional(v.array(text), []),
  recommended: v.optional(v.boolean(), false),
  /** Who the entry is for. */
  audience: text,
  /** What the entry asks of the reader before it works. */
  effort: text,
};

/** What a recipe states for itself; a Profile states it in its manifest. */
const recipe = {
  title: text,
  summary: text,
  minAppVersion: text,
};

/**
 * One property entry's result for a Directory Sample: the properties it
 * writes, by name. A property the mapping leaves out is one the entry makes
 * absent for that sample.
 */
const expectedProperties = v.record(
  v.string(),
  v.record(v.string(), v.unknown()),
);

export const ENTRY_METADATA_SCHEMAS = {
  profile: v.strictObject(facets),
  partial: v.strictObject({
    ...facets,
    ...recipe,
    context: v.picklist(PARTIAL_CONTEXTS),
  }),
  citation: v.strictObject({ ...facets, ...recipe }),
  "note-name": v.strictObject({ ...facets, ...recipe }),
  property: v.strictObject({
    ...facets,
    ...recipe,
    expected: v.optional(expectedProperties, {}),
  }),
} as const satisfies Record<EntryKind, v.GenericSchema>;

export type EntryMetadata<K extends EntryKind = EntryKind> = v.InferOutput<
  (typeof ENTRY_METADATA_SCHEMAS)[K]
>;
