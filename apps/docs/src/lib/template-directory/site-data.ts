// Node-only: builds the site's Directory data from the verified Directory, and hands it to the app as a virtual module when the site builds.

import { parse as parseYaml } from "yaml";

import { ITEM_TYPES as ZOTERO_ITEM_TYPES } from "@zotlit/zotero-types/item-types";

import { partialCall } from "./calls.ts";
import { ENTRY_FEATURES, ENTRY_KINDS, RESEARCH_TASKS } from "./entry.ts";
import type { DirectoryEntry } from "./load.ts";
import { readTemplateDirectory, templateDirectoryRoot } from "./read.ts";
import { DIRECTORY_SAMPLES } from "./samples.ts";
import type { Facet } from "./search.ts";
import type {
  DirectorySite,
  EntryDetails,
  FacetOption,
  NoteSampleView,
  SampleProperty,
  SiteEntry,
} from "./site.ts";
import { verifyTemplateDirectory } from "./verify.ts";
import type { DirectoryVerification, EntrySamples } from "./verify.ts";

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
    siteEntry(entry, samples.get(entry.id)),
  );
  return { entries: siteEntries, facets: facetOptions(siteEntries) };
}

function siteEntry(
  entry: DirectoryEntry,
  samples: EntrySamples | undefined,
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
    calls: entry.calls,
    file: { name: downloadName(entry), text: entry.artifact.source },
    copyText: copyText(entry),
    details: details(entry),
    notes: (samples?.notes ?? []).map(
      ({ sample, noteName, properties, body }): NoteSampleView => ({
        id: sample.id,
        label: sample.label,
        noteName,
        properties: properties === null ? null : propertyRows(properties),
        frontmatter: properties,
        body,
      }),
    ),
    annotations: (samples?.annotations ?? []).map((annotation) => ({
      ...annotation,
      label:
        annotation.label.charAt(0).toUpperCase() + annotation.label.slice(1),
    })),
    citations: samples?.citations ?? [],
  };
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
function propertyRows(yaml: string): SampleProperty[] {
  const values = (parseYaml(yaml) ?? {}) as Record<string, unknown>;
  return Object.entries(values).map(([key, value]) => ({
    key,
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
    task: Object.entries(RESEARCH_TASKS)
      .filter(([value]) => tasks.has(value))
      .map(([value, label]) => ({ value, label })),
    kind: Object.keys(ENTRY_KINDS)
      .filter((value) => kinds.has(value))
      .map((value) => ({ value })),
    itemType: itemTypeOptions(held(({ itemTypes }) => itemTypes)),
    feature: Object.entries(ENTRY_FEATURES)
      .filter(([value]) => features.has(value))
      .map(([value, label]) => ({ value, label })),
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
  const sampled = DIRECTORY_SAMPLES.map(({ label, snapshot }) => ({
    value: snapshot.item.itemType,
    label,
  }));
  const others = ZOTERO_ITEM_TYPES.filter(
    ({ name }) =>
      named.has(name) && !sampled.some(({ value }) => value === name),
  ).map(({ name, labels }) => ({ value: name, label: labels["en-US"] }));
  return [...sampled, ...others];
}
