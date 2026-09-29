// Behaviour of the Primary sources and archives and the Course reading Profile
// entries, including the cases no Directory Sample shows.

import { describe, expect, it } from "vitest";

import { TemplateFacade } from "@zotlit/templates/facade";
import { evalManagedFrontmatterEntries } from "@zotlit/templates/frontmatter";
import {
  FRONTMATTER_ABSENT,
  mergeManagedFrontmatterEntries,
} from "@zotlit/templates/frontmatter-merge";
import { compileFilter, matchCondition } from "@zotlit/workbench/match";
import {
  renderProfile,
  restoreTemplateData,
  SAMPLE_ITEMS,
} from "@zotlit/workbench/render";
import type { ItemSnapshot } from "@zotlit/workbench/snapshot";

import {
  DIRECTORY_SAMPLES,
  ITEM_TYPES,
  readTemplateDirectory,
  templateDirectoryRoot,
  verifyTemplateDirectory,
} from "./index";
import type { DirectoryEntry } from "./index";

type ProfileEntry = Extract<DirectoryEntry, { kind: "profile" }>;

const verification = verifyTemplateDirectory(
  await readTemplateDirectory(await templateDirectoryRoot()),
);

function profile(slug: string): ProfileEntry {
  const entry = verification.entries.find(
    ({ id }) => id === `profiles/${slug}`,
  );
  expect(entry?.kind, slug).toBe("profile");
  return entry as ProfileEntry;
}

/** A property entry's Managed Frontmatter entry, as a reader pastes it. */
function propertyRule(slug: string) {
  const entry = verification.entries.find(
    ({ id }) => id === `properties/${slug}`,
  );
  expect(entry?.kind, slug).toBe("property");
  return (entry as Extract<DirectoryEntry, { kind: "property" }>).property;
}

function sample(id: string): ItemSnapshot {
  return DIRECTORY_SAMPLES.find((entry) => entry.id === id)!.snapshot;
}

/**
 * A Directory Sample with some of its item fields changed. The descriptors of
 * a changed field describe its old value, so they go with it; a new value's
 * Temporal descriptors come in `temporalValues`.
 */
function sampleWith(
  id: string,
  fields: Record<string, unknown>,
  temporalValues: ItemSnapshot["descriptors"]["note"]["temporalValues"] = [],
): ItemSnapshot {
  const snapshot = sample(id);
  const kept = ({ path }: { path: readonly unknown[] }) =>
    !Object.hasOwn(fields, String(path[0]));
  const { note } = snapshot.descriptors;
  return {
    ...snapshot,
    roots: { ...snapshot.roots, note: { ...snapshot.roots.note, ...fields } },
    descriptors: {
      ...snapshot.descriptors,
      note: {
        ...note,
        stringCoercions: note.stringCoercions.filter(kept),
        temporalValues: [
          ...note.temporalValues.filter(kept),
          ...temporalValues,
        ],
      },
    },
  };
}

/** The properties a new note under the Profile gets for the item. */
function written(
  { artifact }: ProfileEntry,
  item: ItemSnapshot,
): Record<string, unknown> {
  const result = renderProfile(artifact.source, item);
  expect(result.diagnostics).toEqual([]);
  return Object.fromEntries(
    result.fold.flatMap(({ key, value, missing }) =>
      missing ? [] : [[key, value]],
    ),
  );
}

/**
 * A note's properties after an update under the Profile, through the steps
 * the plugin takes: compile and evaluate each rule, then merge it into the
 * properties the note holds.
 */
function updated(
  { manifest }: ProfileEntry,
  item: ItemSnapshot,
  current: Record<string, unknown>,
): Record<string, unknown> {
  const { compiled } = new TemplateFacade().compileManagedFrontmatterEntries(
    manifest.frontmatter ?? [],
    { javascript: false },
  );
  const { values, errors } = evalManagedFrontmatterEntries(
    compiled,
    restoreTemplateData(item.roots.note, item.descriptors.note),
    Temporal.Now.instant(),
  );
  expect(errors).toEqual([]);
  const patch = mergeManagedFrontmatterEntries(values, { current });
  return Object.fromEntries(
    Object.entries({ ...current, ...patch }).filter(
      ([, value]) => value !== FRONTMATTER_ABSENT,
    ),
  );
}

function pick(
  properties: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).filter(([key]) => keys.includes(key)),
  );
}

/**
 * The headings a new note holds after the part ZotLit refreshes on update,
 * where the reader writes.
 */
function ownSections({ artifact }: ProfileEntry): string[] {
  const { creationBody } = renderProfile(artifact.source, sample("letter"));
  const [, own] = creationBody!.split("%%/zt-managed%%\n");
  return own!.split("\n").filter((line) => line.startsWith("#"));
}

/** The item types a Profile's match selects automatically. */
function selectedItemTypes({ manifest }: ProfileEntry): string[] {
  if (manifest.match === undefined) return [];
  const { condition } = compileFilter(manifest.match);
  return ITEM_TYPES.filter((itemType) =>
    matchCondition(condition!, {
      library: null,
      itemType,
      tags: [],
      collections: [],
    }),
  );
}

