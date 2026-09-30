// Node-only: builds the site's Directory data from the verified Directory, and hands it to the app as a virtual module when the site builds.

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { parseLiteratureNoteTemplate } from "@zotlit/templates/facade";
import { ITEM_TYPES as ZOTERO_ITEM_TYPES } from "@zotlit/zotero-types/item-types";

import { partialCall } from "./calls.ts";
import { colorKey } from "./color-key.ts";
import { ENTRY_FEATURES, ENTRY_KINDS, RESEARCH_TASKS } from "./entry.ts";
import type { DirectoryEntry } from "./load.ts";
import { matchedItemTypes } from "./profile-samples.ts";
import { readTemplateDirectory, templateDirectoryRoot } from "./read.ts";
import { DIRECTORY_SAMPLES } from "./samples.ts";
import type { Facet } from "./search.ts";
import { entryId } from "./site.ts";
import type {
  DirectorySite,
  EntryDetails,
  FacetOption,
  NoteSampleView,
  ProfileSource,
  SampleProperty,
  SiteEntry,
} from "./site.ts";
import { verifyTemplateDirectory } from "./verify.ts";
import type {
  DirectoryVerification,
  EntrySamples,
  NoteSample,
} from "./verify.ts";

/** The Directory of the checked-out repository, as the site publishes it. */
export async function loadDirectorySite(): Promise<DirectorySite> {
  const files = await readTemplateDirectory(await templateDirectoryRoot());
  return directorySite(verifyTemplateDirectory(files));
}

/**
 * The site's Directory data: every entry the Directory loads, with its
 * rendered samples. An entry that breaks a rule still shows; the verification
 * suite is what keeps it out of a release.
 */
export function directorySite({
  entries,
  samples,
}: DirectoryVerification): DirectorySite {
  const siteEntries = entries.map((entry) =>
    siteEntry(entry, samples.get(entry.id), entries),
  );
  return { entries: siteEntries, facets: facetOptions(siteEntries) };
}

function siteEntry(
  entry: DirectoryEntry,
  samples: EntrySamples | undefined,
  entries: readonly DirectoryEntry[],
): SiteEntry {
  return {
    id: entry.id,
    kind: entry.kind,
    level: entry.level,
    title: entry.title,
    summary: entry.summary,
    tasks: entry.tasks,
    itemTypes: entry.itemTypes,
    features: entry.features,
    problems: entry.problems,
    keywords: entry.keywords,
    recommended: entry.recommended,
    audience: entry.audience,
    effort: entry.effort,
    description: entry.description,
    minAppVersion: entry.minAppVersion,
    matchedItemTypes: entry.kind === "profile" ? matchedItemTypes(entry) : null,
    calls: entry.calls,
    file: { name: downloadName(entry), text: entry.artifact.source },
    copyText: copyText(entry),
    details: details(entry),
    profileSource:
      entry.kind === "profile" ? profileSource(entry, entries) : null,
    colorKey:
      entry.kind === "profile" && entry.features.includes("color-highlights")
        ? colorKey(samples?.annotations ?? [], meaningsEntry(entry, entries))
        : null,
    notes: (samples?.notes ?? []).map((note) => noteView(note, entry)),
    annotations: samples?.annotations ?? [],
    citations: samples?.citations ?? [],
  };
}

/**
 * One example's note. For a Profile, the properties the Profile sets come
 * first, then the two ZotLit adds to every note, which `renderProfile` leaves
 * out: `zotero-key` with the item's key, and `zotlit-profile` with the stamp
 * as a note carries it.
 */
function noteView(
  { sample, noteName, properties, itemKey, body }: NoteSample,
  entry: DirectoryEntry,
): NoteSampleView {
  const set = properties === null ? [] : propertyRows(properties, "set");
  if (entry.kind !== "profile" || itemKey === undefined) {
    return {
      id: sample.id,
      noteName,
      properties: properties === null ? null : set,
      frontmatter: properties,
      body,
    };
  }
  const system = yamlBlock({
    "zotero-key": itemKey,
    // The stamp the plugin writes: the Profile's label, then its ID in parentheses.
    "zotlit-profile": `${entry.manifest.name.trim()} (${entry.manifest.id})`,
  });
  return {
    id: sample.id,
    noteName,
    properties: [...set, ...propertyRows(system, "system")],
    frontmatter: `${properties ?? ""}${system}`,
    body,
  };
}

/** Properties as Obsidian writes them into a note's YAML block. */
function yamlBlock(values: Record<string, string>): string {
  return stringifyYaml(values, {
    nullStr: "",
    lineWidth: 0,
    aliasDuplicateObjects: false,
  });
}

/**
 * The partial entry that sets the color meanings a Profile brings: the one
 * of its partials named "color-meanings…", which the key links.
 */
