import { describe, expect, it } from "vitest";

import { hoverHint, rootAt, suggestions } from "./suggestions";
import type { SuggestionConfig } from "./suggestions";

const note: SuggestionConfig = { root: "note", partials: ["cite", "content"] };
const eta: SuggestionConfig = { ...note, language: "eta" };

function labels(source: string, config = note, position = source.length) {
  return suggestions(source, position, config)?.options.map((o) => o.label);
}

describe("rootAt", () => {
  it("switches to the annotation root after the final section header", () => {
    const source = "{{ zt.title }}\n--- zotlit:annotation ---\n{{ zt.text }}";
    expect(rootAt(source, 5, "note")).toBe("note");
    expect(rootAt(source, source.length, "note")).toBe("annotation");
  });

  it("accepts CRLF line endings", () => {
    const source = "a\r\n--- zotlit:annotation ---\r\nb";
    expect(rootAt(source, source.length, "filename")).toBe("annotation");
  });
});

describe("suggestions: contract roots", () => {
  it("resolves Note root fields with their contract types", () => {
    const result = suggestions("# {{ zt.ti", 10, note);
    expect(result).toMatchObject({
      from: 8,
      to: 10,
      tagEnd: 10,
      root: "note",
      trigger: "Template fields",
    });
    const title = result!.options.find((o) => o.label === "title");
    expect(title).toMatchObject({ insert: "title", type: "string | null" });
    expect(result!.options.map((o) => o.label)).toEqual(["title"]);
  });

  it("resolves Annotation root fields once the section header precedes the cursor", () => {
    const source = "{{ zt.title }}\n--- zotlit:annotation ---\n{{ zt.";
    const found = labels(source);
    expect(found).toContain("pageLabel");
    expect(found).toContain("text");
    expect(found).not.toContain("annotations");
  });

  it("resolves Eta Annotation root fields once the section header precedes the cursor", () => {
    const before = "<%= zt.title %>";
    const source = `${before}\n--- zotlit:annotation ---\n<%= zt.`;
    const afterHeader = labels(source, eta);
    expect(afterHeader).toContain("pageLabel");
    expect(afterHeader).toContain("text");
    expect(afterHeader).not.toContain("annotations");
    // Contrast: a position before the header still uses the configured root.
    const beforeHeader = labels(source, eta, before.indexOf("zt.") + 3);
    expect(beforeHeader).toContain("title");
    expect(beforeHeader).not.toContain("pageLabel");
  });

  it("resolves Filename root fields", () => {
    const found = labels("{{ zt.", { ...note, root: "filename" });
    expect(found).toContain("citekey");
    expect(found).not.toContain("annotations");
  });

  it("walks nested paths and array positions", () => {
    expect(labels("{{ zt.creators.first.")).toContain("family");
    expect(labels("{{ zt.creators.")).toEqual(
      expect.arrayContaining(["first", "last", "size"]),
    );
    expect(labels("<%= zt.creators.", eta)).toEqual(["length"]);
    expect(labels("{{ zt.nope.")).toBeUndefined();
  });

  it("offers Sample-value hints when a snapshot is supplied", () => {
    const sample = { title: "Deep Work", creators: [{ family: "Newport" }] };
    const config = { ...note, sample };
    const title = suggestions("{{ zt.ti", 8, config)!.options[0];
    expect(title!.example).toBe('Sample: "Deep Work"');
    const family = suggestions("{{ zt.creators.first.fam", 24, config)!
      .options[0];
    expect(family!.example).toBe('Sample: "Newport"');
  });

  it("offers the root after whitespace", () => {
    expect(suggestions("{{ ", 3, note)!.options).toEqual([
      expect.objectContaining({ label: "zt", insert: "zt." }),
    ]);
  });
});

