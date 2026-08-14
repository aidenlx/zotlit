// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Attr, Inline, Inlines } from "./ast";

const logRecords: { level: string; message: string; fields: unknown }[] = [];
vi.mock("@/lib/log", () => ({
  getLogger: () => ({
    debug: (message: string, fields: unknown) =>
      logRecords.push({ level: "debug", message, fields }),
    info: (message: string, fields: unknown) =>
      logRecords.push({ level: "info", message, fields }),
    warn: (message: string, fields: unknown) =>
      logRecords.push({ level: "warn", message, fields }),
    error: (message: string, fields: unknown) =>
      logRecords.push({ level: "error", message, fields }),
  }),
}));

import type { InlineContentProps } from "./inline-content";
import { InlineContent, renderInlineContent } from "./inline-content";

const NO_ATTR: Attr = ["", [], []];

function str(text: string): Inline {
  return { t: "Str", c: text };
}

function span(classes: readonly string[], content: Inlines): Inline {
  return { t: "Span", c: [["", classes, []], content] };
}

/** Renders through a React tree the surface owns, as the sidebar does. */
function attached(props: InlineContentProps): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  // Awaiting would hide the point: the component renders synchronously.
  void act(() => {
    createRoot(container).render(createElement(InlineContent, props));
  });
  return container;
}

/** Renders through the adapter, as the raw-DOM surfaces do. */
function detached(props: InlineContentProps): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  renderInlineContent(container, props);
  return container;
}

beforeEach(() => {
  logRecords.length = 0;
  document.body.replaceChildren();
});

describe("InlineContent element vocabulary", () => {
  it.each([
    ["Emph", "em"],
    ["Strong", "strong"],
    ["Underline", "u"],
    ["Strikeout", "del"],
    ["Superscript", "sup"],
    ["Subscript", "sub"],
  ] as const)("renders %s as <%s>", (constructor, tag) => {
    const container = attached({
      nodes: [{ t: constructor, c: [str("title")] }],
    });

    expect(container.innerHTML).toBe(`<${tag}>title</${tag}>`);
  });

  it("renders small caps as a span that asks for them", () => {
    const container = attached({
      nodes: [{ t: "SmallCaps", c: [str("ii")] }],
    });

    const rendered = container.querySelector("span")!;
    expect(rendered.textContent).toBe("ii");
    expect(rendered.classList).toContain("zt:[font-variant:small-caps]");
  });

  it("renders a quotation as its quote characters, in no element", () => {
    const container = attached({
      nodes: [
        { t: "Quoted", c: [{ t: "DoubleQuote" }, [str("Outer")]] },
        { t: "Space" },
        { t: "Quoted", c: [{ t: "SingleQuote" }, [str("inner")]] },
      ],
    });

    expect(container.textContent).toBe("“Outer” ‘inner’");
    expect(container.children).toHaveLength(0);
  });

  it("renders the separators of a flow", () => {
    const container = attached({
      nodes: [
        str("one"),
        { t: "Space" },
        str("two"),
        { t: "SoftBreak" },
        str("three"),
        { t: "LineBreak" },
        str("four"),
      ],
    });

    expect(container.innerHTML).toBe("one two three<br>four");
  });

  it("keeps AST attributes off the DOM", () => {
    const attr: Attr = ["ref-zeta", ["nocase"], [["data-x", "y"]]];
    const container = attached({
      nodes: [
        { t: "Span", c: [attr, [str("Zeta")]] },
        { t: "Code", c: [attr, "code"] },
        { t: "Link", c: [attr, [str("link")], ["https://example.com", ""]] },
      ],
    });

    expect(container.querySelector("[id]")).toBeNull();
    expect(container.querySelector("[data-x]")).toBeNull();
    expect(container.querySelector(".nocase")).toBeNull();
    expect(container.querySelector("code")!.className).toBe("");
  });

  it("renders a citation's own content transparently", () => {
    const container = attached({
      nodes: [
        {
          t: "Cite",
          c: [
            [
              {
                citationId: "zeta20",
                citationPrefix: [],
                citationSuffix: [],
                citationMode: { t: "NormalCitation" },
                citationNoteNum: 1,
                citationHash: 0,
              },
            ],
            [str("(Zeta"), { t: "Space" }, str("2020)")],
          ],
        },
      ],
    });

    expect(container.innerHTML).toBe("(Zeta 2020)");
  });
});

