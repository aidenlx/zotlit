import { describe, expect, it } from "vitest";

import { Temporal } from "@zotlit/shared/temporal";

import { formatBlockquote } from "./blockquote";
import {
  filenameSuffix,
  hasSuffixMarker,
  replaceSuffixMarkers,
} from "./filename-suffix";
import { createLiquidEngine } from "./liquid";

describe("whitespace", () => {
  it("preserves all whitespace around an unmarked tag", () => {
    const engine = createLiquidEngine();
    expect(
      engine.parseAndRenderSync("a\n{% if true %}\nb\n{% endif %}\nc", {}),
    ).toBe("a\n\nb\n\nc");
  });

  it("trims exactly one trailing newline, leaving a blank line intact", () => {
    const engine = createLiquidEngine();
    expect(
      engine.parseAndRenderSync("x{% if true -%}\n\ny{% endif %}", {}),
    ).toBe("x\ny");
  });

  it("trims only same-line indentation before a leading marker", () => {
    const engine = createLiquidEngine();
    expect(
      engine.parseAndRenderSync("a\n  {%- if true %}b{% endif %}", {}),
    ).toBe("a\nb");
  });

  it("never lets a leading marker consume a bare newline", () => {
    const engine = createLiquidEngine();
    expect(
      engine.parseAndRenderSync("a\n\n{%- if true %}b{% endif %}", {}),
    ).toBe("a\n\nb");
  });
});

describe("control flow", () => {
  it("renders a {% for %} loop over an array", () => {
    const engine = createLiquidEngine();
    expect(
      engine.parseAndRenderSync(
        "{% for n in zt.notes %}- {{ n }}\n{% endfor %}",
        {
          zt: { notes: ["a", "b"] },
        },
      ),
    ).toBe("- a\n- b\n");
  });
});

describe("{% liquid %} statement block", () => {
  it("emits only the echoed value, dropping internal indentation", () => {
    const engine = createLiquidEngine();
    expect(
      engine.parseAndRenderSync(
        "x\n{% liquid\n  assign y = 2\n  echo y\n%}\nz",
        {},
      ),
    ).toBe("x\n2\nz");
  });

  it("respects a trailing -%} on the block itself", () => {
    const engine = createLiquidEngine();
    expect(
      engine.parseAndRenderSync(
        "x\n{% liquid\n  assign y = 2\n  echo y\n-%}\nz",
        {},
      ),
    ).toBe("x\n2z");
  });
});

describe("bq tag", () => {
  it("is byte-identical to formatBlockquote for the same content", () => {
    const engine = createLiquidEngine();
    const inner =
      "[!note] Page 57\n\nSecond highlight\n\n\n\nMy thoughts on this";
    const template = `{% bq %}${inner}{% endbq %}`;

    expect(engine.parseAndRenderSync(template, {})).toBe(
      formatBlockquote(inner),
    );
  });

  it("renders the classic callout shape", () => {
    const engine = createLiquidEngine();
    const template = `{% bq %}
[!note] Page {{ zt.pageLabel }}

{{ zt.text }}

{{ zt.comment }}
{% endbq %}`;

    expect(
      engine.parseAndRenderSync(template, {
        zt: {
          pageLabel: "57",
          text: "Second highlight",
          comment: "My thoughts on this",
        },
      }),
    ).toBe(
      [
        "> [!note] Page 57",
        ">",
        "> Second highlight",
        ">",
        "> My thoughts on this",
      ].join("\n"),
    );
  });
});

describe("embed filter", () => {
  it("prefixes ! for a present link", () => {
    const engine = createLiquidEngine();
    expect(
      engine.parseAndRenderSync("{{ zt.imgLink | embed }}", {
        zt: { imgLink: () => "[[img.png]]" },
      }),
    ).toBe("![[img.png]]");
  });

  it("collapses to empty for an absent link, no {% if %} guard", () => {
    const engine = createLiquidEngine();
    expect(
      engine.parseAndRenderSync("{{ zt.imgLink | embed }}", {
        zt: { imgLink: null },
      }),
    ).toBe("");
  });
});

