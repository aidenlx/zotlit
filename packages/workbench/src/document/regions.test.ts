import { describe, expect, it } from "vitest";

import { noteRegions, partialCalls } from "./regions";

/** The whole body is the note, which is what a Profile without a manifest is. */
function regions(body: string) {
  return noteRegions(body, { from: 0, to: body.length });
}

/** The text every call site covers, so an offset pair reads as its own source. */
function callText(body: string) {
  return regions(body).annotationCalls.map(({ call }) =>
    body.slice(call.from, call.to),
  );
}

describe("noteRegions", () => {
  it("finds the shortcut and both native call forms", () => {
    const body = [
      "{% render_annotation annotation %}",
      '{% render "annotation" with annotation as zt %}',
      "{% render 'annotation', zt: annotation %}",
      '{% render "highlight" with annotation as zt %}',
      "{% include annotation %}",
    ].join("\n");

    expect(callText(body)).toEqual([
      "{% render_annotation annotation %}",
      '{% render "annotation" with annotation as zt %}',
      "{% render 'annotation', zt: annotation %}",
    ]);
  });

  it("ignores a call inside a raw block, a comment, or a code region", () => {
    const body = `{% raw %}
{% render_annotation annotation %}
{% endraw %}
{% comment %}
{% render_annotation annotation %}
{% endcomment %}
\`\`\`liquid
{% render_annotation annotation %}
\`\`\`
Write \`{% render_annotation annotation %}\` in the note.

{% render_annotation annotation %}
`;

    expect(regions(body).annotationCalls).toHaveLength(1);
    expect(callText(body)).toEqual(["{% render_annotation annotation %}"]);
  });

  it("gives a call its own line only when nothing else shares it", () => {
    const body =
      "  {% render_annotation annotation %}  \nSee {% render_annotation annotation %} here.\n";
    const [owned, shared] = regions(body).annotationCalls;

    expect(body.slice(owned!.line!.from, owned!.line!.to)).toBe(
      "  {% render_annotation annotation %}  ",
    );
    expect(shared!.line).toBeNull();
  });

  it("reads the same regions from a CRLF body", () => {
    const body = [
      "{% managed %}",
      "{% render_annotation annotation %}",
      "{% endmanaged %}",
      "",
    ].join("\r\n");
    const { annotationCalls, managedBlock } = regions(body);

    // The line break stays outside the line each box owns.
    expect(
      body.slice(annotationCalls[0]!.line!.from, annotationCalls[0]!.line!.to),
    ).toBe("{% render_annotation annotation %}");
    expect(body.slice(managedBlock!.range.from, managedBlock!.range.to)).toBe(
      "{% managed %}\r\n{% render_annotation annotation %}\r\n{% endmanaged %}",
    );
  });

  it("reads the Managed Block as the lines its tags own, and the tags apart", () => {
    const body = `# {{ zt.title }}

{% managed %}
## Highlights
{% endmanaged %}

Notes.
`;
    const block = regions(body).managedBlock!;

    expect(body.slice(block.range.from, block.range.to)).toBe(
      "{% managed %}\n## Highlights\n{% endmanaged %}",
    );
    expect(body.slice(block.open.from, block.open.to)).toBe("{% managed %}");
    expect(body.slice(block.close.from, block.close.to)).toBe(
      "{% endmanaged %}",
    );
  });

  it("answers no Managed Block when the body carries no closed pair", () => {
    expect(regions("# {{ zt.title }}\n").managedBlock).toBeNull();
    expect(
      regions("{% managed %}\nOnly an open tag.\n").managedBlock,
    ).toBeNull();
  });

  it("reports call sites in the master offsets the note range starts at", () => {
    const source = "---\nid: x\n---\n{% render_annotation annotation %}\n";
    const note = { from: 14, to: source.length };
    const [site] = noteRegions(source, note).annotationCalls;

    expect(source.slice(site!.call.from, site!.call.to)).toBe(
      "{% render_annotation annotation %}",
    );
  });
});

