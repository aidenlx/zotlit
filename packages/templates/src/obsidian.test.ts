import { describe, expect, it, vi } from "vitest";

import {
  formatManagedRegion,
  MARKER_END,
  MARKER_START,
  replaceManagedRegion,
} from "./obsidian";

const oldRegion = `${MARKER_START}\nOLD\n${MARKER_END}`;

describe("formatManagedRegion", () => {
  it("ends a region that ends in a callout with the closing marker on its own block", () => {
    // Without the blank line, the marker is a lazy continuation of the last
    // callout, and Live Preview hides it inside the rendered callout.
    const region = formatManagedRegion("> [!note] Page 1\n>\n> A quote.\n");
    expect(region).toBe(
      `${MARKER_START}\n> [!note] Page 1\n>\n> A quote.\n\n${MARKER_END}`,
    );
  });

  it("keeps an empty region to one blank line", () => {
    expect(formatManagedRegion("\n")).toBe(`${MARKER_START}\n\n${MARKER_END}`);
  });
});

describe("replaceManagedRegion", () => {
  it("leaves content untouched when no managed region is present", () => {
    const region = vi.fn(() => "ignored");
    expect(replaceManagedRegion("# Title\n\nbody", region)).toEqual({
      content: "# Title\n\nbody",
      replaced: false,
      duplicateCount: 0,
    });
    expect(region).not.toHaveBeenCalled();
  });

  it("replaces the single managed region with the new region", () => {
    const region = formatManagedRegion("NEW");
    expect(
      replaceManagedRegion(`before\n${oldRegion}\nafter`, () => region),
    ).toEqual({
      content: `before\n${region}\nafter`,
      replaced: true,
      duplicateCount: 0,
    });
  });

  it("inserts `$$…$$` display math verbatim, not as replace patterns", () => {
    const region = formatManagedRegion("$$E=mc^2$$");
    const { content } = replaceManagedRegion(
      `before\n${oldRegion}\nafter`,
      () => region,
    );
    expect(content).toBe(`before\n${region}\nafter`);
    expect(content).toContain("$$E=mc^2$$");
  });

  it("inserts `$&`, `$'`, and `$\\`` verbatim, not as replace patterns", () => {
    const region = formatManagedRegion("literal $& $' $` end");
    const { content } = replaceManagedRegion(
      `before\n${oldRegion}\nafter`,
      () => region,
    );
    expect(content).toBe(`before\n${region}\nafter`);
  });

  it("leaves content untouched when markers are unbalanced", () => {
    const region = vi.fn(() => "ignored");

    const startOnly = `before\n${MARKER_START}\nOLD\nafter`;
    expect(replaceManagedRegion(startOnly, region)).toEqual({
      content: startOnly,
      replaced: false,
      duplicateCount: 0,
    });

    const endOnly = `before\nOLD\n${MARKER_END}\nafter`;
    expect(replaceManagedRegion(endOnly, region)).toEqual({
      content: endOnly,
      replaced: false,
      duplicateCount: 0,
    });

    expect(region).not.toHaveBeenCalled();
  });

  it("replaces only the first region and counts the rest as duplicates", () => {
    const region = formatManagedRegion("NEW");
    const result = replaceManagedRegion(
      `${oldRegion}\nmid\n${oldRegion}\nend\n${oldRegion}`,
      () => region,
    );
    expect(result).toEqual({
      content: `${region}\nmid\n${oldRegion}\nend\n${oldRegion}`,
      replaced: true,
      duplicateCount: 2,
    });
  });

  it("invokes the provider at most once", () => {
    const region = vi.fn(() => formatManagedRegion("NEW"));
    replaceManagedRegion(`${oldRegion}\nmid\n${oldRegion}`, region);
    expect(region).toHaveBeenCalledTimes(1);
  });

  describe("a Query Block in the region", () => {
    const block = (body: string) => `\`\`\`zotquery\n${body}\n\`\`\``;
    const rendered = block(
      "views:\n  - type: annotations\n    name: Annotations",
    );
    const edited = block(
      "views:\n  - type: annotations\n    name: Annotations\n    sort:\n      - property: type\n        direction: DESC",
    );
    const region = (inner: string) =>
      formatManagedRegion(`## Annotations\n\n${inner}\n\nNEW`);

    it("keeps the block text the note holds over the rendered block", () => {
      const note = `before\n${region(edited).replace("NEW", "OLD")}\nafter`;
      expect(replaceManagedRegion(note, () => region(rendered)).content).toBe(
        `before\n${region(edited)}\nafter`,
      );
    });

    it("writes the rendered block where the note holds none", () => {
      const note = `before\n${oldRegion}\nafter`;
      expect(replaceManagedRegion(note, () => region(rendered)).content).toBe(
        `before\n${region(rendered)}\nafter`,
      );
    });

    it("drops the note's block when the render has none", () => {
      const note = `before\n${region(edited)}\nafter`;
      const plain = formatManagedRegion("NEW");
      expect(replaceManagedRegion(note, () => plain).content).toBe(
        `before\n${plain}\nafter`,
      );
    });

    it("keeps a block in a longer fence and leaves other code blocks to the render", () => {
      const fenced = "````zotquery\nviews: []\n```inner\n````";
      const note = formatManagedRegion(`\`\`\`js\nold()\n\`\`\`\n\n${fenced}`);
      const next = formatManagedRegion(
        `\`\`\`js\nnew()\n\`\`\`\n\n${rendered}`,
      );
      expect(replaceManagedRegion(note, () => next).content).toBe(
        formatManagedRegion(`\`\`\`js\nnew()\n\`\`\`\n\n${fenced}`),
      );
    });

    it("keeps the blocks in their order and renders a block the note lacks", () => {
      const second = block("views:\n  - type: annotations\n    name: Second");
      const note = formatManagedRegion(`${edited}\n\nOLD`);
      const next = formatManagedRegion(`${rendered}\n\n${second}`);
      expect(replaceManagedRegion(note, () => next).content).toBe(
        formatManagedRegion(`${edited}\n\n${second}`),
      );
    });

    it("inserts `$` sequences in a kept block verbatim", () => {
      const kept = block("views:\n  - type: annotations\n    name: $& $' $`");
      expect(
        replaceManagedRegion(formatManagedRegion(kept), () =>
          formatManagedRegion(rendered),
        ).content,
      ).toBe(formatManagedRegion(kept));
    });
  });
});
