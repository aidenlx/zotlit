import annotation from "@defaults/annotation.eta?raw";
import content from "@defaults/content.eta?raw";
import note from "@defaults/note.eta?raw";
import { describe, expect, it } from "vitest";

import { Temporal } from "@zotlit/shared/temporal";

import { basename, formatBlockquote, TemplateEngine } from "./index";
import { managedRegionTransform, MARKER_END, MARKER_START } from "./obsidian";

const wrapContent = managedRegionTransform("content");

describe("TemplateEngine", () => {
  it("renders templates registered by name", () => {
    const engine = new TemplateEngine();
    engine.define("note", "# <%= zt.title %>");

    expect(engine.render("note", { title: "Paper" })).toBe("# Paper");
  });

  it("renders templates registered by name asynchronously", async () => {
    const engine = new TemplateEngine();
    engine.define("note", "# <%= zt.title %>");

    await expect(engine.renderAsync("note", { title: "Paper" })).resolves.toBe(
      "# Paper",
    );
  });

  it("resolves includes by registered name", () => {
    const engine = new TemplateEngine();
    engine.define("annotation", annotation);
    engine.define("content", content);

    const rendered = engine.render("content", {
      annotations: [
        {
          pageLabel: "4",
          imgLink: null,
          text: "Highlighted text",
          comment: "",
        },
      ],
    });

    expect(rendered).toContain("Page 4");
    expect(rendered).toContain("Highlighted text");
  });

  it("embeds the excerpt image via the embed helper when imgLink is present", () => {
    const engine = new TemplateEngine();
    engine.define("annotation", annotation);

    const rendered = engine.render("annotation", {
      pageLabel: "5",
      imgLink: () => "[[ANNOT.png]]",
      text: "with image",
      comment: "",
    });

    expect(rendered).toContain("> ![[ANNOT.png]]with image");
  });

  it("keeps multi-line annotation text and comment inside the callout", () => {
    const engine = new TemplateEngine();
    engine.define("annotation", annotation);

    const rendered = engine.render("annotation", {
      pageLabel: "5",
      imgLink: null,
      text: "first line\nsecond line",
      comment: "comment A\ncomment B",
    });

    expect(rendered).toBe(
      [
        "> [!note] Page 5",
        ">",
        "> first line",
        "> second line",
        ">",
        "> comment A",
        "> comment B",
        "",
      ].join("\n"),
    );
  });

  it("omits the comment block when the annotation has no comment", () => {
    const engine = new TemplateEngine();
    engine.define("annotation", annotation);

    const rendered = engine.render("annotation", {
      pageLabel: "5",
      imgLink: null,
      text: "only text",
      comment: "",
    });

    expect(rendered).toBe(
      ["> [!note] Page 5", ">", "> only text", ""].join("\n"),
    );
  });

  it("resolves async includes by registered name", async () => {
    const engine = new TemplateEngine();
    engine.define("child", "<%= Array.isArray(zt) %>:<%= zt.length %>");

    const parent = engine.compile(
      '<% output(await includeAsync("child", [1, 2, 3])) %>',
      { async: true },
    );

    await expect(engine.renderAsync(parent, {})).resolves.toBe("true:3");
  });

  describe("includeDataPlugin", () => {
    it("passes include data through directly so arrays survive", () => {
      // Native eta spreads the data arg into the parent object, turning an
      // array into `{0:…,1:…}`; the plugin restores direct passthrough.
      const engine = new TemplateEngine();
      engine.define("child", "<%= Array.isArray(zt) %>:<%= zt.length %>");
      engine.define("parent", '<%~ include("child", [1, 2, 3]) %>');

      expect(engine.render("parent", {})).toBe("true:3");
    });

    it("rewrites eta's generated include/includeAsync helpers (matches eta codegen)", () => {
      // Proves the replace patterns still match the installed eta version: if
      // eta's codegen drifted, replaceHelper would throw from compile() and
      // this test would error loudly rather than silently passing.
      const source = new TemplateEngine().compile("<%= zt %>").toString();

      expect(source).toContain(
        "let include = (__eta_t, __eta_d) => this.render(__eta_t, __eta_d ?? zt, options);",
      );
      expect(source).toContain(
        "let includeAsync = (__eta_t, __eta_d) => this.renderAsync(__eta_t, __eta_d ?? zt, options);",
      );
      expect(source).not.toContain("{...zt, ...(__eta_d ?? {})}");
    });
  });

  const noteContext = {
    title: "Paper",
    backlink: "zotero://select/items/1",
    attachments: [],
    annotations: [],
  };

  it("wraps content includes in managed-region markers via transformRender", () => {
    const engine = new TemplateEngine({ transformRender: wrapContent });
    engine.define("annotation", annotation);
    engine.define("content", content);
    engine.define("note", note);

    expect(engine.render("note", noteContext)).toContain(
      `${MARKER_START}\n\n${MARKER_END}`,
    );
  });

  it('wraps a direct render("content") identically to the include path', () => {
    const engine = new TemplateEngine({ transformRender: wrapContent });
    engine.define("annotation", annotation);
    engine.define("content", content);

    expect(engine.render("content", { annotations: [] })).toBe(
      `${MARKER_START}\n\n${MARKER_END}`,
    );
  });

  it("does not wrap content without a transformRender", () => {
    const engine = new TemplateEngine();
    engine.define("annotation", annotation);
    engine.define("content", content);
    engine.define("note", note);

    expect(engine.render("note", noteContext)).not.toContain(MARKER_START);
  });

  it("replaces and removes registered templates", () => {
    const engine = new TemplateEngine();
    engine.define("x", "first <%= zt.value %>");
    engine.define("x", "second <%= zt.value %>");

    expect(engine.render("x", { value: "A" })).toBe("second A");

    engine.remove("x");
    expect(() => engine.render("x", { value: "A" })).toThrow(
      "Failed to get template 'x'",
    );
  });

  it("recompiles registered templates when autoTrim changes", () => {
    const engine = new TemplateEngine();
    engine.define("x", "<%= zt.value %>\n");

    expect(engine.render("x", { value: "A" })).toBe("A\n");

    engine.setAutoTrim(["slurp", "slurp"]);

    expect(engine.render("x", { value: "A" })).toBe("A");
  });

  it("renders literal template strings without name lookup", () => {
    const engine = new TemplateEngine();

    expect(engine.renderString("<%= zt.x %>", { x: 1 })).toBe("1");
  });

  it("points a syntax error at the offending expression line and column", () => {
    const engine = new TemplateEngine();

    expect(() =>
      engine.renderString("line one\nbad: <%= 1 + + %>\n", {}),
    ).toThrow(
      [
        "Bad expression — Unexpected token ')' at line 2 col 10:",
        "",
        "  bad: <%= 1 + + %>",
        "           ^",
      ].join("\n"),
    );
  });

  it("compiles expressions referencing unbound template identifiers", () => {
    const engine = new TemplateEngine();

    expect(() => engine.renderString("<%~ zt.missing %>", {})).not.toThrow();
  });

  it("injects basename into Eta templates", () => {
    const engine = new TemplateEngine();

    expect(
      engine.renderString(
        "<%= basename(zt.path) %> / <%= basename(zt.path, '.txt') %>",
        {
          path: "folder/Smith2024.md",
        },
      ),
    ).toBe("Smith2024 / Smith2024.md");
  });

  it("injects suffix into Eta templates as a deferred marker", () => {
    const engine = new TemplateEngine();

    expect(
      engine.renderString("<%= zt.key %><%= suffix(8) %>", { key: "k" }),
    ).toBe("k%zt-suffix:8:_:%");
  });
});

