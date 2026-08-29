// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import TurndownService from "turndown";
import { describe, expect, it } from "vitest";

import { getPackageRoot } from "@zotlit/scripts/package-roots";

import { createNoteTurndown } from "./index";

const packageRoot = getPackageRoot(import.meta.filename);

/** Convert an HTML fragment and trim the surrounding block whitespace. */
function convert(html: string): string {
  return createNoteTurndown(TurndownService).turndown(html).trim();
}

/** Convert with the opt-in Colored Highlight Syntax enabled. */
function convertColoredHighlight(html: string): string {
  return createNoteTurndown(TurndownService, {
    useColoredHighlightSyntax: true,
  })
    .turndown(html)
    .trim();
}

/**
 * Formats documented in Obsidian's "Editing and formatting" help pages
 * (Basic / Advanced formatting syntax, Obsidian Flavored Markdown, HTML
 * content). The HTML on the left is what each format renders to; the Markdown
 * on the right is the syntax those pages prescribe.
 */
describe("Obsidian formatting syntax", () => {
  it("bold, italic, and their combination", () => {
    expect(convert("<strong>Bold text</strong>")).toBe("**Bold text**");
    expect(convert("<em>Italic text</em>")).toBe("_Italic text_");
    expect(
      convert("<strong>Bold text and <em>nested italic</em> text</strong>"),
    ).toBe("**Bold text and _nested italic_ text**");
  });

  it("strikethrough (~~) from <del> and <s>", () => {
    expect(convert("<del>Striked out text</del>")).toBe("~~Striked out text~~");
    expect(convert("Need to strike <s>some text</s>?")).toBe(
      "Need to strike ~~some text~~?",
    );
  });

  it("highlight (==) from <mark>", () => {
    expect(convert("<mark>Highlighted text</mark>")).toBe(
      "==Highlighted text==",
    );
  });

  it("ATX headings", () => {
    expect(convert("<h1>This is a heading 1</h1>")).toBe(
      "# This is a heading 1",
    );
    expect(convert("<h3>This is a heading 3</h3>")).toBe(
      "### This is a heading 3",
    );
    expect(convert("<h6>This is a heading 6</h6>")).toBe(
      "###### This is a heading 6",
    );
  });

  it("blockquote", () => {
    expect(convert("<blockquote>Quote text</blockquote>")).toBe("> Quote text");
  });

  it("unordered and ordered lists", () => {
    expect(
      convert("<ul><li>First list item</li><li>Second list item</li></ul>"),
    ).toBe("- First list item\n- Second list item");
    expect(
      convert("<ol><li>First list item</li><li>Second list item</li></ol>"),
    ).toBe("1. First list item\n2. Second list item");
  });

  it("ordered list honoring the start attribute", () => {
    expect(convert('<ol start="3"><li>Third</li><li>Fourth</li></ol>')).toBe(
      "3. Third\n4. Fourth",
    );
  });

  it("task lists (- [ ] / - [x])", () => {
    expect(
      convert(
        "<ul>" +
          '<li><input type="checkbox">This is an incomplete task.</li>' +
          '<li><input type="checkbox" checked>This is a completed task.</li>' +
          "</ul>",
      ),
    ).toBe(
      "- [ ] This is an incomplete task.\n- [x] This is a completed task.",
    );
  });

  it("inline code", () => {
    expect(convert("Text inside <code>backticks</code>")).toBe(
      "Text inside `backticks`",
    );
  });

  it("syntax-highlighted code block", () => {
    expect(
      convert(
        '<div class="highlight-source-js"><pre>function f() {}</pre></div>',
      ),
    ).toBe("```js\nfunction f() {}\n```");
  });

  it("external links", () => {
    expect(
      convert('<a href="https://help.obsidian.md">Obsidian Help</a>'),
    ).toBe("[Obsidian Help](https://help.obsidian.md)");
  });

  it("escapes spaces in link URLs", () => {
    expect(
      convert('<a href="obsidian://open?vault=V&file=My Note.md">My Note</a>'),
    ).toBe("[My Note](obsidian://open?vault=V&file=My%20Note.md)");
  });

  it("external images", () => {
    expect(
      convert('<img alt="Engelbart" src="https://example.com/Engelbart.jpg">'),
    ).toBe("![Engelbart](https://example.com/Engelbart.jpg)");
  });

  it("horizontal rule", () => {
    expect(convert("<hr>")).toBe("---");
  });

  it("table with a header row", () => {
    expect(
      convert(
        "<table>" +
          "<thead><tr><th>First name</th><th>Last name</th></tr></thead>" +
          "<tbody><tr><td>Max</td><td>Planck</td></tr></tbody>" +
          "</table>",
      ),
    ).toBe("|First name|Last name|\n|---|---|\n|Max|Planck|");
  });

  it("table with column alignment", () => {
    expect(
      convert(
        "<table><thead><tr>" +
          '<th align="left">L</th><th align="center">C</th><th align="right">R</th>' +
          "</tr></thead><tbody><tr><td>a</td><td>b</td><td>c</td></tr></tbody></table>",
      ),
    ).toBe("|L|C|R|\n|:--|:-:|--:|\n|a|b|c|");
  });

  it("underline and strikethrough HTML from the HTML content page", () => {
    expect(convert("<u>your underlined text</u>")).toBe(
      "<u>your underlined text</u>",
    );
  });
});

