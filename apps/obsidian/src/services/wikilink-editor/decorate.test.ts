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

/**
 * The scanned links of one line, laid out as the document writes them: each
 * `[[…]]` follows the last with `separator` between them.
 */
function line(
  linktexts: readonly string[],
  separator = "; ",
): {
  spans: WikilinkSpan[];
  textBetween: (from: number, to: number) => string;
} {
  const spans: WikilinkSpan[] = [];
  let text = "";
  for (const linktext of linktexts) {
    if (text !== "") text += separator;
    const outerFrom = text.length;
    text += `[[${linktext}]]`;
    spans.push(
      span(linktext, {
        inner: { from: outerFrom + 2, to: text.length - 2 },
        outer: { from: outerFrom, to: text.length },
        group: { from: outerFrom, to: text.length },
      }),
    );
  }
  return { spans, textBetween: (from, to) => text.slice(from, to) };
}

const WANG: LiteratureNoteTarget = {
  path: "literatures/wangMutationalClinicalSpectrum2020a.md",
  indexedKey: "1/WANG2020A",
  citationKey: "wang2020",
};

function context(
  overrides: Partial<WikilinkDisplayContext> = {},
): WikilinkDisplayContext {
  return {
    literatureNote: (linkpath) =>
      linkpath.startsWith("literatures/wang") ? WANG : null,
    enabled: true,
    fragmentlessDisplay: true,
    selection: [],
    textBetween: () => "",
    ...overrides,
  };
}

const WANG_LINK = "literatures/wangMutationalClinicalSpectrum2020a";

describe("wikilinkDecorations", () => {
  it("replaces the link's interior with its Citation", () => {
    expect(
      wikilinkDecorations([span(`${WANG_LINK}#cite:locator=7`)], context()),
    ).toEqual([
      {
        from: 2,
        to: 2 + `${WANG_LINK}#cite:locator=7`.length,
        citation: {
          source: "[@wang2020, p. 7]",
          keys: [{ citekey: "wang2020", start: 1, end: 10 }],
        },
        fallback: "[@wang2020, p. 7]",
        tokenClasses: ["hmd-internal-link"],
      },
    ]);
  });

  it("keeps a fragment-less link reading as the bare citekey until a render lands", () => {
    expect(wikilinkDecorations([span(WANG_LINK)], context())).toMatchObject([
      { citation: { source: "[@wang2020]" }, fallback: "@wang2020" },
    ]);
  });

  it("leaves a link with no Citation Display Text alone", () => {
    expect(
      wikilinkDecorations([span(`${WANG_LINK}#cite:page=7`)], context()),
    ).toEqual([]);
  });

  it("leaves a valid Citation Fragment native while Wikilink Citations is off", () => {
    expect(
      wikilinkDecorations(
        [span(`${WANG_LINK}#cite:locator=7`)],
        context({ enabled: false }),
      ),
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

describe("wikilinkDecorations over a Citation Run", () => {
  it("replaces a semicolon-joined run with one grouped Citation", () => {
    const { spans, textBetween } = line([
      `${WANG_LINK}#cite:locator=7`,
      WANG_LINK,
    ]);

    expect(wikilinkDecorations(spans, context({ textBetween }))).toMatchObject([
      {
        from: spans[0]!.inner.from,
        to: spans[1]!.inner.to,
        citation: { source: "[@wang2020, p. 7; @wang2020]" },
        fallback: "[@wang2020, p. 7; @wang2020]",
      },
    ]);
  });

  it("joins a run written with no space around the separator", () => {
    const { spans, textBetween } = line([WANG_LINK, WANG_LINK], ";");

    expect(wikilinkDecorations(spans, context({ textBetween }))).toHaveLength(
      1,
    );
  });

  it("keeps two Citations apart when anything but a semicolon separates them", () => {
    for (const separator of [", ", " and ", ";\n"]) {
      const { spans, textBetween } = line([WANG_LINK, WANG_LINK], separator);

      expect(wikilinkDecorations(spans, context({ textBetween }))).toHaveLength(
        2,
      );
    }
  });

  it("ends a run at a link that writes no Citation", () => {
    const { spans, textBetween } = line([WANG_LINK, "plain/note", WANG_LINK]);

    expect(wikilinkDecorations(spans, context({ textBetween }))).toHaveLength(
      2,
    );
  });

  it("reverts the whole run when the selection touches any of its links", () => {
    const { spans, textBetween } = line([WANG_LINK, WANG_LINK]);
    const at = spans[1]!.group.to;

    expect(
      wikilinkDecorations(
        spans,
        context({ textBetween, selection: [{ from: at, to: at }] }),
      ),
    ).toEqual([]);
  });
});
