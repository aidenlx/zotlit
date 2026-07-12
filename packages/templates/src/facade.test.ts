import annotation from "@defaults/annotation.eta?raw";
import content from "@defaults/content.eta?raw";
import { describe, expect, it } from "vitest";

import { Temporal } from "@zotlit/shared/temporal";

import { TemplateFacade } from "./facade";
import { managedRegionTransform, MARKER_END, MARKER_START } from "./obsidian";

describe("eta suite through the facade", () => {
  it("renders templates registered by name", () => {
    const facade = new TemplateFacade();
    facade.define("note", "# <%= zt.title %>", "eta");

    expect(facade.render("note", { title: "Paper" })).toBe("# Paper");
  });

  it("resolves eta->eta includes by registered name", () => {
    const facade = new TemplateFacade();
    facade.define("annotation", annotation, "eta");
    facade.define("content", content, "eta");

    const rendered = facade.render("content", {
      notes: [],
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

  it("passes include data through directly so arrays survive", () => {
    const facade = new TemplateFacade();
    facade.define("child", "<%= Array.isArray(zt) %>:<%= zt.length %>", "eta");
    facade.define("parent", '<%~ include("child", [1, 2, 3]) %>', "eta");

    expect(facade.render("parent", {})).toBe("true:3");
  });

  it("renders null and Temporal values via the auto filter", () => {
    const facade = new TemplateFacade();
    facade.define("t", "[<%= zt.value %>]", "eta");

    expect(facade.render("t", { value: null })).toBe("[]");

    const instant = Temporal.Instant.from("2026-06-21T04:00:00Z");
    const expected = instant
      .toZonedDateTimeISO(Temporal.Now.timeZoneId())
      .toPlainDate()
      .toString();
    facade.define("d", "<%= zt.value %>", "eta");
    expect(facade.render("d", { value: instant })).toBe(expected);
  });

  it("renders objects via their toString (e.g. ItemDate)", () => {
    const facade = new TemplateFacade();
    facade.define("t", "<%= zt.value %>", "eta");
    const value = { kind: "year", toString: () => "January 2013" };

    expect(facade.render("t", { value })).toBe("January 2013");
  });

  it("renders a Temporal.PlainDate as native ISO", () => {
    const facade = new TemplateFacade();
    facade.define("d", "<%= zt.value %>", "eta");
    const value = Temporal.PlainDate.from("2013-01-15");

    expect(facade.render("d", { value })).toBe("2013-01-15");
  });

  it("replaces and removes registered eta templates", () => {
    const facade = new TemplateFacade();
    facade.define("x", "first <%= zt.value %>", "eta");
    facade.define("x", "second <%= zt.value %>", "eta");

    expect(facade.render("x", { value: "A" })).toBe("second A");

    facade.remove("x", "eta");
    expect(() => facade.render("x", { value: "A" })).toThrow(/x/);
  });

  it("recompiles registered eta templates when autoTrim changes", () => {
    const facade = new TemplateFacade();
    facade.define("x", "<%= zt.value %>\n", "eta");

    expect(facade.render("x", { value: "A" })).toBe("A\n");

    facade.setAutoTrim(["slurp", "slurp"]);

    expect(facade.render("x", { value: "A" })).toBe("A");
  });
});

describe("liquid define/render through the facade", () => {
  it("renders a liquid template with data at zt", () => {
    const facade = new TemplateFacade();
    facade.define("note", "Hello {{ zt.name }}", "liquid");

    expect(facade.render("note", { name: "World" })).toBe("Hello World");
  });
});

describe("cross-language includes", () => {
  it("includes an eta template from liquid via with...as zt", () => {
    const facade = new TemplateFacade();
    facade.define("etaLeaf", "<%= zt %> via eta", "eta");
    facade.define(
      "parent",
      '{% render "etaLeaf" with zt.who as zt %}',
      "liquid",
    );

    expect(facade.render("parent", { who: "kid" })).toBe("kid via eta");
  });

  it("includes an eta template from liquid via the named-arg zt: form", () => {
    const facade = new TemplateFacade();
    facade.define("etaLeaf", "<%= zt %> via eta", "eta");
    facade.define("parent", '{% render "etaLeaf", zt: zt.who %}', "liquid");

    expect(facade.render("parent", { who: "kid" })).toBe("kid via eta");
  });

  it("includes a liquid template from eta via include()", () => {
    const facade = new TemplateFacade();
    facade.define("liquidLeaf", "{{ zt.who }} via liquid", "liquid");
    facade.define("parent", '<%~ include("liquidLeaf", zt) %>', "eta");

    expect(facade.render("parent", { who: "kid" })).toBe("kid via liquid");
  });

  it("renders a three-deep mixed liquid -> eta -> liquid chain", () => {
    const facade = new TemplateFacade();
    facade.define("leaf", "leaf:{{ zt.v }}", "liquid");
    facade.define("middle", '<%~ include("leaf", zt) %>-mid', "eta");
    facade.define(
      "outer",
      '{% render "middle" with zt as zt %}-outer',
      "liquid",
    );

    expect(facade.render("outer", { v: "X" })).toBe("leaf:X-mid-outer");
  });
});

describe("precedence when both languages register the same name", () => {
  it("renders the liquid source when both eta and liquid are defined", () => {
    const facade = new TemplateFacade();
    facade.define("dup", "<%= zt.v %> (eta)", "eta");
    facade.define("dup", "{{ zt.v }} (liquid)", "liquid");

    expect(facade.render("dup", { v: 1 })).toBe("1 (liquid)");
  });

  it("falls back to eta after the liquid slot is removed", () => {
    const facade = new TemplateFacade();
    facade.define("dup", "<%= zt.v %> (eta)", "eta");
    facade.define("dup", "{{ zt.v }} (liquid)", "liquid");
    facade.remove("dup", "liquid");

    expect(facade.render("dup", { v: 1 })).toBe("1 (eta)");
  });

  it("leaves an eta-only template unaffected by removing its (nonexistent) liquid slot", () => {
    const facade = new TemplateFacade();
    facade.define("etaOnly", "<%= zt.v %>", "eta");
    facade.remove("etaOnly", "liquid");

    expect(facade.render("etaOnly", { v: 2 })).toBe("2");
  });

  it("leaves a liquid-only template unaffected by removing its (nonexistent) eta slot", () => {
    const facade = new TemplateFacade();
    facade.define("liquidOnly", "{{ zt.v }}", "liquid");
    facade.remove("liquidOnly", "eta");

    expect(facade.render("liquidOnly", { v: 3 })).toBe("3");
  });
});

describe("transform uniformity", () => {
  const wrapContent = managedRegionTransform("content");

  it("wraps a liquid-sourced 'content' identically direct, eta-included, and liquid-included", () => {
    const facade = new TemplateFacade({ transformRender: wrapContent });
    facade.define("content", "BODY", "liquid");
    facade.define("etaParent", '<%~ include("content", zt) %>', "eta");
    facade.define("liquidParent", '{% render "content" %}', "liquid");

    const wrapped = `${MARKER_START}\nBODY\n${MARKER_END}`;
    expect(facade.render("content", {})).toBe(wrapped);
    expect(facade.render("etaParent", {})).toBe(wrapped);
    expect(facade.render("liquidParent", {})).toBe(wrapped);
  });

  it("wraps an eta-sourced 'content' identically direct, eta-included, and liquid-included", () => {
    const facade = new TemplateFacade({ transformRender: wrapContent });
    facade.define("content", "<%= 'BODY' %>", "eta");
    facade.define("etaParent", '<%~ include("content", zt) %>', "eta");
    facade.define("liquidParent", '{% render "content" %}', "liquid");

    const wrapped = `${MARKER_START}\nBODY\n${MARKER_END}`;
    expect(facade.render("content", {})).toBe(wrapped);
    expect(facade.render("etaParent", {})).toBe(wrapped);
    expect(facade.render("liquidParent", {})).toBe(wrapped);
  });
});

describe("errors", () => {
  it("throws a name+line+col error for a liquid define-time parse error", () => {
    const facade = new TemplateFacade();

    expect(() =>
      facade.define("badLiquidParse", "{% if x %}dangling", "liquid"),
    ).toThrow(/badLiquidParse.*line:1.*col:1/s);
  });

  it("throws a name+line+col error for a liquid render-time error", () => {
    const facade = new TemplateFacade();
    facade.define("badLiquidRender", "{{ zt.item | file_link }}", "liquid");

    expect(() =>
      facade.render("badLiquidRender", {
        item: {
          fileLink: () => {
            throw new Error("boom from fileLink");
          },
        },
      }),
    ).toThrow(/boom from fileLink.*badLiquidRender.*line:1.*col:/s);
  });

  it("throws a name+line+col error for an eta define-time bad expression", () => {
    const facade = new TemplateFacade();

    expect(() =>
      facade.define("badEta", "line one\nbad: <%= 1 + + %>\n", "eta"),
    ).toThrow(/badEta.*line 2 col 10/s);
  });

  it("throws a name+line error for an eta runtime error", () => {
    const facade = new TemplateFacade();
    facade.define("badEtaRuntime", "line1\n<%= zt.foo.bar %>\nline3", "eta");

    expect(() => facade.render("badEtaRuntime", { foo: undefined })).toThrow(
      /badEtaRuntime:2/,
    );
  });

  it("throws naming the template on a direct render of an unregistered name", () => {
    const facade = new TemplateFacade();

    expect(() => facade.render("nope", {})).toThrow(/nope/);
  });

  it("throws naming the template when a liquid parent includes an unregistered name", () => {
    const facade = new TemplateFacade();
    facade.define("parent", '{% render "nope" %}', "liquid");

    expect(() => facade.render("parent", {})).toThrow(/nope/);
  });

  it("throws naming the template when an eta parent includes an unregistered name", () => {
    const facade = new TemplateFacade();
    facade.define("parent", '<%~ include("nope", zt) %>', "eta");

    expect(() => facade.render("parent", {})).toThrow(/nope/);
  });
});

describe("frontmatter fields through the facade", () => {
  it("compiles a liquid field with the shared vocabulary, including the note_links error fallback", () => {
    const facade = new TemplateFacade();
    const { compiled } = facade.compileFrontmatterFields(
      [
        {
          key: "related",
          expr: "zt.relatedItems | note_links",
          merge: "replace",
          language: "liquid",
        },
      ],
      { javascript: true },
    );

    expect(compiled).toHaveLength(1);
    expect(
      compiled[0]!.fn(
        {
          relatedItems: [
            { indexedKey: "1:AAA", noteLink: () => "[[Note A]]" },
            { indexedKey: "1:BBB", noteLink: () => null },
          ],
        },
        (p) => p,
      ),
    ).toEqual(["[[Note A]]", "zt-error:1:BBB"]);
  });

  it("filters out javascript fields into inertKeys when the gate is off", () => {
    const facade = new TemplateFacade();
    const { compiled, inertKeys } = facade.compileFrontmatterFields(
      [
        {
          key: "js",
          expr: "zt.title",
          merge: "replace",
          language: "javascript",
        },
        {
          key: "liq",
          expr: "zt.title",
          merge: "replace",
          language: "liquid",
        },
      ],
      { javascript: false },
    );

    expect(inertKeys).toEqual(["js"]);
    expect(compiled.map((f) => f.key)).toEqual(["liq"]);
  });

  it("validates a javascript expression, valid and invalid", () => {
    const facade = new TemplateFacade();
    expect(facade.validateFrontmatterExpr("zt.title", "javascript")).toBeNull();
    expect(facade.validateFrontmatterExpr("1 +", "javascript")).not.toBeNull();
  });

  it("validates a liquid expression, valid and invalid", () => {
    const facade = new TemplateFacade();
    expect(
      facade.validateFrontmatterExpr("zt.title | note_links", "liquid"),
    ).toBeNull();
    expect(facade.validateFrontmatterExpr("1 +", "liquid")).not.toBeNull();
  });
});

describe("reset", () => {
  it("clears both languages' registered templates, allowing re-definition after", () => {
    const facade = new TemplateFacade();
    facade.define("etaOne", "<%= zt.v %> (eta)", "eta");
    facade.define("liquidOne", "{{ zt.v }} (liquid)", "liquid");

    facade.reset();

    expect(() => facade.render("etaOne", { v: 1 })).toThrow(/etaOne/);
    expect(() => facade.render("liquidOne", { v: 1 })).toThrow(/liquidOne/);

    facade.define("etaOne", "<%= zt.v %> (eta again)", "eta");
    expect(facade.render("etaOne", { v: 1 })).toBe("1 (eta again)");
  });
});