/**
 * Zotero note HTML quirks the base Obsidian config does not handle. Shapes are
 * taken from Zotero's note-editor serialization (math spans/pre, bare code
 * `<pre>`, styled strikethrough, sub/sup, underline, colored spans, and
 * attachment images without a `src`).
 */
describe("Zotero note formats", () => {
  it("inline math survives unescaped", () => {
    expect(
      convert('Euler: <span class="math">$e^{i\\pi}+1=0$</span> is famous.'),
    ).toBe("Euler: $e^{i\\pi}+1=0$ is famous.");
  });

  it("block math survives unescaped", () => {
    expect(convert('<pre class="math">$$\\frac{a_1}{b_2}$$</pre>')).toBe(
      "$$\\frac{a_1}{b_2}$$",
    );
  });

  it("bare <pre> becomes a fenced block with literal contents", () => {
    expect(
      convert("<pre>const x = arr[0]; // <em>not</em> a comment</pre>"),
    ).toBe("```\nconst x = arr[0]; // not a comment\n```");
  });

  it("styled-span strikethrough", () => {
    expect(
      convert('<span style="text-decoration: line-through;">gone</span>'),
    ).toBe("~~gone~~");
  });

  it("subscript and superscript kept as HTML", () => {
    expect(convert("H<sub>2</sub>O")).toBe("H<sub>2</sub>O");
    expect(convert("E=mc<sup>2</sup>")).toBe("E=mc<sup>2</sup>");
  });

  it("colored text span resolves its palette name and CSS variable", () => {
    const md = convert('<span style="color: rgb(255, 32, 32);">text</span>');
    expect(md).toBe(
      '<span class="zotlit-color" data-color="red" ' +
        'style="color: var(--zotlit-color-red, rgb(255, 32, 32));">text</span>',
    );
  });

  it("text color outside the palette keeps its inline color", () => {
    const md = convert('<span style="color: rgb(1, 2, 3);">text</span>');
    expect(md).toBe(
      '<span class="zotlit-color" style="color: rgb(1, 2, 3);">text</span>',
    );
  });

  it("highlight span becomes a colored <mark> with its palette name", () => {
    const md = convert(
      '<span style="background-color: rgba(255, 212, 0, 0.5);">Highlight</span>',
    );
    expect(md).toBe(
      '<mark class="zotlit-hl" data-color="yellow" ' +
        'style="background-color: var(--zotlit-hl-yellow, rgba(255, 212, 0, 0.5));">' +
        "Highlight</mark>",
    );
  });

  it.each([
    ["rgba(255, 102, 102, 0.5)", "🔴"],
    ["rgba(241, 152, 55, 0.5)", "🟠"],
    ["rgba(255, 212, 0, 0.5)", "🟡"],
    ["rgba(95, 178, 54, 0.5)", "🟢"],
    ["rgba(46, 168, 229, 0.5)", "🔵"],
    ["rgba(162, 138, 229, 0.5)", "🟣"],
  ])("uses emoji-based syntax for a supported %s highlight", (color, emoji) => {
    const md = convertColoredHighlight(
      `<span style="background-color: ${color};">Highlight</span>`,
    );

    expect(md).toBe(`==${emoji}Highlight==`);
  });

  it("keeps HTML for a highlight color outside the supported six", () => {
    const md = convertColoredHighlight(
      '<span style="background-color: rgba(229, 110, 238, 0.5);">Highlight</span>',
    );

    expect(md).toBe(
      '<mark class="zotlit-hl" data-color="magenta" ' +
        'style="background-color: var(--zotlit-hl-magenta, rgba(229, 110, 238, 0.5));">' +
        "Highlight</mark>",
    );
  });

  it("keeps HTML when highlight content contains the == delimiter", () => {
    const md = convertColoredHighlight(
      '<span style="background-color: rgba(255, 212, 0, 0.5);">value == target</span>',
    );

    expect(md).toContain('<mark class="zotlit-hl" data-color="yellow"');
    expect(md).not.toContain("==🟡");
  });

  it("embedded attachment image keeps its key for later import", () => {
    const md = convert('<p><img data-attachment-key="U5WTYIJK" alt=""></p>');
    expect(md).toContain('data-attachment-key="U5WTYIJK"');
    expect(md.startsWith("<img")).toBe(true);
  });

  it("citation span passes through as HTML for later resolution", () => {
    const md = convert(
      '<span class="citation" data-citation="%7B%22citationItems%22%3A%5B%5D%7D">' +
        '(<span class="citation-item">Doe, 2020, p. 1</span>)</span>',
    );
    expect(md.startsWith('<span class="citation"')).toBe(true);
    expect(md).toContain('data-citation="%7B%22citationItems%22%3A%5B%5D%7D"');
    expect(md).toContain('<span class="citation-item">Doe, 2020, p. 1</span>');
  });

  it("highlight annotation span passes through as HTML for later resolution", () => {
    const md = convert(
      '<span class="highlight" data-annotation="%7B%22annotationKey%22%3A%22C2DF35H3%22%7D">' +
        "“might aid in our understanding”</span>",
    );
    expect(md.startsWith('<span class="highlight"')).toBe(true);
    expect(md).toContain(
      'data-annotation="%7B%22annotationKey%22%3A%22C2DF35H3%22%7D"',
    );
    expect(md).toContain("“might aid in our understanding”");
  });

  it("underline annotation span passes through as HTML for later resolution", () => {
    const md = convert(
      '<span class="underline" data-annotation="%7B%22annotationKey%22%3A%227SUQ86WL%22%7D">' +
        "reference alternative as valu</span>",
    );
    expect(md.startsWith('<span class="underline"')).toBe(true);
    expect(md).toContain(
      'data-annotation="%7B%22annotationKey%22%3A%227SUQ86WL%22%7D"',
    );
  });

  it("image annotation passes through as HTML for later resolution", () => {
    const md = convert(
      '<img data-attachment-key="DUPB2GWX" ' +
        'data-annotation="%7B%22annotationKey%22%3A%22DBKE89L9%22%7D">',
    );
    expect(md.startsWith("<img")).toBe(true);
    expect(md).toContain('data-attachment-key="DUPB2GWX"');
    expect(md).toContain(
      'data-annotation="%7B%22annotationKey%22%3A%22DBKE89L9%22%7D"',
    );
  });
});

