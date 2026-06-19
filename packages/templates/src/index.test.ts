import annotation from "@defaults/annotation.eta?raw";
import content from "@defaults/content.eta?raw";
import note from "@defaults/note.eta?raw";
import { describe, expect, it } from "vitest";

import { formatBlockquote, TemplateEngine } from "./index";
import { managedRegionTransform, MARKER_END, MARKER_START } from "./obsidian";

const wrapContent = managedRegionTransform("content");

describe("TemplateEngine", () => {
  it("renders templates registered by name", () => {
    const engine = new TemplateEngine();
    engine.define("note", "# <%= zt.title %>");

    expect(engine.render("note", { title: "Paper" })).toBe("# Paper");
  });

  it("resolves includes by registered name", () => {
    const engine = new TemplateEngine();
    engine.define("annotation", annotation);
    engine.define("content", content);

    const rendered = engine.render("content", {
      annotations: [
        { pageLabel: "4", imgEmbed: "", text: "Highlighted text", comment: "" },
      ],
    });

    expect(rendered).toContain("Page 4");
    expect(rendered).toContain("Highlighted text");
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
