import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROFILE_SOURCE,
  SAMPLE_ITEMS,
  renderProfile,
} from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

import { ResultSheet, parseNote } from "./reading-view";

// The rendering map is the only module that imports the parser packages' node
// types, so the tree shape reaches this test through `parseNote` alone.
type NoteTree = ReturnType<typeof parseNote>;
type NoteNode = NoteTree | NoteTree["children"][number];
type NoteElement = Extract<NoteNode, { type: "element" }>;

/** The unavailable text each embed kind shows, one per placeholder in the spec. */
const UNAVAILABLE_LABEL: Record<string, string> = {
  audio: m.workbench_embed_file_unavailable(),
  image: m.workbench_embed_image_unavailable(),
  note: m.workbench_embed_note_unavailable(),
  pdf: m.workbench_embed_file_unavailable(),
  video: m.workbench_embed_file_unavailable(),
};

/** Every Obsidian mark the reading view has an opinion about, in one note. */
const OBSIDIAN_CORPUS = `# Findings

Read [[Ioannidis 2005|the paper]] and [[Reading list#Queue]], filed under #method/replication.

[Zotero](zotero://select/library/items/IANNP5A2) and <https://example.com/paper>.

![[figure-1.png]]

![[Bicycle sharing notes]]

![[appendix.pdf]]

![alt text](https://example.com/figure.png)

%%zt-managed%%

> [!note]- Page 1
> A reproducible interface makes its inputs inspectable.
>
> > [!tip]+ Nested
> > Keep the manifest small.

- [ ] Re-run the analysis
- [x] Export the annotations
`;

function elements(tree: NoteNode): NoteElement[] {
  const found: NoteElement[] = [];
  const walk = (node: NoteNode) => {
    if (node.type === "element") found.push(node);
    if ("children" in node) node.children.forEach(walk);
  };
  walk(tree);
  return found;
}

/** Source offsets say nothing about the rendering and drown the snapshot. */
function withoutPositions(tree: NoteNode): unknown {
  return JSON.parse(
    JSON.stringify(tree, (key, value) =>
      key === "position" ? undefined : value,
    ),
  );
}