describe("link filters", () => {
  it("renders zero-arg use via plain property access", () => {
    const engine = createLiquidEngine();
    expect(
      engine.parseAndRenderSync("{{ a.fileLink }}", {
        a: {
          fileLink: (alias?: string) =>
            `[${alias ?? "paper.pdf"}](file:///paper.pdf)`,
        },
      }),
    ).toBe("[paper.pdf](file:///paper.pdf)");
  });

  it("overrides the alias via the file_link filter", () => {
    const engine = createLiquidEngine();
    let received: [string | undefined, string | undefined] = [
      undefined,
      undefined,
    ];
    expect(
      engine.parseAndRenderSync('{{ a | file_link: "Open the PDF" }}', {
        a: {
          fileLink: (alias?: string, subpath?: string) => {
            received = [alias, subpath];
            return `[${alias}](file:///paper.pdf)`;
          },
        },
      }),
    ).toBe("[Open the PDF](file:///paper.pdf)");
    expect(received).toEqual(["Open the PDF", undefined]);
  });

  it("overrides alias and subpath via the file_link filter", () => {
    const engine = createLiquidEngine();
    expect(
      engine.parseAndRenderSync('{{ a | file_link: "Open", "#page=3" }}', {
        a: {
          fileLink: (alias?: string, subpath?: string) =>
            `[${alias}](file:///paper.pdf${subpath ?? ""})`,
        },
      }),
    ).toBe("[Open](file:///paper.pdf#page=3)");
  });

  it("supports note_link with an alias override", () => {
    const engine = createLiquidEngine();
    expect(
      engine.parseAndRenderSync('{{ a | note_link: "Open the note" }}', {
        a: { noteLink: (alias?: string) => `[[note|${alias}]]` },
      }),
    ).toBe("[[note|Open the note]]");
  });

  it("supports img_link with an alias override", () => {
    const engine = createLiquidEngine();
    expect(
      engine.parseAndRenderSync('{{ a | img_link: "alt text" }}', {
        a: { imgLink: (alias?: string) => `![[img.png|${alias}]]` },
      }),
    ).toBe("![[img.png|alt text]]");
  });

  it("returns empty for an unresolvable helper", () => {
    const engine = createLiquidEngine();
    expect(
      engine.parseAndRenderSync("{{ a | file_link }}", {
        a: { fileLink: () => null },
      }),
    ).toBe("");
  });

  it("returns empty for an object without the helper", () => {
    const engine = createLiquidEngine();
    expect(engine.parseAndRenderSync("{{ a | file_link }}", { a: {} })).toBe(
      "",
    );
  });

  it("composes with embed", () => {
    const engine = createLiquidEngine();
    expect(
      engine.parseAndRenderSync('{{ a | img_link: "alt" | embed }}', {
        a: { imgLink: (alias?: string) => `[[img.png|${alias}]]` },
      }),
    ).toBe("![[img.png|alt]]");
  });

  it("drops null links and joins the rest in a map/compact/join pipeline", () => {
    const engine = createLiquidEngine();
    expect(
      engine.parseAndRenderSync(
        '{{ zt.attachments | map: "fileLink" | compact | join: " " }}',
        {
          zt: {
            attachments: [
              { fileLink: () => "[paper.pdf](file:///paper.pdf)" },
              { fileLink: () => null },
            ],
          },
        },
      ),
    ).toBe("[paper.pdf](file:///paper.pdf)");
  });
});

describe("note_links filter", () => {
  it("maps resolved links straight through", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync("zt.items | note_links", {
        zt: {
          items: [
            { indexedKey: "1:AAA", noteLink: () => "[[Note A]]" },
            { indexedKey: "1:BBB", noteLink: () => "[[Note B]]" },
          ],
        },
      }),
    ).toEqual(["[[Note A]]", "[[Note B]]"]);
  });

  it("falls back to zt-error:<indexedKey> when noteLink() returns null", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync("zt.items | note_links", {
        zt: { items: [{ indexedKey: "1:BBB", noteLink: () => null }] },
      }),
    ).toEqual(["zt-error:1:BBB"]);
  });

  it("falls back to zt-error:<indexedKey> when noteLink is missing", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync("zt.items | note_links", {
        zt: { items: [{ indexedKey: "1:CCC" }] },
      }),
    ).toEqual(["zt-error:1:CCC"]);
  });

  it("returns an empty array for non-array input", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync("zt.items | note_links", { zt: { items: null } }),
    ).toEqual([]);
  });
});