describe("InlineContent degradation", () => {
  it("shows the source of a formula as text", () => {
    const container = attached({
      nodes: [{ t: "Math", c: [{ t: "InlineMath" }, "e^{i\\pi}"] }],
    });

    expect(container.innerHTML).toBe("e^{i\\pi}");
  });

  it("shows code as code", () => {
    const container = attached({
      nodes: [{ t: "Code", c: [NO_ATTR, "grep"] }],
    });

    expect(container.innerHTML).toBe("<code>grep</code>");
  });

  it("shows an image as its alternative text", () => {
    const container = attached({
      nodes: [
        {
          t: "Image",
          c: [
            NO_ATTR,
            [str("Cover"), { t: "Space" }, str("art")],
            ["c.png", "Cover"],
          ],
        },
      ],
    });

    expect(container.innerHTML).toBe("Cover art");
  });

  it("drops raw markup and records what it dropped", () => {
    const container = attached({
      nodes: [
        str("before"),
        { t: "RawInline", c: ["html", "<script>x</script>"] },
      ],
    });

    expect(container.innerHTML).toBe("before");
    expect(logRecords).toEqual([
      {
        level: "debug",
        message: "Dropped an inline the renderer cannot show",
        fields: { inline: "RawInline", format: "html" },
      },
    ]);
  });
});

describe("InlineContent span dispatch", () => {
  it("joins the parts of a laid-out entry with one space apiece", () => {
    const container = attached({
      nodes: [
        span(["csl-left-margin"], [str("1.")]),
        span(["csl-right-inline"], [str("Zeta,"), { t: "Space" }, str("Ann.")]),
        span(["csl-block"], [str("A"), { t: "Space" }, str("study.")]),
        span(["csl-indent"], [str("Nowhere:"), { t: "Space" }, str("Press.")]),
      ],
    });

    expect(container.textContent).toBe(
      "1. Zeta, Ann. A study. Nowhere: Press.",
    );
    expect(container.children).toHaveLength(0);
  });

  it("leaves one space at a boundary the flow already spaces", () => {
    const container = attached({
      nodes: [
        str("Ann."),
        { t: "Space" },
        span(["csl-block"], [str("A"), { t: "Space" }, str("study.")]),
        { t: "Space" },
        str("Press."),
      ],
    });

    expect(container.textContent).toBe("Ann. A study. Press.");
  });

  it("renders a semantic span's children and nothing of its own", () => {
    for (const classes of [
      ["nocase"],
      ["nodecoration"],
      [],
      ["csl-something-new"],
    ]) {
      const container = attached({
        nodes: [span(classes, [str("Zeta"), { t: "Space" }, str("2020")])],
      });

      expect(container.innerHTML).toBe("Zeta 2020");
    }
  });
});

describe("InlineContent links", () => {
  it.each(["https://example.com/a", "http://example.com/a", "mailto:a@b.com"])(
    "renders %s as a bare anchor",
    (url) => {
      const container = attached({
        nodes: [{ t: "Link", c: [NO_ATTR, [str("source")], [url, "Open it"]] }],
      });

      const anchor = container.querySelector("a")!;
      expect(anchor.getAttribute("href")).toBe(url);
      expect(anchor.getAttribute("aria-label")).toBe("Open it");
      expect(anchor.className).toBe("");
      expect(anchor.getAttribute("target")).toBeNull();
      expect(anchor.textContent).toBe("source");
    },
  );

  it("leaves a link with no title unlabelled", () => {
    const container = attached({
      nodes: [
        {
          t: "Link",
          c: [NO_ATTR, [str("source")], ["https://example.com", ""]],
        },
      ],
    });

    expect(container.innerHTML).toBe(
      '<a href="https://example.com">source</a>',
    );
  });

  it.each([
    "#ref-zeta",
    "/vault/note.md",
    "javascript:alert(1)",
    "obsidian://open",
  ])("renders the content alone for the target %s", (url) => {
    const container = attached({
      nodes: [{ t: "Link", c: [NO_ATTR, [str("source")], [url, "Open it"]] }],
    });

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("source");
  });

  it("renders the content as plain text where a surface suppresses links", () => {
    const container = attached({
      links: "suppress",
      nodes: [
        {
          t: "Link",
          c: [
            NO_ATTR,
            [{ t: "Emph", c: [str("A study")] }, { t: "Space" }, str("(2020)")],
            ["https://example.com", "Open it"],
          ],
        },
      ],
    });

    expect(container.innerHTML).toBe("A study (2020)");
  });
});