/**
 * Image embeds and annotation-excerpt spans all pass through as raw HTML, so
 * their *output* is indistinguishable. These check the routing instead — that
 * each element kind is claimed by the rule meant for it (by rule-object
 * identity): excerpt spans → `annotationExcerpt`, every `data-attachment-key`
 * image (plain or annotation) → the one `embeddedImage` rule, and never the base
 * image rule that drops a `src`-less `<img>`.
 */
describe("Zotero embed/annotation rule routing", () => {
  const td = createNoteTurndown(TurndownService);

  /** The rule turndown would pick for the first element parsed from `html`. */
  function ruleFor(html: string): object {
    const root = document.createElement("div");
    root.innerHTML = html;
    return td.rules.forNode(root.firstElementChild as HTMLElement);
  }

  const annotationRule = ruleFor(
    '<span class="highlight" data-annotation="%7B%7D">x</span>',
  );
  const citationRule = ruleFor(
    '<span class="citation" data-citation="%7B%7D">x</span>',
  );
  const embeddedImageRule = ruleFor('<img data-attachment-key="K">');
  const baseImageRule = ruleFor('<img src="x.png">');

  it("routes highlight and underline excerpt spans to one rule", () => {
    expect(
      ruleFor('<span class="underline" data-annotation="%7B%7D">x</span>'),
    ).toBe(annotationRule);
  });

  it("routes citation spans to a rule of their own", () => {
    expect(citationRule).not.toBe(annotationRule);
    expect(citationRule).not.toBe(embeddedImageRule);
  });

  it("routes plain embeds and image annotations to the one image rule", () => {
    expect(
      ruleFor('<img data-attachment-key="K" data-annotation="%7B%7D">'),
    ).toBe(embeddedImageRule);
    expect(embeddedImageRule).not.toBe(annotationRule);
  });

  it("keeps Zotero images off the base image rule that would drop them", () => {
    expect(baseImageRule).not.toBe(embeddedImageRule);
    expect(baseImageRule).not.toBe(annotationRule);
    // The base rule emits `![]()` for a src'd img and "" for a src-less one;
    // the embed must stay raw HTML instead of being dropped.
    expect(convert('<img src="x.png">')).toBe("![](x.png)");
    expect(convert('<img data-attachment-key="K">').startsWith("<img")).toBe(
      true,
    );
  });
});

describe("ZT_NOTE_EXAMPLE.html", () => {
  it("converts the full stress-test note", async () => {
    const html = readFileSync(
      join(packageRoot, "src/lib/turndown/__fixtures__/zt-note-example.html"),
      "utf8",
    );
    await expect(convert(html)).toMatchFileSnapshot(
      "./__snapshots__/zt-note-example.md",
    );
  });
});

/**
 * Zotero's "annotation excerpt" note: each `<p>` pairs a `data-annotation`
 * highlight/underline span (the `highlight` / `underline` class names match the
 * annotation types in `@zotlit/db`'s `zt-annot`) with a `data-citation` span.
 * Both pass through as raw HTML (like the embedded image) so a later stage can
 * resolve their URL-encoded payloads — the snapshot documents that boundary.
 */
describe("ZT_EXCERPT_NOTE.html", () => {
  it("converts an annotation excerpt note", async () => {
    const html = readFileSync(
      join(packageRoot, "src/lib/turndown/__fixtures__/zt-excerpt-note.html"),
      "utf8",
    );
    await expect(convert(html)).toMatchFileSnapshot(
      "./__snapshots__/zt-excerpt-note.md",
    );
  });
});
