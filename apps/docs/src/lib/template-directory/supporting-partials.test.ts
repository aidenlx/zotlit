// Behaviour of the supporting partial entries, including the cases no Directory
// Sample shows, rendered through the same harness Profile the verification uses.

import { regex } from "arkregex";
import { describe, expect, it } from "vitest";

import builtInCitation from "@zotlit/templates/defaults/citation.liquid?raw";
import {
  renderProfile,
  SAMPLE_ANNOTATIONS,
  SAMPLE_ITEMS,
} from "@zotlit/workbench/render";
import type {
  AnnotationExample,
  RenderResources,
} from "@zotlit/workbench/render";
import type { ItemSnapshot } from "@zotlit/workbench/snapshot";

import {
  DIRECTORY_SAMPLES,
  readTemplateDirectory,
  templateDirectoryRoot,
  verifyTemplateDirectory,
} from "./index";
import { harnessProfile } from "./load.ts";

const verification = verifyTemplateDirectory(
  await readTemplateDirectory(await templateDirectoryRoot()),
);

/** Every partial entry, and a Citation Template, as the renders read them. */
function resourcesWith(citation: string): RenderResources {
  return {
    dependencies: {
      templates: [
        ...verification.entries.flatMap((entry) =>
          entry.kind === "partial"
            ? [
                {
                  name: entry.slug,
                  language: "liquid" as const,
                  source: entry.source,
                },
              ]
            : [],
        ),
        { name: "citation", language: "liquid", source: citation },
      ],
      diagnostics: [],
    },
    citationStyle: { kind: "default" },
  };
}

const resources = resourcesWith(builtInCitation);

function sample(id: string): ItemSnapshot {
  return DIRECTORY_SAMPLES.find((entry) => entry.id === id)!.snapshot;
}

/** What a `note` partial writes inside a harness Profile's Managed Block. */
function renderNotePartial(slug: string, snapshot: ItemSnapshot): string {
  const source = harnessProfile({
    body: `{% managed %}\n{% render "${slug}" with zt as zt -%}\n{% endmanaged %}\n`,
  });
  const result = renderProfile(source, snapshot, { resources });
  expect(result.diagnostics).toEqual([]);
  // The region holds the output and a blank line between its two markers.
  return result.managedRegion!.split("\n").slice(1, -2).join("\n");
}

/** The Sample Item that holds the annotations. */
const ANNOTATED_ITEM = SAMPLE_ITEMS[1]!;

/** What an `annotation` partial writes for one annotation inserted on its own. */
function renderAnnotationPartial(
  slug: string,
  annotation: AnnotationExample,
  citation = builtInCitation,
): string {
  const source = harnessProfile({
    annotation: `{% render "${slug}" with zt as zt -%}\n`,
  });
  const result = renderProfile(source, ANNOTATED_ITEM, {
    annotation,
    resources: resourcesWith(citation),
  });
  expect(result.diagnostics).toEqual([]);
  return result.annotation!;
}

/** What an `annotation` partial writes for every annotation of a literature note. */
function renderInLiteratureNote(slug: string): string {
  const source = harnessProfile({
    body: "{% managed %}\n{% for annotation in zt.annotations %}\n{% render_annotation annotation -%}\n{% endfor -%}\n{% endmanaged %}\n",
    annotation: `{% render "${slug}" with zt as zt -%}\n`,
  });
  const result = renderProfile(source, ANNOTATED_ITEM, { resources });
  expect(result.diagnostics).toEqual([]);
  return result.managedRegion!;
}

/** A Sample Annotation with some of its data changed, as an update in Zotero changes it. */
function changed(
  annotation: AnnotationExample,
  root: Record<string, unknown>,
): AnnotationExample {
  return { ...annotation, root: { ...annotation.root, ...root } };
}

/** One of the Sample Item's own annotations, inserted on its own. */
function ownAnnotation(index: number): AnnotationExample {
  return {
    id: `own:${index}`,
    revision: `own:${index}`,
    root: ANNOTATED_ITEM.roots.annotations[index]!,
    descriptors: ANNOTATED_ITEM.descriptors.annotations[index]!,
  };
}

/** An Obsidian block ID: a caret at the end of a line, or on a line of its own. */
const BLOCK_ID = regex("(?:^| )\\^(?<id>[A-Za-z0-9-]+)$", "gm");