describe("collection_paths filter", () => {
  it("joins each collection's path with '/' by default", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync("zt.collections | collection_paths", {
        zt: {
          collections: [{ path: ["Top", "Sub"] }, { path: ["Other"] }],
        },
      }),
    ).toEqual(["Top/Sub", "Other"]);
  });

  it("joins with a custom separator argument", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync('zt.collections | collection_paths: " > "', {
        zt: { collections: [{ path: ["Top", "Sub"] }] },
      }),
    ).toEqual(["Top > Sub"]);
  });

  it("returns an empty array for non-array input", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync("zt.collections | collection_paths", {
        zt: { collections: null },
      }),
    ).toEqual([]);
  });
});

describe("arr_prefix filter", () => {
  it("prepends a string to every element", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync('zt.items | arr_prefix: "#"', {
        zt: { items: ["foo", "bar"] },
      }),
    ).toEqual(["#foo", "#bar"]);
  });

  it("returns an empty array for empty input", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync('zt.items | arr_prefix: "#"', {
        zt: { items: [] },
      }),
    ).toEqual([]);
  });

  it("throws for non-array input", () => {
    const engine = createLiquidEngine();
    expect(() =>
      engine.evalValueSync('zt.items | arr_prefix: "#"', {
        zt: { items: null },
      }),
    ).toThrow("arr_prefix requires an array");
  });

  it("uses empty string when prefix argument is omitted", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync("zt.items | arr_prefix", {
        zt: { items: ["a", "b"] },
      }),
    ).toEqual(["a", "b"]);
  });
});

describe("arr_suffix filter", () => {
  it("appends a string to every element", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync('zt.items | arr_suffix: "!"', {
        zt: { items: ["foo", "bar"] },
      }),
    ).toEqual(["foo!", "bar!"]);
  });

  it("returns an empty array for empty input", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync('zt.items | arr_suffix: "!"', {
        zt: { items: [] },
      }),
    ).toEqual([]);
  });

  it("throws for non-array input", () => {
    const engine = createLiquidEngine();
    expect(() =>
      engine.evalValueSync('zt.items | arr_suffix: "!"', {
        zt: { items: "not-array" },
      }),
    ).toThrow("arr_suffix requires an array");
  });
});

describe("arr_replace filter", () => {
  it("replaces every occurrence in every element", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync('zt.items | arr_replace: "/", " > "', {
        zt: { items: ["a/b/c", "d/e"] },
      }),
    ).toEqual(["a > b > c", "d > e"]);
  });

  it("deletes the search string when the replacement is omitted", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync('zt.items | arr_replace: "."', {
        zt: { items: ["a.b", "c."] },
      }),
    ).toEqual(["ab", "c"]);
  });

  it("coerces every element to a string", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync('zt.items | arr_replace: "0", "-"', {
        zt: { items: [101, 20] },
      }),
    ).toEqual(["1-1", "2-"]);
  });

  it("returns an empty array for empty input", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync('zt.items | arr_replace: "a", "b"', {
        zt: { items: [] },
      }),
    ).toEqual([]);
  });

  it("throws for non-array input", () => {
    const engine = createLiquidEngine();
    expect(() =>
      engine.evalValueSync('zt.items | arr_replace: "a", "b"', {
        zt: { items: "not-array" },
      }),
    ).toThrow("arr_replace requires an array");
  });

  it("throws when the search string is missing", () => {
    const engine = createLiquidEngine();
    expect(() =>
      engine.evalValueSync("zt.items | arr_replace", {
        zt: { items: ["a"] },
      }),
    ).toThrow("arr_replace requires a search string");
  });

  it("throws for an empty search string, which would match between every character", () => {
    const engine = createLiquidEngine();
    expect(() =>
      engine.evalValueSync('zt.items | arr_replace: "", "-"', {
        zt: { items: ["abc"] },
      }),
    ).toThrow("arr_replace requires a search string");
  });
});