function meaningsEntry(
  { calls }: DirectoryEntry,
  entries: readonly DirectoryEntry[],
): string | null {
  const name = calls.find((call) => call.startsWith("color-meanings"));
  return (
    entries.find(({ kind, slug }) => kind === "partial" && slug === name)?.id ??
    null
  );
}

/**
 * The name a download carries. A Profile, a partial, and the citation text
 * keep the name ZotLit reads in the template folder; a note name and a
 * property go into a field rather than a file, so their download is named
 * after the entry, and two downloads never share a name.
 */
function downloadName(entry: DirectoryEntry): string {
  switch (entry.kind) {
    case "note-name":
      return `zotlit-note-name.${entry.slug}.liquid`;
    case "property":
      return `zotlit-property.${entry.slug}.yaml`;
    default:
      return entry.artifact.fileName;
  }
}

/** What the reader pastes into the place the entry goes. */
function copyText(entry: DirectoryEntry): string {
  switch (entry.kind) {
    case "profile":
      return entry.artifact.source;
    case "partial":
    case "citation":
      return entry.source;
    case "note-name":
      return entry.source.trimEnd();
    case "property":
      return "value" in entry.property
        ? JSON.stringify(entry.property.value, null, 2)
        : entry.artifact.source;
  }
}

/**
 * The parts of a Profile's file the page folds: the note part, and the
 * partials the file packs in the order its note first names them.
 */
function profileSource(
  entry: Extract<DirectoryEntry, { kind: "profile" }>,
  entries: readonly DirectoryEntry[],
): ProfileSource {
  const { source } = entry.artifact;
  const { bodyStart } = parseLiteratureNoteTemplate(source);
  const note = source.slice(bodyStart);
  const namedAt = (name: string) => {
    const at = note.indexOf(`"${name}"`);
    return at === -1 ? note.length : at;
  };
  return {
    note,
    partials: (entry.manifest.partials ?? [])
      .map(({ name }) => name)
      .toSorted((a, b) => namedAt(a) - namedAt(b))
      .map((name) => {
        const id = entryId("partials", name);
        const exists = entries.some(
          (candidate) => candidate.kind === "partial" && candidate.id === id,
        );
        return { name, id: exists ? id : null };
      }),
  };
}

function details(entry: DirectoryEntry): EntryDetails {
  switch (entry.kind) {
    case "partial":
      return {
        kind: entry.kind,
        context: entry.context,
        call: partialCall(entry),
      };
    case "property":
      return {
        kind: entry.kind,
        key: entry.property.key ?? null,
        merge: entry.property.merge,
      };
    default:
      return { kind: entry.kind };
  }
}

/** A note's YAML block as rows, in the order the note holds them. */
function propertyRows(
  yaml: string,
  mark: SampleProperty["mark"],
): SampleProperty[] {
  const values = (parseYaml(yaml) ?? {}) as Record<string, unknown>;
  return Object.entries(values).map(([key, value]) => ({
    key,
    mark,
    value:
      value === null
        ? null
        : Array.isArray(value)
          ? value.map(valueText)
          : valueText(value),
  }));
}

function valueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

/** Each facet's values that some entry holds, in the vocabulary's own order. */
function facetOptions(
  entries: readonly SiteEntry[],
): Record<Facet, FacetOption[]> {
  const held = (values: (entry: SiteEntry) => readonly string[]) =>
    new Set(entries.flatMap(values));
  const tasks = held(({ tasks }) => tasks);
  const features = held(({ features }) => features);
  const kinds = held(({ kind }) => [kind]);
  const levels = held(({ level }) => [level]);
  return {
    task: RESEARCH_TASKS.filter((value) => tasks.has(value)).map((value) => ({
      value,
    })),
    kind: Object.keys(ENTRY_KINDS)
      .filter((value) => kinds.has(value))
      .map((value) => ({ value })),
    itemType: itemTypeOptions(held(({ itemTypes }) => itemTypes)),
    feature: ENTRY_FEATURES.filter((value) => features.has(value)).map(
      (value) => ({ value }),
    ),
    level: ["ready-to-use", "customize"]
      .filter((value) => levels.has(value))
      .map((value) => ({ value })),
  };
}

/**
 * The item types every entry renders over, then any other type an entry is
 * made for. An entry for any item type fits each of them.
 */
function itemTypeOptions(named: ReadonlySet<string>): FacetOption[] {
  const sampled = [
    ...new Set(DIRECTORY_SAMPLES.map(({ snapshot }) => snapshot.item.itemType)),
  ];
  const others = ZOTERO_ITEM_TYPES.map(({ name }) => name).filter(
    (name) => named.has(name) && !sampled.includes(name),
  );
  return [...sampled, ...others].map((value) => ({ value }));
}