/** The block IDs in Markdown output, in order. */
function blockIds(markdown: string): string[] {
  return [...markdown.matchAll(BLOCK_ID)].flatMap(({ groups }) =>
    groups?.id === undefined ? [] : [groups.id],
  );
}

/** A Directory Sample whose primary creators are the given people. */
function withAuthors(
  snapshot: ItemSnapshot,
  people: readonly (readonly [given: string, family: string])[],
): ItemSnapshot {
  const creators = people.map(([given, family]) => ({
    family,
    given,
    literal: null,
    role: "author",
    fullName: `${given} ${family}`,
  }));
  return {
    ...snapshot,
    roots: {
      ...snapshot.roots,
      note: { ...snapshot.roots.note, creators, authors: creators },
    },
    descriptors: {
      ...snapshot.descriptors,
      note: {
        ...snapshot.descriptors.note,
        stringCoercions: snapshot.descriptors.note.stringCoercions.filter(
          ({ path }) => path[0] !== "creators" && path[0] !== "authors",
        ),
      },
    },
  };
}

describe("the author line", () => {
  it.each([
    ["one author by family name", sample("journal-article"), "Ioannidis"],
    ["two authors joined by &", sample("conference-paper"), "Rivera & Chen"],
    [
      "an organization by its name",
      sample("document"),
      "Brackenridge Free Library",
    ],
    [
      "three authors as the first with et al.",
      withAuthors(sample("journal-article"), [
        ["Ana", "Smith"],
        ["Bo", "Lee"],
        ["Cy", "Park"],
      ]),
      "Smith et al.",
    ],
    [
      "nothing for an item without authors",
      withAuthors(sample("book"), []),
      "",
    ],
  ])("names %s", (_case, snapshot, line) => {
    expect(renderNotePartial("author-line", snapshot)).toBe(line);
  });
});

describe("the author links", () => {
  it.each([
    [
      "each author as a link to a note named after them",
      sample("book-section"),
      "[[Amos Tversky]], [[Daniel Kahneman]]",
    ],
    [
      "an organization under its name",
      sample("document"),
      "[[Brackenridge Free Library]]",
    ],
    [
      "nothing for an item without authors",
      withAuthors(sample("book"), []),
      "",
    ],
  ])("write %s", (_case, snapshot, line) => {
    expect(renderNotePartial("author-links", snapshot)).toBe(line);
  });
});

describe("the child notes", () => {
  it("list the item's Zotero notes as links under a heading", () => {
    expect(renderNotePartial("child-notes", sample("book-section"))).toBe(
      [
        "## Zotero notes",
        "",
        "- [[Summary of the three heuristics]]",
        "- [[Questions for the decision-making seminar]]",
      ].join("\n"),
    );
  });

  it("write nothing, not even the heading, for an item without notes", () => {
    expect(renderNotePartial("child-notes", sample("journal-article"))).toBe(
      "",
    );
  });
});

describe("the related items", () => {
  it("list each related item as a titled link to its literature note, with its author line and year", () => {
    expect(renderNotePartial("related-items", sample("book-section"))).toBe(
      [
        "## Related items",
        "",
        "- [[Kahneman2011|Thinking, fast and slow]] (Kahneman, 2011)",
      ].join("\n"),
    );
  });

  it("write nothing, not even the heading, for an item without related items", () => {
    expect(renderNotePartial("related-items", sample("journal-article"))).toBe(
      "",
    );
  });

  it("call the author line, so both name authors the same way", () => {
    expect(
      verification.entries.find(({ id }) => id === "partials/related-items")
        ?.calls,
    ).toEqual(["author-line"]);
  });
});

