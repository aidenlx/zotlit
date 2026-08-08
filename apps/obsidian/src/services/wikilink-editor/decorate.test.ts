import { describe, expect, it } from "vitest";

import { citationTarget, wikilinkDecorations } from "./decorate";
import type { LiteratureNoteTarget, WikilinkDisplayContext } from "./decorate";
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

describe("citationTarget", () => {
  it("reads a bare linkpath", () => {
    expect(citationTarget("literatures/wang2020")).toEqual({
      linkpath: "literatures/wang2020",
      fragment: null,
    });
  });

  it("reads a Citation Fragment off the subpath", () => {
    expect(citationTarget("note#cite:locator=7")).toEqual({
      linkpath: "note",
      fragment: "locator=7",
    });
  });

  it("keeps an empty Citation Fragment, which the parser rejects on its own", () => {
    expect(citationTarget("note#cite:")).toEqual({
      linkpath: "note",
      fragment: "",
    });
  });

  it("leaves a heading or block subpath alone", () => {
    expect(citationTarget("note#Heading")).toBeNull();
    expect(citationTarget("note#^block-id")).toBeNull();
  });

  it("leaves a subpath-only link alone, which names no note", () => {
    expect(citationTarget("#Heading")).toBeNull();
    expect(citationTarget("")).toBeNull();
  });
});

describe("wikilinkDecorations", () => {
  it("shows a Citation Fragment as its Pandoc citation text", () => {
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

  it("shows a fragment-less link as its Citation Key Property value", () => {
    const [decoration] = wikilinkDecorations([span(WANG_LINK)], context());
    expect(decoration?.text).toBe("@wang2020");
  });

  it("falls back to the filename when the note carries no Citation Key Property", () => {
    const [decoration] = wikilinkDecorations(
      [span("literatures/xu2019")],
      context({
        literatureNote: () => ({
          path: "literatures/xuNoCitationKeyProperty2019.md",
          citationKey: null,
        }),
      }),
    );
    expect(decoration?.text).toBe("@xuNoCitationKeyProperty2019");
  });

  it("shows a fragment-carrying link whatever the display toggle says", () => {
    const decorations = wikilinkDecorations(
      [span(`${WANG_LINK}#cite:locator=7`)],
      context({ fragmentlessDisplay: false }),
    );
    expect(decorations).toHaveLength(1);
  });

  it("leaves a fragment-less link alone while the display toggle is off", () => {
    expect(
      wikilinkDecorations(
        [span(WANG_LINK)],
        context({ fragmentlessDisplay: false }),
      ),
    ).toEqual([]);
  });

  it("leaves a malformed Citation Fragment raw", () => {
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

  it("leaves a heading subpath alone", () => {
    expect(
      wikilinkDecorations([span(`${WANG_LINK}#Methods`)], context()),
    ).toEqual([]);
  });

  it("leaves a link that names no Literature Note alone", () => {
    expect(
      wikilinkDecorations([span("plain/note#cite:locator=7")], context()),
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
