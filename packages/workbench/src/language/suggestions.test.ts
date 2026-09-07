import { describe, expect, it } from "vitest";

import { completionEdit, hoverHint, rootAt, suggestions } from "./suggestions";
import type { SuggestionConfig } from "./suggestions";

const note: SuggestionConfig = { root: "note", partials: ["cite", "content"] };
const eta: SuggestionConfig = { ...note, language: "eta" };

it("completes a bare Property expression within its source range in Advanced", () => {
  const source = "expr: zt.ti\nnext: kept";
  const result = suggestions(source, 11, {
    ...note,
    mode: "expression",
    scope: { from: 6, to: 11 },
  })!;
  const edit = completionEdit(
    source,
    result,
    result.options.find((option) => option.label === "title")!,
  );
  expect(source.slice(0, edit.from) + edit.insert + source.slice(edit.to)).toBe(
    "expr: zt.title\nnext: kept",
  );
  expect(edit.anchor).toBe(14);
});

it("finishes scalar output and continues into objects without duplicating delimiters", () => {
  const accept = (source: string, name: string) => {
    const position =
      source.indexOf(" }}") < 0 ? source.length : source.indexOf(" }}");
    const result = suggestions(source, position, note)!;
    const edit = completionEdit(
      source,
      result,
      result.options.find((o) => o.label === name)!,
    );
    return {
      text: source.slice(0, edit.from) + edit.insert + source.slice(edit.to),
      anchor: edit.anchor,
      continue: edit.continue,
    };
  };
  expect(accept("{{ zt.ti", "title")).toEqual({
    text: "{{ zt.title }}",
    anchor: 14,
    continue: false,
  });
  expect(accept("{{ zt.ti }}", "title")).toEqual({
    text: "{{ zt.title }}",
    anchor: 14,
    continue: false,
  });
  expect(accept("{{ zt.creators.fi }}", "first")).toEqual({
    text: "{{ zt.creators.first. }}",
    anchor: 21,
    continue: true,
  });
});

it("reuses an existing member separator when accepting inside a path", () => {
  const source = "{{ zt.creators.first.family }}";
  const result = suggestions(source, source.indexOf(".first"), note)!;
  const edit = completionEdit(
    source,
    result,
    result.options.find((option) => option.label === "creators")!,
  );
  expect(source.slice(0, edit.from) + edit.insert + source.slice(edit.to)).toBe(
    source,
  );
  expect(edit.anchor).toBe(source.indexOf("first"));
  expect(edit.continue).toBe(true);
});

it("offers a completed capture in its isolated scope", () => {
  const capture = "{% capture heading %}Hello{% endcapture %}";
  expect(labels(`${capture}{{ hea`)).toContain("heading");
  expect(labels(`${capture}{% managed %}{{ hea`)).not.toContain("heading");
  expect(labels(`{% managed %}${capture}{% endmanaged %}{{ hea`)).not.toContain(
    "heading",
  );
});

it("accepts a whole-tag loop as one edit and preserves CRLF source", () => {
  const source = "Heading\r\n{{ zt.annotations }}\r\nAfter";
  const result = suggestions(source, source.indexOf(" }}"), note)!;
  const option = result.options.find((entry) => entry.category === "loop")!;
  const edit = completionEdit(source, result, option);
  const output =
    source.slice(0, edit.from) + edit.insert + source.slice(edit.to);
  expect(output).toBe(
    "Heading\r\n{% for annotation in zt.annotations %}\r\n{% render_annotation annotation %}\r\n{% endfor %}\r\nAfter",
  );
  expect(output.slice(edit.anchor)).toBe("\r\nAfter");
});

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
  it("keeps conditionally assigned names without claiming a definite member type", () => {
    const source =
      "{% if zt.title %}{% assign selected = zt.creators.first %}{% endif %}\n";
    expect(labels(`${source}{{ sel`)).toContain("selected");
    expect(labels(`${source}{{ selected.`)).toBeUndefined();
  });
  it("resolves earlier assignments while typing a multiline Liquid tag", () => {
    const source =
      "{% liquid\n assign creator = zt.creators.first\n echo creator.\n%}";
    expect(labels(source, note, source.indexOf(".\n%}") + 1)).toContain(
      "family",
    );
  });
  it("offers uncertain assignment names without guessing members or crossing the Annotation Section", () => {
    const prefix = "{% assign transformed = zt.creators | custom_filter %}\n";
    expect(labels(`${prefix}{{ trans`)).toContain("transformed");
    expect(labels(`${prefix}{{ transformed.`)).toBeUndefined();
    expect(
      labels(`${prefix}--- zotlit:annotation ---\n{{ trans`),
    ).not.toContain("transformed");
  });
  it("resolves locals independently inside and outside a Managed Block", () => {
    const source = [
      "{% assign outside = zt.creators.first %}",
      "{{ outside. }}",
      "{% managed %}",
      "{{ outside. }}",
      "{% for creator in zt.creators %}",
      "{{ creator. }}",
      "{% endfor %}",
      "{{ creator. }}",
      "{% assign inside = zt.creators.first %}",
      "{{ inside. }}",
      "{% endmanaged %}",
      "{{ inside. }}",
      "{{ outside. }}",
    ].join("\n");
    const at = (expression: string, last = false) => {
      const start = last
        ? source.lastIndexOf(expression)
        : source.indexOf(expression);
      return labels(source, note, start + expression.length);
    };
    expect(at("{{ outside.")).toContain("family");
    expect(
      labels(
        source,
        note,
        source.indexOf("{{ outside.", source.indexOf("{% managed")) + 11,
      ),
    ).toBeUndefined();
    expect(at("{{ creator.")).toContain("family");
    expect(at("{{ creator.", true)).toBeUndefined();
    expect(at("{{ inside.")).toContain("family");
    expect(at("{{ inside.", true)).toBeUndefined();
    expect(at("{{ outside.", true)).toContain("family");
  });
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
    expect(result!.options[0]!.label).toBe("title");
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
    expect(suggestions("{{ ", 3, note)!.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "zt", insert: "zt." }),
        expect.objectContaining({ label: "title", insert: "zt.title" }),
      ]),
    );
  });

  it("matches human labels and paths, with common fields first and optional fields present", () => {
    const config = {
      ...note,
      sample: {},
      fields: [
        { path: "zt.citekey", label: "Citation key" },
        { path: "zt.title", label: "Paper title" },
      ],
    };
    expect(labels("{{", config)?.slice(0, 2)).toEqual(["citekey", "title"]);
    expect(labels("{{ citation", config)?.[0]).toBe("citekey");
    expect(labels("{{ zt.ttl", config)).toContain("title");
    const source = "{{ Citation key";
    const result = suggestions(source, source.length, config)!;
    const edit = completionEdit(source, result, result.options[0]!);
    expect(
      source.slice(0, edit.from) + edit.insert + source.slice(edit.to),
    ).toBe("{{ zt.citekey }}");
  });
});