describe("the quote with a block ID", () => {
  const [highlight, , note] = SAMPLE_ANNOTATIONS;

  it("puts the annotation's key as a block ID on its own line after the quote", () => {
    expect(renderAnnotationPartial("quote-with-block-id", highlight!)).toBe(
      [
        "> Clear methods make research easier to reproduce. (p. 1)",
        "",
        "^EXAMP001",
        "",
        "Use this point in the literature review.",
        "",
      ].join("\n"),
    );
  });

  it("puts the block ID at the end of the line for an annotation without quoted text", () => {
    expect(renderAnnotationPartial("quote-with-block-id", note!)).toBe(
      "Compare these findings with the replication study. (p. 3) ^EXAMP003\n",
    );
  });

  it("keeps an annotation's block ID when its text, comment, color, and page change in Zotero", () => {
    const updated = changed(highlight!, {
      text: "Clear methods make every study easier to reproduce.",
      comment: "Cite this in the methods chapter.",
      commentHtml: "Cite this in the methods chapter.",
      colorName: "red",
      colorHex: "#ff6666",
      pageLabel: "7",
      page: 7,
    });
    expect(
      [highlight!, highlight!, updated].map((annotation) =>
        blockIds(renderAnnotationPartial("quote-with-block-id", annotation)),
      ),
    ).toEqual([["EXAMP001"], ["EXAMP001"], ["EXAMP001"]]);
  });

  it("gives an annotation the same block ID in the literature note and inserted on its own", () => {
    const inNote = blockIds(renderInLiteratureNote("quote-with-block-id"));
    const onItsOwn = [0, 1].flatMap((index) =>
      blockIds(
        renderAnnotationPartial("quote-with-block-id", ownAnnotation(index)),
      ),
    );
    expect(inNote).toEqual(["CNPAN26A", "CNPVL26A"]);
    expect(onItsOwn).toEqual(inNote);
  });

  it("gives every annotation one block ID of its own", () => {
    const ids = SAMPLE_ANNOTATIONS.map((annotation) =>
      blockIds(renderAnnotationPartial("quote-with-block-id", annotation)),
    );
    expect(ids.every((found) => found.length === 1)).toBe(true);
    expect(new Set(ids.flat()).size).toBe(SAMPLE_ANNOTATIONS.length);
  });
});

describe("the todo task", () => {
  const [highlight, underline] = SAMPLE_ANNOTATIONS;
  const withComment = (comment: string) =>
    renderAnnotationPartial(
      "todo-task",
      changed(highlight!, { comment, commentHtml: comment }),
    );

  it.each([
    ["todo Check the sample size.", "- [ ] Check the sample size."],
    ["TODO: Check the sample size.", "- [ ] Check the sample size."],
    ["Todo:Check the sample size.", "- [ ] Check the sample size."],
  ])("turns the comment %j into a task", (comment, task) => {
    expect(withComment(comment)).toBe(task);
  });

  it.each([
    "Use this point in the literature review.",
    "Todorov reads this result differently.",
    "todo",
    "Check this before the todo list.",
  ])("keeps the comment %j as it is", (comment) => {
    expect(withComment(comment)).toBe(comment);
  });

  it("writes nothing for an annotation without a comment", () => {
    expect(renderAnnotationPartial("todo-task", underline!)).toBe("");
  });
});

describe("the quote with citation", () => {
  const [highlight] = SAMPLE_ANNOTATIONS;
  const quote = "> Clear methods make research easier to reproduce.";

  it("ends the quote with the built-in citation text, page included", () => {
    expect(renderAnnotationPartial("quote-with-citation", highlight!)).toBe(
      `${quote} [@riveraResearchInterfaces2026, {p. 1}]\n\nUse this point in the literature review.\n`,
    );
  });

  it("follows the reader's own citation text for an annotation inserted on its own", () => {
    const ownCitation =
      "({{ zt.citations[0].item.citationKey }} at {{ zt.citations[0].locator }})";
    expect(
      renderAnnotationPartial("quote-with-citation", highlight!, ownCitation),
    ).toContain(`${quote} (riveraResearchInterfaces2026 at 1)`);
  });

  it("writes the built-in citation form in the literature note, which carries no citation text", () => {
    const inNote = renderInLiteratureNote("quote-with-citation");
    expect(inNote.match(/^> .*$/gm)).toEqual([
      "> A reproducible interface makes its inputs and outputs inspectable. [@riveraResearchInterfaces2026, {p. 1}]",
      "> A reproducible interface makes its inputs and outputs inspectable. [@riveraResearchInterfaces2026, {p. 1}]",
    ]);
  });

  it("ends the quote with its page when the item has no citation key", () => {
    const parentItem = highlight!.root.parentItem as Record<string, unknown>;
    const uncited = changed(highlight!, {
      parentItem: { ...parentItem, citekey: null, citationKey: null },
    });
    expect(renderAnnotationPartial("quote-with-citation", uncited)).toBe(
      `${quote} (p. 1)\n\nUse this point in the literature review.\n`,
    );
  });
});