describe("InlineContent entry serials", () => {
  const noted: Inlines = [
    str("Zeta"),
    { t: "Space" },
    str("(2020)"),
    {
      t: "Note",
      c: [{ t: "Para", c: [str("Ann Zeta, A study of nothing.")] }],
    },
  ];

  it("shows one serial per cited work, as plain comma-separated digits", () => {
    const container = attached({ nodes: noted, serials: [1, 2] });

    const serial = container.querySelector("sup")!;
    expect(serial.textContent).toBe("1,2");
    expect(container.textContent).toBe("Zeta (2020)1,2");
  });

  it("marks the slot of a work the bibliography rendered no entry for", () => {
    const container = attached({ nodes: noted, serials: [undefined, 2] });

    expect(container.querySelector("sup")!.textContent).toBe("⚠,2");
  });

  it("drops a note that stands for no serial, and records it", () => {
    const container = attached({ nodes: noted });

    expect(container.querySelector("sup")).toBeNull();
    expect(container.textContent).toBe("Zeta (2020)");
    expect(logRecords).toEqual([
      {
        level: "debug",
        message: "Dropped a note with no serial to stand for it",
        fields: { inline: "Note" },
      },
    ]);
  });

  it("keeps the note's own text out of the flow", () => {
    const container = attached({ nodes: noted, serials: [1] });

    expect(container.textContent).not.toContain("A study of nothing");
  });
});

// The class is a public promise to themes: an Entry Serial carries it wherever
// a note-class style puts one inline.
describe("zt-entry-serial theme hook", () => {
  it("marks every Entry Serial run, and nothing else", () => {
    const container = attached({
      nodes: [
        { t: "Superscript", c: [str("st")] },
        { t: "Note", c: [{ t: "Para", c: [str("Ann Zeta.")] }] },
      ],
      serials: [3],
    });

    const marked = [...container.querySelectorAll(".zt-entry-serial")];
    expect(marked.map((el) => el.textContent)).toEqual(["3"]);
    expect(marked[0]!.tagName).toBe("SUP");
  });
});

describe("renderInlineContent", () => {
  const nodes: Inlines = [
    span(["csl-left-margin"], [str("1.")]),
    span(
      ["csl-right-inline"],
      [
        { t: "Emph", c: [str("A study")] },
        { t: "Space" },
        { t: "Link", c: [NO_ATTR, [str("doi")], ["https://doi.org/10", ""]] },
      ],
    ),
  ];

  it("populates the container before it returns", () => {
    const container = document.createElement("div");

    renderInlineContent(container, { nodes });

    expect(container.textContent).toBe("1. A study doi");
  });

  it("renders what the component renders inside a tree", () => {
    expect(detached({ nodes }).innerHTML).toBe(attached({ nodes }).innerHTML);
  });

  it("passes a flow that has nothing to show", () => {
    const container = detached({
      nodes: [{ t: "RawInline", c: ["html", "<b>"] }],
    });

    expect(container.hasChildNodes()).toBe(false);
    expect(logRecords.map((record) => record.level)).toEqual(["debug"]);
  });

  it("reports a render that left the container empty", async () => {
    vi.resetModules();
    vi.doMock("react-dom/client", () => ({
      createRoot: () => ({ render: () => {}, unmount: () => {} }),
    }));
    try {
      const deferred = await import("./inline-content");
      const container = document.createElement("div");

      deferred.renderInlineContent(container, { nodes });

      expect(logRecords).toEqual([
        {
          level: "error",
          message: "Detached render left the container empty",
          fields: { inlines: nodes.length },
        },
      ]);
    } finally {
      vi.doUnmock("react-dom/client");
      vi.resetModules();
    }
  });
});