describe("suggestions: filters, tags, and partials", () => {
  it("documents built-in tags, branches, and ZotLit boundaries", () => {
    const found = suggestions("{% ", 3, note)!.options;
    expect(found.map((option) => option.label)).toEqual(
      expect.arrayContaining([
        "endif",
        "else",
        "elsif",
        "when",
        "endbq",
        "endmanaged",
      ]),
    );
    for (const option of found) {
      expect(option.syntax).toBeTruthy();
      expect(option.example).toBeTruthy();
      expect(option.detail).not.toContain("registry");
    }
    expect(hoverHint("{% endif %}", 5, note)!.options[0]).toMatchObject({
      label: "endif",
      syntax: "{% endif %}",
    });
  });

  it("lists registered filters after a pipe, marking ZotLit additions", () => {
    const result = suggestions("{{ zt.title | up", 16, note)!;
    expect(result.trigger).toBe("Filters");
    expect(result.options[0]!.label).toBe("upcase");
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
  it("offers the Liquid tag with an annotation loop example", () => {
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
        "{% for annotation in zt.annotations %}{% render_annotation annotation %}{% endfor %}",
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
  it("keeps later tags active after apostrophes in multiline comments", () => {
    const source =
      "{% liquid\n  # don't render this\n  echo zt.title\n%}\n{% bq %}Title{% endbq %}";
    expect(
      hoverHint(source, source.indexOf("bq") + 1, note)!.options[0]!.label,
    ).toBe("bq");
  });

  it("documents comment boundaries while leaving comment text and raw content inactive", () => {
    for (const source of [
      "{% comment %}{% bq %}{{ zt.title }}{% endcomment %}",
      "{% liquid\n  comment\n    bq\n    echo zt.title\n  endcomment\n%}",
      "{% raw %}{% bq %}{{ zt.title }}{% endraw %}",
      "{% liquid\n  raw\n    bq\n    echo zt.title\n  endraw\n%}",
      "{% # bq zt.title %}",
      "{% liquid\n  # bq zt.title\n%}",
    ]) {
      expect(hoverHint(source, source.indexOf("bq") + 1, note)).toBeNull();
      expect(hoverHint(source, source.indexOf("title") + 1, note)).toBeNull();
    }
    for (const source of [
      "{% comment %}hidden{% endcomment %}",
      "{% liquid\n  comment\n  hidden\n  endcomment\n%}",
    ]) {
      for (const name of ["comment", "endcomment"]) {
        expect(
          hoverHint(source, source.indexOf(name) + 1, note)!.options[0]!.label,
        ).toBe(name);
      }
    }
    expect(hoverHint("{% # hidden %}", 3, note)!.options[0]!.label).toBe("#");
    expect(
      hoverHint("{% liquid\n # hidden\n%}", 11, note)!.options[0]!.label,
    ).toBe("#");
  });

  it("resolves multiline tag names and keeps completion edits on their line", () => {
    const source = "{% liquid\n  bq\n    echo zt.title\n  endbq\n%}";
    for (const name of ["bq", "echo", "endbq"]) {
      const from = source.indexOf(name);
      expect(hoverHint(source, from + 1, note)).toMatchObject({
        from,
        to: from + name.length,
        options: [expect.objectContaining({ label: name })],
      });
    }
    const incomplete = "{% liquid\r\n  bq\r\n  endb\r\n%}";
    const position = incomplete.indexOf("endb") + 4;
    const result = suggestions(incomplete, position, note)!;
    const edit = completionEdit(
      incomplete,
      result,
      result.options.find((o) => o.label === "endbq")!,
    );
    expect(
      incomplete.slice(0, edit.from) + edit.insert + incomplete.slice(edit.to),
    ).toBe("{% liquid\r\n  bq\r\n  endbq\r\n%}");
    expect(labels("{% liquid\n  ")).not.toContain("managed");
  });

  it("shows the blockquote helper's syntax and example in hover and completion", () => {
    const source = "{% bq %}{{ zt.title }}{% endbq %}";
    const hover = hoverHint(source, 4, note)!.options[0]!;
    expect(hover).toMatchObject({
      label: "bq",
      syntax: "{% bq %}…{% endbq %}",
      example: "{% bq %}{{ zt.text }}{% endbq %}",
    });
    expect(suggestions("{% bq", 5, note)!.options[0]).toMatchObject({
      syntax: hover.syntax,
      example: hover.example,
    });
  });

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