describe("partialCalls", () => {
  /** The whole text is one region, which is what a pane over its own slice reads. */
  const calls = (body: string) =>
    partialCalls(body, { from: 0, to: body.length });

  it("recognizes render and include with a plain quoted name, and nothing else", () => {
    const body = [
      '{% render "authors" %}',
      "{% include 'venue-line' %}",
      "{% render partial_name %}",
      "{% include zt.partial %}",
      '{% render_annotation "authors" %}',
      '{% assign name = "authors" %}',
    ].join("\n");

    expect(calls(body).map(({ name }) => name)).toEqual([
      "authors",
      "venue-line",
    ]);
  });

  it("draws no box over a name a Shared Partial cannot be given", () => {
    // All five names the host refuses: a box over one would offer Edit partial
    // for a document that cannot exist.
    const body = ["filename", "note", "annotation", "content", "citation"]
      .map((name) => `{% render "${name}" %}`)
      .join("\n");

    expect(calls(body)).toEqual([]);
  });

  it("summarizes what a call passes after the name", () => {
    const body = [
      '{% render "authors" %}',
      '{%- render "authors" with zt.creators as zt -%}',
      "{% include 'venue-line', style: \"short\" %}",
    ].join("\n");

    expect(calls(body).map(({ arguments: passed }) => passed)).toEqual([
      "",
      "with zt.creators as zt",
      ', style: "short"',
    ]);
  });

  it("ignores a call inside a raw block, a comment, or a code region", () => {
    const body = `{% raw %}
{% render "authors" %}
{% endraw %}
{% comment %}
{% render "authors" %}
{% endcomment %}
\`\`\`liquid
{% render "authors" %}
\`\`\`
Write \`{% render "authors" %}\` in the note.

{% render "authors" %}
`;

    expect(calls(body)).toHaveLength(1);
  });

  it("marks the name alone, even when the keyword spells it too", () => {
    // "end" and "de" both read inside `render`, which is where a search of the
    // call text would land instead of on the name.
    const body = ['{% render "end" %}', "{%- include  'de' , x: 1 -%}"].join(
      "\n",
    );

    expect(
      calls(body).map(({ nameRange }) =>
        body.slice(nameRange.from, nameRange.to),
      ),
    ).toEqual(["end", "de"]);
  });

  it("reports call sites in the offsets the region starts at", () => {
    const source = '---\nid: x\n---\n{% render "authors" %}\n';
    const [site] = partialCalls(source, { from: 14, to: source.length });

    expect(source.slice(site!.call.from, site!.call.to)).toBe(
      '{% render "authors" %}',
    );
    expect(source.slice(site!.nameRange.from, site!.nameRange.to)).toBe(
      "authors",
    );
  });

  describe("in an Eta document", () => {
    const etaCalls = (body: string) =>
      partialCalls(body, { from: 0, to: body.length }, "eta");

    it("recognizes include with a plain quoted name, and nothing else", () => {
      const body = [
        '<%~ include("authors", zt) %>',
        "<%= include('venue-line') %>",
        "<%~ include(name) %>",
        '<%~ it.include("authors") %>',
        '<%~ include("annotation", annotation) %>',
        '<%~ include("citation") %>',
        '<%~ include("content") %>',
        '<% const name = "authors" %>',
        '<%~ include("unclosed", zt)',
      ].join("\n");

      expect(etaCalls(body).map(({ name }) => name)).toEqual([
        "authors",
        "venue-line",
      ]);
    });

    it("summarizes what a call passes after the name", () => {
      const body = [
        '<%~ include("authors") %>',
        '<%~ include("authors", zt.creators) %>',
      ].join("\n");

      expect(etaCalls(body).map(({ arguments: passed }) => passed)).toEqual([
        "",
        "zt.creators",
      ]);
    });

    it("boxes the whole tag and marks the name alone", () => {
      const source = '---\nid: x\n---\n<%~ include("end", zt) %>\n';
      const [site] = partialCalls(
        source,
        { from: 14, to: source.length },
        "eta",
      );

      expect(source.slice(site!.call.from, site!.call.to)).toBe(
        '<%~ include("end", zt) %>',
      );
      expect(source.slice(site!.nameRange.from, site!.nameRange.to)).toBe(
        "end",
      );
    });

    it("ignores a call inside a code region", () => {
      const body = [
        "```eta",
        '<%~ include("authors", zt) %>',
        "```",
        'Write `<%~ include("authors", zt) %>` in the note.',
        "",
        '<%~ include("authors", zt) %>',
      ].join("\n");

      expect(etaCalls(body)).toHaveLength(1);
    });

    it("leaves a Liquid tag in an Eta document as source", () => {
      expect(etaCalls('{% render "authors" with zt as zt %}')).toEqual([]);
    });
  });
});