describe("obsidian_tag filter", () => {
  it("normalizes every element of an array", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync("zt.items | obsidian_tag", {
        zt: { items: ["Machine Learning", "R & D"] },
      }),
    ).toEqual(["Machine_Learning", "R_D"]);
  });

  it("normalizes a scalar to a scalar", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync("zt.name | obsidian_tag", {
        zt: { name: "Machine Learning" },
      }),
    ).toBe("Machine_Learning");
  });

  it("reads the name of a tag object, so map is not needed", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync("zt.tags | obsidian_tag", {
        zt: { tags: [{ name: "Machine Learning" }, { name: "Open Access" }] },
      }),
    ).toEqual(["Machine_Learning", "Open_Access"]);
  });

  it("adds the prefix verbatim, after normalizing", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync('zt.items | obsidian_tag: "#"', {
        zt: { items: ["Machine Learning"] },
      }),
    ).toEqual(["#Machine_Learning"]);
    expect(
      engine.evalValueSync('zt.items | obsidian_tag: "zotero/"', {
        zt: { items: ["Machine Learning"] },
      }),
    ).toEqual(["zotero/Machine_Learning"]);
  });

  it("stays idempotent under a # prefix", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync('zt.items | obsidian_tag: "#"', {
        zt: { items: ["#todo"] },
      }),
    ).toEqual(["#todo"]);
  });

  it("drops an element that normalizes to nothing", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync('zt.items | obsidian_tag: "#"', {
        zt: { items: ["ok", "!!!", "   "] },
      }),
    ).toEqual(["#ok"]);
  });

  it("normalizes a number, so a year tag stays usable", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync("zt.items | obsidian_tag", {
        zt: { items: [1984] },
      }),
    ).toEqual(["_1984"]);
  });

  it("drops an object that carries no name", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync("zt.items | obsidian_tag", {
        zt: { items: [{ other: "x" }, "ok"] },
      }),
    ).toEqual(["ok"]);
  });

  it("returns an empty string for a scalar that normalizes to nothing", () => {
    const engine = createLiquidEngine();
    expect(
      engine.evalValueSync('zt.name | obsidian_tag: "#"', {
        zt: { name: "!!!" },
      }),
    ).toBe("");
  });
});

describe("suffix tag", () => {
  it("emits the default marker", () => {
    const engine = createLiquidEngine();
    expect(engine.parseAndRenderSync("{% suffix %}", {})).toBe(
      filenameSuffix(),
    );
  });

  it("accepts a length argument", () => {
    const engine = createLiquidEngine();
    expect(engine.parseAndRenderSync("{% suffix 8 %}", {})).toBe(
      filenameSuffix(8),
    );
  });

  it("accepts length, prepend, and append arguments", () => {
    const engine = createLiquidEngine();
    expect(engine.parseAndRenderSync('{% suffix 8, "-", "~" %}', {})).toBe(
      filenameSuffix(8, "-", "~"),
    );
  });

  it("round-trips through hasSuffixMarker/replaceSuffixMarkers", () => {
    const engine = createLiquidEngine();
    const rendered = engine.parseAndRenderSync(
      'name{% suffix 4, "-", "~" %}',
      {},
    );

    expect(hasSuffixMarker(rendered)).toBe(true);
    expect(
      replaceSuffixMarkers(
        rendered,
        ({ length, prepend, append }) =>
          `${prepend}${"x".repeat(length)}${append}`,
      ),
    ).toBe("name-xxxx~");
  });
});

describe("output coercion", () => {
  it("renders missing/undefined and null as empty strings", () => {
    const engine = createLiquidEngine();
    expect(engine.parseAndRenderSync("[{{ zt.missing }}]", {})).toBe("[]");
    expect(
      engine.parseAndRenderSync("[{{ zt.value }}]", { zt: { value: null } }),
    ).toBe("[]");
  });

  it("renders a Temporal.Instant as the local date", () => {
    const engine = createLiquidEngine();
    const instant = Temporal.Instant.from("2026-06-21T04:00:00Z");
    const expected = instant
      .toZonedDateTimeISO(Temporal.Now.timeZoneId())
      .toPlainDate()
      .toString();

    expect(
      engine.parseAndRenderSync("{{ zt.value }}", { zt: { value: instant } }),
    ).toBe(expected);
  });

  it("renders objects via their toString (e.g. ItemDate)", () => {
    const engine = createLiquidEngine();
    expect(
      engine.parseAndRenderSync("{{ zt.value }}", {
        zt: { value: { kind: "year", toString: () => "January 2013" } },
      }),
    ).toBe("January 2013");
  });

  it("renders a JS Date via toISOString", () => {
    const engine = createLiquidEngine();
    const date = new Date("2026-06-21T04:00:00Z");
    expect(
      engine.parseAndRenderSync("{{ zt.value }}", { zt: { value: date } }),
    ).toBe(date.toISOString());
  });
});