describe("suggestions: filters, tags, and partials", () => {
  it("lists registered filters after a pipe, marking ZotLit additions", () => {
    const result = suggestions("{{ zt.title | up", 16, note)!;
    expect(result.trigger).toBe("Filters");
    expect(result.options.map((o) => o.label)).toEqual(["upcase"]);
    expect(result.options[0]!.category).toBe("liquid-filter");
    const zotlit = suggestions("{{ zt.tags | obs", 16, note)!.options[0]!;
    expect(zotlit).toMatchObject({
      label: "obsidian_tag",
      category: "zotlit-filter",
    });
  });

  it("completes filters inside a multiline {% liquid %} block", () => {
    const source = "{% liquid\n  echo zt.title | down";
    expect(labels(source)).toEqual(["downcase"]);
  });

  it("lists tags after {% including ZotLit and structural tags", () => {
    const found = labels("{% ")!;
    expect(found).toEqual(expect.arrayContaining(["for", "bq", "managed"]));
    expect(found).toEqual([...found].sort());
  });

  it("completes partial names after render and include", () => {
    expect(labels('{% render "ci')).toEqual(["cite"]);
    expect(labels('<%~ include("c', eta)).toEqual(["cite", "content"]);
  });

  it("stays silent inside comments and string literals", () => {
    expect(suggestions("{% # zt.", 8, note)).toBeNull();
    expect(suggestions('{{ "zt.', 7, note)).toBeNull();
    expect(suggestions('<%= "zt.', 8, eta)).toBeNull();
    expect(suggestions("plain zt.", 9, note)).toBeNull();
  });
});

describe("suggestions: annotation shortcut", () => {
  it("offers the Liquid tag with its native equivalent", () => {
    const shortcut = (source: string) =>
      suggestions(source, 6, note)!.options.find(
        (o) => o.label === "render_annotation",
      )!;
    const option = shortcut("{% ren");
    expect(option).toMatchObject({
      label: "render_annotation",
      insert: "render_annotation annotation",
      cursorOffset: "render_annotation ".length,
      example:
        '{% render_annotation annotation %} = {% render "annotation" with annotation as zt %}',
    });
    // An existing argument keeps the tag name alone.
    expect(shortcut("{% ren a %}").insert).toBe("render_annotation");
  });

  it("offers the Eta helper with its native equivalent", () => {
    const option = suggestions("<%~ renderAnn", 13, eta)!.options[0]!;
    expect(option).toMatchObject({
      label: "renderAnnotation",
      insert: "renderAnnotation(annotation)",
      cursorOffset: "renderAnnotation(".length,
      example:
        '<%~ renderAnnotation(annotation) %> = <%~ include("annotation", annotation) %>',
    });
    expect(
      suggestions("<%~ renderAnn(a) %>", 13, eta)!.options[0]!.insert,
    ).toBe("renderAnnotation");
  });
});

describe("suggestions: snippets", () => {
  it("offers a loop over an array output in both languages", () => {
    const liquid = suggestions("{{ zt.annotations }}", 17, note)!;
    expect(liquid.options.find((o) => o.category === "loop")).toEqual({
      label: "annotations → for block",
      insert:
        "{% for annotation in zt.annotations %}\n{% render_annotation annotation %}\n{% endfor %}",
      category: "loop",
      detail:
        "Renders each annotation through the Profile's Annotation Section, with its data bound to zt. Generic templates use the named partial.",
      from: 0,
      to: 20,
    });
    const tags = suggestions("{{ zt.tags }}", 10, note)!;
    expect(tags.options.find((o) => o.category === "loop")!.insert).toBe(
      "{% for entry in zt.tags %}\n- {{ entry.name }}\n{% endfor %}",
    );
    const script = suggestions("<%= zt.annotations %>", 18, eta)!;
    expect(script.options.find((o) => o.category === "loop")!.insert).toBe(
      "<% for (const annotation of zt.annotations) { %>\n<%~ renderAnnotation(annotation) %>\n<% } %>",
    );
  });

  it("wraps managed in a paired block that keeps indentation and consumes the close", () => {
    const source = "  {%- man %}";
    const option = suggestions(source, 9, note)!.options.find(
      (o) => o.label === "managed",
    )!;
    expect(option).toMatchObject({
      insert: "{%- managed %}\n  \n  {% endmanaged %}",
      from: 2,
      to: 12,
      cursorOffset: "{%- managed %}\n  ".length,
    });
  });
});

describe("hoverHint", () => {
  it("describes the word under the pointer without moving the range", () => {
    const source = "{{ zt.title | upcase }}";
    expect(hoverHint(source, 7, note)).toMatchObject({
      from: 6,
      to: 11,
      options: [expect.objectContaining({ label: "title" })],
    });
    expect(hoverHint(source, 16, note)!.options[0]!.label).toBe("upcase");
    expect(hoverHint(source, 1, note)).toBeNull();
  });
});