describe("the Primary sources and archives profile", () => {
  const entry = profile("primary-sources-and-archives");

  it("is chosen automatically for letters, manuscripts, interviews, documents, and newspaper articles, and nothing else", () => {
    expect(selectedItemTypes(entry).toSorted()).toEqual([
      "document",
      "interview",
      "letter",
      "manuscript",
      "newspaperArticle",
    ]);
  });

  it.each([
    [
      "letter",
      {
        archive: "Brackenridge County Record Office",
        "archive-location": "Aldous papers, box 3, folder 12",
      },
    ],
    [
      "manuscript",
      {
        archive: "Brackenridge County Record Office",
        "archive-location": "Aldous papers, box 1, item 4",
      },
    ],
    [
      "interview",
      {
        archive: "Riverside Community Archive",
        "archive-location": "OH-2019-014",
      },
    ],
    [
      "document",
      {
        archive: "Brackenridge Free Library archives",
        "archive-location": "Board minutes, vol. 7",
      },
    ],
    ["journal-article", {}],
  ])("records where the %s is kept", (id, expected) => {
    expect(
      pick(written(entry, sample(id)), ["archive", "archive-location"]),
    ).toEqual(expected);
  });

  // Obsidian reads a `date` value as a calendar day and shows "1885" as
  // 1885-01-01, so `date` holds a full date only, and `year` dates the rest.
  it.each([
    ["a full date", sample("letter"), { date: "1887-03-14", year: 1887 }],
    ["a year only", sample("manuscript"), { year: 1885 }],
    [
      "a month and a year",
      sampleWith(
        "letter",
        {
          date: {
            kind: "yearMonth",
            value: "1887-03",
            year: 1887,
            month: 3,
            day: null,
            raw: "1887-03-00 March 1887",
          },
        },
        [{ path: ["date", "value"], type: "Temporal.PlainYearMonth" }],
      ),
      { year: 1887 },
    ],
    [
      "a date in words that holds a year",
      sampleWith("letter", {
        date: {
          kind: "text",
          value: null,
          text: "Spring 1887",
          year: 1887,
          month: null,
          day: null,
          raw: "Spring 1887",
        },
      }),
      { year: 1887 },
    ],
    [
      "a date in words with no year",
      sampleWith("letter", {
        date: {
          kind: "text",
          value: null,
          text: "undated",
          year: null,
          month: null,
          day: null,
          raw: "undated",
        },
      }),
      {},
    ],
    ["no date", sampleWith("letter", { date: null }), {}],
  ])("dates a source with %s", (_, item, expected) => {
    expect(pick(written(entry, item), ["date", "year"])).toEqual(expected);
  });

  it.each([
    ["a manuscript's place", sample("manuscript"), { place: "Brackenridge" }],
    [
      "the place a letter was written, which Zotero keeps in its own field",
      sampleWith("letter", { eventPlace: "Brackenridge Mill" }),
      { place: "Brackenridge Mill" },
    ],
    ["no place for a letter that records none", sample("letter"), {}],
  ])("writes %s", (_, item, expected) => {
    expect(pick(written(entry, item), ["place"])).toEqual(expected);
  });

  it("names the newspaper a newspaper article appeared in", () => {
    const article = sampleWith("journal-article", {
      itemType: "newspaperArticle",
      title: "Flood closes the Brackenridge mill",
      publicationTitle: "The Brackenridge Courier",
      containerTitle: "The Brackenridge Courier",
    });
    expect(pick(written(entry, article), ["item-type", "venue"])).toEqual({
      "item-type": "Newspaper Article",
      venue: "The Brackenridge Courier",
    });
  });

  it("follows each quote in the note with its citation and page", () => {
    const { managedRegion } = renderProfile(
      entry.artifact.source,
      SAMPLE_ITEMS[1]!,
    );
    expect(managedRegion).toContain(
      "> A reproducible interface makes its inputs and outputs inspectable. [@riveraResearchInterfaces2026, {p. 1}]",
    );
  });

  it.each([
    "title",
    "authors",
    "year",
    "item-type",
    "venue",
    "citekey",
    "tags",
  ])("carries the %s property entry's rule unchanged", (slug) => {
    expect(entry.manifest.frontmatter).toContainEqual(propertyRule(slug));
  });

  it("leaves context, content, and connections to the reader, outside the part an update refreshes", () => {
    expect(ownSections(entry)).toEqual([
      "## Context",
      "## Content",
      "## Connections",
    ]);
  });
});

describe("the Course reading profile", () => {
  const entry = profile("course-reading");

  it("is never chosen automatically, so it takes no item from another profile", () => {
    expect(entry.manifest.match).toBeUndefined();
  });

  it("gives a new note empty course and week properties and an unread status", () => {
    expect(
      pick(written(entry, sample("book")), ["course", "week", "status"]),
    ).toEqual({ course: null, week: null, status: "unread" });
  });

  it("keeps the course, week, and status the reader set when the note updates", () => {
    const after = updated(entry, sample("book"), {
      title: "An old title",
      course: "HIST 210",
      week: 3,
      status: "read",
    });
    expect(pick(after, ["title", "course", "week", "status"])).toEqual({
      title: "Thinking, fast and slow",
      course: "HIST 210",
      week: 3,
      status: "read",
    });
  });

  it("leaves a summary, key points, and discussion questions to the reader, outside the part an update refreshes", () => {
    expect(ownSections(entry)).toEqual([
      "## Summary",
      "## Key points",
      "## Discussion questions",
    ]);
  });

  it.each(["title", "authors", "year", "venue", "citekey", "tags", "status"])(
    "carries the %s property entry's rule unchanged",
    (slug) => {
      expect(entry.manifest.frontmatter).toContainEqual(propertyRule(slug));
    },
  );
});