describe("date filter", () => {
  it("formats a Temporal.Instant in local time", () => {
    const engine = createLiquidEngine();
    const instant = Temporal.Instant.from("2026-06-21T04:00:00Z");
    const expected = instant
      .toZonedDateTimeISO(Temporal.Now.timeZoneId())
      .toPlainDate()
      .toString();

    expect(
      engine.parseAndRenderSync('{{ zt.value | date: "%Y-%m-%d" }}', {
        zt: { value: instant },
      }),
    ).toBe(expected);
  });

  it("formats an ItemDate 'date' fixture with %Y-%m-%d", () => {
    const engine = createLiquidEngine();
    const value = {
      kind: "date",
      year: 2023,
      month: 6,
      day: 15,
      raw: "2023-06-15",
      toString: () => "2023-06-15",
    };

    expect(
      engine.parseAndRenderSync('{{ zt.value | date: "%Y-%m-%d" }}', {
        zt: { value },
      }),
    ).toBe("2023-06-15");
  });

  it("formats an ItemDate 'yearMonth' fixture with %Y-%m", () => {
    const engine = createLiquidEngine();
    const value = {
      kind: "yearMonth",
      year: 2023,
      month: 6,
      raw: "2023-06",
      toString: () => "2023-06",
    };

    expect(
      engine.parseAndRenderSync('{{ zt.value | date: "%Y-%m" }}', {
        zt: { value },
      }),
    ).toBe("2023-06");
  });

  it("formats an ItemDate 'year' fixture with %Y", () => {
    const engine = createLiquidEngine();
    const value = {
      kind: "year",
      year: 2023,
      raw: "2023",
      toString: () => "2023",
    };

    expect(
      engine.parseAndRenderSync('{{ zt.value | date: "%Y" }}', {
        zt: { value },
      }),
    ).toBe("2023");
  });

  it("passes an ItemDate 'text' fixture through toString regardless of format", () => {
    const engine = createLiquidEngine();
    const value = {
      kind: "text",
      raw: "submitted",
      toString: () => "submitted",
    };

    expect(
      engine.parseAndRenderSync('{{ zt.value | date: "%Y-%m-%d" }}', {
        zt: { value },
      }),
    ).toBe("submitted");
  });

  it("formats a Temporal.PlainYearMonth with %Y-%m", () => {
    const engine = createLiquidEngine();
    const value = Temporal.PlainYearMonth.from("2023-06");

    expect(
      engine.parseAndRenderSync('{{ zt.value | date: "%Y-%m" }}', {
        zt: { value },
      }),
    ).toBe("2023-06");
  });

  it("formats a Temporal.PlainDate identically in any timezone", () => {
    const engine = createLiquidEngine();
    const value = Temporal.PlainDate.from("2023-06-15");

    expect(
      engine.parseAndRenderSync('{{ zt.value | date: "%Y-%m-%d" }}', {
        zt: { value },
      }),
    ).toBe("2023-06-15");
  });

  it("formats a plain date string via the builtin filter", () => {
    const engine = createLiquidEngine();
    expect(
      engine.parseAndRenderSync('{{ "2023-06-15" | date: "%d %b %Y" }}', {}),
    ).toBe("15 Jun 2023");
  });
});

describe("strict filters", () => {
  it("throws on an unknown filter, naming it with a line/col", () => {
    const engine = createLiquidEngine();
    expect(() =>
      engine.parseAndRenderSync('{{ "a" | nosuchfilter }}', {}),
    ).toThrow(/nosuchfilter.*line:\d+.*col:\d+/s);
  });
});
