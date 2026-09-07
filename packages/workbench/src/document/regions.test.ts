import { describe, expect, it } from "vitest";

import { noteRegions } from "./regions";

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