describe("basename", () => {
  it("defaults to stripping a .md extension from the final path segment", () => {
    expect(basename("folder/Smith2024.md")).toBe("Smith2024");
    expect(basename("folder/Smith2024.txt")).toBe("Smith2024.txt");
    expect(basename("folder/Smith2024.md/")).toBe("Smith2024");
  });

  it("matches POSIX basename suffix behavior for exact and partial ext matches", () => {
    expect(basename("foo", "foo")).toBe("");
    expect(basename("foo/", "foo")).toBe("foo");
    expect(basename("folder/foo", "oo")).toBe("f");
    expect(basename("folder/.md", ".md")).toBe(".md");
    expect(basename(".md", ".md")).toBe("");
  });
});

describe("formatBlockquote", () => {
  it("prefixes every line of multi-line content", () => {
    expect(formatBlockquote("first\nsecond\nthird")).toBe(
      "> first\n> second\n> third",
    );
  });

  it("renders interior blank lines as a bare '>'", () => {
    expect(formatBlockquote("title\n\nbody")).toBe("> title\n>\n> body");
  });

  it("collapses consecutive blank lines into one", () => {
    expect(formatBlockquote("a\n\n\n\nb")).toBe("> a\n>\n> b");
  });

  it("trims surrounding whitespace before prefixing", () => {
    expect(formatBlockquote("\n\n  body  \n\n")).toBe("> body");
  });

  it("nests already-quoted content", () => {
    expect(formatBlockquote("> quoted\nplain")).toBe("> > quoted\n> plain");
  });

  it("returns a lone '>' for empty content", () => {
    expect(formatBlockquote("")).toBe(">");
  });
});

describe("default value filtering", () => {
  const render = (source: string, data: object): string => {
    const engine = new TemplateEngine();
    engine.define("t", source);
    return engine.render("t", data);
  };

  it("renders null and undefined as empty strings", () => {
    expect(render("[<%= zt.missing %>]", {})).toBe("[]");
    expect(render("[<%= zt.value %>]", { value: null })).toBe("[]");
  });

  it("renders a Temporal.Instant as the local date", () => {
    const instant = Temporal.Instant.from("2026-06-21T04:00:00Z");
    const expected = instant
      .toZonedDateTimeISO(Temporal.Now.timeZoneId())
      .toPlainDate()
      .toString();

    expect(render("<%= zt.value %>", { value: instant })).toBe(expected);
  });

  it("renders a Temporal.PlainDate as native ISO", () => {
    const value = Temporal.PlainDate.from("2013-01-15");
    expect(render("<%= zt.value %>", { value })).toBe("2013-01-15");
  });

  it("renders objects via their toString (e.g. ItemDate)", () => {
    const value = { kind: "year", toString: () => "January 2013" };
    expect(render("<%= zt.value %>", { value })).toBe("January 2013");
  });
});