function textOf(markup: string): string {
  return markup
    .replaceAll(/<[^>]*>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");
}

describe("parseNote over the default Profile", () => {
  for (const snapshot of SAMPLE_ITEMS) {
    it(`renders the note for ${snapshot.item.itemType}`, () => {
      const result = renderProfile(DEFAULT_PROFILE_SOURCE, snapshot);

      expect(result.diagnostics).toEqual([]);
      expect(
        withoutPositions(parseNote(result.creationBody!)),
      ).toMatchSnapshot();
    });
  }

  it("leaves no navigable target anywhere in the corpus", () => {
    for (const snapshot of SAMPLE_ITEMS) {
      const { creationBody } = renderProfile(DEFAULT_PROFILE_SOURCE, snapshot);

      for (const node of elements(parseNote(creationBody!))) {
        expect(node.tagName).not.toBe("a");
        expect(node.properties).not.toHaveProperty("href");
        expect(node.properties).not.toHaveProperty("src");
      }
    }
  });

  it("marks each link, tag, and embed the default templates emit", () => {
    for (const snapshot of SAMPLE_ITEMS) {
      const { creationBody, properties } = renderProfile(
        DEFAULT_PROFILE_SOURCE,
        snapshot,
      );
      const marks = elements(parseNote(creationBody!)).filter(
        (node) => node.properties["data-zt"],
      );
      const text = textOf(
        renderToStaticMarkup(
          <ResultSheet
            markdown={creationBody!}
            properties={properties}
            showMarkdown={false}
          />,
        ),
      );

      expect(marks.length).toBeGreaterThan(0);
      for (const mark of marks) {
        expect(mark.properties["data-target"]).toEqual(expect.any(String));
        expect(mark.properties).not.toHaveProperty("href");
        expect(mark.properties).not.toHaveProperty("src");

        if (mark.properties["data-zt"] !== "embed") continue;
        expect(text).toContain(
          UNAVAILABLE_LABEL[String(mark.properties["data-embed"])],
        );
        expect(text).toContain(String(mark.properties["data-target"]));
      }
    }
  });

  it("hides the managed-region comment markers the way Obsidian does", () => {
    const { creationBody } = renderProfile(
      DEFAULT_PROFILE_SOURCE,
      SAMPLE_ITEMS[1]!,
    );

    expect(creationBody).toContain("%%zt-managed%%");
    expect(JSON.stringify(parseNote(creationBody!))).not.toContain(
      "zt-managed",
    );
  });
});

describe("inert marks", () => {
  const tree = parseNote(OBSIDIAN_CORPUS);
  const marks = elements(tree).filter((node) => node.properties["data-zt"]);
  const targets = (kind: string) =>
    marks
      .filter((node) => node.properties["data-zt"] === kind)
      .map((node) => node.properties["data-target"]);

  it("produces the tree a package swap has to keep producing", () => {
    expect(withoutPositions(tree)).toMatchSnapshot();
  });

  it("carries no anchor, href, or src", () => {
    for (const node of elements(tree)) {
      expect(node.tagName).not.toBe("a");
      expect(node.properties).not.toHaveProperty("href");
      expect(node.properties).not.toHaveProperty("src");
    }
  });

  it("marks each wikilink inert and keeps its alias as the text", () => {
    expect(targets("wikilink")).toEqual([
      "Ioannidis 2005",
      "Reading list#Queue",
    ]);
    expect(
      marks.find((node) => node.properties["data-zt"] === "wikilink")?.children,
    ).toEqual([{ type: "text", value: "the paper" }]);
  });

  it("marks each tag inert with its hash intact", () => {
    expect(targets("tag")).toEqual(["method/replication"]);
    expect(
      marks.find((node) => node.properties["data-zt"] === "tag")?.children,
    ).toEqual([{ type: "text", value: "#method/replication" }]);
  });

  it("marks a Markdown link inert while keeping its text", () => {
    expect(targets("link")).toEqual([
      "zotero://select/library/items/IANNP5A2",
      "https://example.com/paper",
    ]);
  });

  it("dispatches each embed to an unavailable placeholder by file type", () => {
    expect(
      marks
        .filter((node) => node.properties["data-zt"] === "embed")
        .map((node) => [
          node.properties["data-target"],
          node.properties["data-embed"],
        ]),
    ).toEqual([
      ["figure-1.png", "image"],
      ["Bicycle sharing notes", "note"],
      ["appendix.pdf", "pdf"],
      ["https://example.com/figure.png", "image"],
    ]);
  });

  it("names the unavailable kind in the rendered placeholder", () => {
    const markup = renderToStaticMarkup(
      <ResultSheet
        markdown={OBSIDIAN_CORPUS}
        properties={[]}
        showMarkdown={false}
      />,
    );

    expect(textOf(markup)).toContain("Image unavailable");
    expect(textOf(markup)).toContain("Embedded note unavailable");
    expect(textOf(markup)).toContain("Embedded file unavailable");
    expect(markup).not.toContain("<a ");
    expect(markup).not.toContain("href=");
  });
});

describe("callouts", () => {
  const callouts = elements(parseNote(OBSIDIAN_CORPUS)).filter(
    (node) => node.properties["data-callout"],
  );

  it("folds a `-` callout shut and a `+` callout open", () => {
    expect(
      callouts.map((node) => [
        node.tagName,
        node.properties["data-callout"],
        node.properties["data-collapsible"],
        node.properties.open ?? false,
      ]),
    ).toEqual([
      ["details", "note", "true", false],
      ["details", "tip", "true", "open"],
    ]);
  });

  it("nests the inner callout inside the outer callout's content", () => {
    const inner = elements(callouts[0]!).filter(
      (node) => node.properties["data-callout"] === "tip",
    );

    expect(inner).toHaveLength(1);
  });

  it("gives a folded callout a summary carrying its title", () => {
    const summary = elements(callouts[0]!).find(
      (node) => node.tagName === "summary",
    );

    expect(JSON.stringify(summary)).toContain("Page 1");
  });
});

describe("the Properties list", () => {
  it("separates a property never set from one that evaluated to null", () => {
    const markup = renderToStaticMarkup(
      <ResultSheet
        markdown=""
        properties={[
          { key: "doi", missing: true },
          { key: "abstract", value: null, missing: false },
          { key: "citekey", value: "ioannidisWhyMost2005", missing: false },
        ]}
        showMarkdown={false}
      />,
    );

    expect(textOf(markup)).toBe(
      `doi${m.workbench_property_unset()}abstract${m.workbench_property_empty()}citekeyioannidisWhyMost2005`,
    );
  });
});

describe("the Markdown toggle", () => {
  const { creationBody, properties } = renderProfile(
    DEFAULT_PROFILE_SOURCE,
    SAMPLE_ITEMS[1]!,
  );

  it("shows the generated Markdown byte for byte", () => {
    const markup = renderToStaticMarkup(
      <ResultSheet
        markdown={creationBody!}
        properties={properties}
        showMarkdown
      />,
    );

    expect(textOf(markup)).toBe(creationBody);
  });

  it("shows the reading view instead when the toggle is off", () => {
    const markup = renderToStaticMarkup(
      <ResultSheet
        markdown={creationBody!}
        properties={properties}
        showMarkdown={false}
      />,
    );

    expect(textOf(markup)).not.toContain("%%zt-managed%%");
    expect(markup).toContain("<h1");
    expect(textOf(markup)).toContain("citekey");
  });
});
