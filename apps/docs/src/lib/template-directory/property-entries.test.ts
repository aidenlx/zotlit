import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { renderProfile } from "@zotlit/workbench/render";
import type { ItemSnapshot } from "@zotlit/workbench/snapshot";

import {
  DIRECTORY_SAMPLES,
  loadTemplateDirectory,
  readTemplateDirectory,
  templateDirectoryRoot,
} from "./index";
import type { DirectoryEntry } from "./index";
import { harnessProfile } from "./load.ts";

// Property entries over item data no Directory Sample holds: every field of a
// composed value, and titles YAML must quote.

type PropertyEntry = Extract<DirectoryEntry, { kind: "property" }>;

const { entries } = loadTemplateDirectory(
  await readTemplateDirectory(await templateDirectoryRoot()),
);
const properties = entries.filter(
  (entry): entry is PropertyEntry => entry.kind === "property",
);

/**
 * A Directory Sample with some of its item fields changed. The descriptors of
 * a changed field describe its old value, so they go with it.
 */
function sampleWith(id: string, fields: Record<string, unknown>): ItemSnapshot {
  const { snapshot } = DIRECTORY_SAMPLES.find((sample) => sample.id === id)!;
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
        temporalValues: note.temporalValues.filter(kept),
      },
    },
  };
}

function render(entry: PropertyEntry, item: ItemSnapshot) {
  const result = renderProfile(
    harnessProfile({ frontmatter: [entry.property] }),
    item,
  );
  expect(result.diagnostics).toEqual([]);
  return {
    block: result.frontmatterBlock,
    written: Object.fromEntries(
      result.fold.flatMap(({ key, value, missing }) =>
        missing ? [] : [[key, value]],
      ),
    ),
  };
}

describe("property entries", () => {
  it.each(properties.map((entry) => [entry.id, entry] as const))(
    "%s writes valid YAML for a title with a colon and quotation marks",
    (_, entry) => {
      const item = sampleWith("journal-article", {
        title: `Why "Most" Published Research Findings Are 'False': A Reply`,
      });
      const { block, written } = render(entry, item);
      expect(block === null ? {} : parseYaml(block)).toEqual(written);
    },
  );
});

function property(slug: string): PropertyEntry {
  return properties.find(({ id }) => id === `properties/${slug}`)!;
}

// Discussion #1197: one `publisher` property whose content depends on the item type.
describe("the publisher by item type entry", () => {
  const entry = property("publisher-by-item-type");

  it.each([
    [
      "a journal article with every part",
      sampleWith("journal-article", { volume: "2", issue: "8", pages: "e124" }),
      { publisher: "PLoS Medicine. 2005. Vol. 2. № 8. pp. e124." },
    ],
    [
      "a journal article whose pages hold a hyphen",
      sampleWith("journal-article", {
        volume: "2",
        issue: "8",
        pages: "10-20",
      }),
      { publisher: "PLoS Medicine. 2005. Vol. 2. № 8. pp. 10–20." },
    ],
    [
      "a journal article with no issue",
      sampleWith("journal-article", {
        volume: "2",
        issue: null,
        pages: "e124",
      }),
      { publisher: "PLoS Medicine. 2005. Vol. 2. pp. e124." },
    ],
    [
      "a journal article with no volume",
      sampleWith("journal-article", {
        volume: null,
        issue: "8",
        pages: "e124",
      }),
      { publisher: "PLoS Medicine. 2005. № 8. pp. e124." },
    ],
    [
      "a journal article with no journal and no date",
      sampleWith("journal-article", {
        containerTitle: null,
        publicationTitle: null,
        date: null,
        volume: null,
        issue: null,
        pages: null,
      }),
      {},
    ],
    [
      "a book chapter with no pages",
      sampleWith("book-section", { pages: null }),
      { publisher: "Judgment under Uncertainty: Heuristics and Biases." },
    ],
    [
      "a thesis with its university",
      sampleWith("thesis", { publisher: "Example University" }),
      { publisher: "Example University" },
    ],
  ])("writes the form for %s", (_, item, expected) => {
    expect(render(entry, item).written).toEqual(expected);
  });
});

describe("the aliases entry", () => {
  it("names the first author and et al. for three or more authors", () => {
    const [author] = DIRECTORY_SAMPLES.find(
      ({ id }) => id === "journal-article",
    )!.snapshot.roots.note.authors as Record<string, unknown>[];
    const item = sampleWith("journal-article", {
      authors: ["Ioannidis", "Rivera", "Chen"].map((family) => ({
        ...author,
        family,
      })),
    });
    expect(render(property("aliases"), item).written).toEqual({
      aliases: [
        "Ioannidis et al. 2005",
        "Ioannidis – Why Most Published Research Findings Are False",
      ],
    });
  });
});

describe("the Extra field entry", () => {
  it("writes nothing for an Extra line with no value", () => {
    const item = sampleWith("book-section", {
      extra: {
        raw: "cover:",
        fields: { cover: "" },
        lines: [{ raw: "cover:", key: "cover", value: "" }],
      },
    });
    expect(render(property("extra-field-value"), item).written).toEqual({});
  });
});
