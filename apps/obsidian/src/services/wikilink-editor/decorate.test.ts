import { describe, expect, it } from "vitest";

import type { LiteratureNoteTarget } from "@/lib/wikilink-citation";

import { wikilinkDecorations } from "./decorate";
import type { WikilinkDisplayContext } from "./decorate";
import type { WikilinkSpan } from "./scan";

/** A scanned link at fixed offsets: `[[` at 0, the interior from 2. */
function span(
  linktext: string,
  overrides: Partial<WikilinkSpan> = {},
): WikilinkSpan {
  const inner = { from: 2, to: 2 + linktext.length };
  const outer = { from: 0, to: inner.to + 2 };
  return {
    isEmbed: false,
    hasAlias: false,
    inner,
    outer,
    group: outer,
    linktext,
    tokenClasses: ["hmd-internal-link"],
    ...overrides,
  };
}

const WANG: LiteratureNoteTarget = {
  path: "literatures/wangMutationalClinicalSpectrum2020a.md",
  citationKey: "wang2020",
};

function context(
  overrides: Partial<WikilinkDisplayContext> = {},
): WikilinkDisplayContext {
  return {
    literatureNote: (linkpath) =>
      linkpath.startsWith("literatures/wang") ? WANG : null,
    fragmentlessDisplay: true,
    selection: [],
    ...overrides,
  };
}

const WANG_LINK = "literatures/wangMutationalClinicalSpectrum2020a";

describe("wikilinkDecorations", () => {
  it("replaces the link's interior with its Citation Display Text", () => {
    expect(
      wikilinkDecorations([span(`${WANG_LINK}#cite:locator=7`)], context()),
    ).toEqual([
      {
        from: 2,
        to: 2 + `${WANG_LINK}#cite:locator=7`.length,
        text: "[@wang2020, p. 7]",
        tokenClasses: ["hmd-internal-link"],
      },
    ]);
  });

  it("leaves a link with no Citation Display Text alone", () => {
    expect(
      wikilinkDecorations([span(`${WANG_LINK}#cite:page=7`)], context()),
    ).toEqual([]);
  });

  it("leaves an aliased link alone, since the alias is the chosen display", () => {
    expect(
      wikilinkDecorations([span(WANG_LINK, { hasAlias: true })], context()),
    ).toEqual([]);
  });

  it("leaves an embed alone", () => {
    expect(
      wikilinkDecorations([span(WANG_LINK, { isEmbed: true })], context()),
    ).toEqual([]);
  });

  it("reveals raw text when the selection touches the conceal group", () => {
    const link = span(`${WANG_LINK}#cite:locator=7`);
    const { from, to } = link.group;
    for (const at of [from, to]) {
      expect(
        wikilinkDecorations(
          [link],
          context({ selection: [{ from: at, to: at }] }),
        ),
      ).toEqual([]);
    }
  });

  it("keeps the display when the selection stops short of the group", () => {
    const link = span(`${WANG_LINK}#cite:locator=7`);
    const past = link.group.to + 1;
    expect(
      wikilinkDecorations(
        [link],
        context({ selection: [{ from: past, to: past }] }),
      ),
    ).toHaveLength(1);
  });

  it("reveals a link its group covers but its own range does not", () => {
    // Two links written back to back share one group, so a caret between them
    // reveals both — the grouping Obsidian's own conceal pass applies.
    const link = span(`${WANG_LINK}#cite:locator=7`, {
      group: { from: 0, to: 80 },
    });
    expect(
      wikilinkDecorations(
        [link],
        context({ selection: [{ from: 80, to: 80 }] }),
      ),
    ).toEqual([]);
  });
});
