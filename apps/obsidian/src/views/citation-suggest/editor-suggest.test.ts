import { describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import { lookupAnswer } from "@/services/citation-index/__fixtures__/lookup";
import type {
  CitationKeyResolution,
  CitekeyResolution,
} from "@/services/citation-index/service";
import type { SearchHit } from "@/services/item-lookup/service";
import { InertTemplateError } from "@/services/template/errors";

import {
  padCitationInsert,
  resolveCitationInsert,
  resolveCitationTrigger,
} from "./editor-suggest";
import type { CitationSuggestDeps } from "./register";

function makeHit(citationKey: string | null): SearchHit {
  return {
    item: { key: "ABC123", fields: { citationKey } },
    matches: [],
  } as unknown as SearchHit;
}

/** The two decisions an insert runs on: how a citation renders, and whether
 *  its Citation Key names one Zotero Item or several — the second only once
 *  the resolution snapshot has an answer at all. */
function insertDeps(
  renderCitation: unknown,
  resolved: CitekeyResolution = { kind: "unique", item: UNIQUE_ITEM },
  resolution: CitationKeyResolution = "fresh",
): Pick<CitationSuggestDeps, "noteFeature" | "citationLookup"> {
  return {
    noteFeature: {
      renderCitation,
    } as CitationSuggestDeps["noteFeature"],
    citationLookup: {
      read: async ({ citekeys }) => {
        if (resolution === "failed") throw new Error("Citation lookup failed");
        return lookupAnswer(
          Object.fromEntries((citekeys ?? []).map((key) => [key, resolved])),
        );
      },
      status: resolution ?? "pending",
    },
  };
}

const UNIQUE_ITEM = {
  itemID: 1,
  libraryID: 1,
  key: "ABC123",
  indexedKey: "ABC123",
};

describe("resolveCitationInsert", async () => {
  it("resolves to a not-ready notice when the template isn't loaded yet", async () => {
    // Regression for the C3 readiness gap: renderCitation returns null instead
    // of throwing when `template.loaded` is false, so the handler (which can't
    // await) must resolve to a notice rather than inserting an empty string
    // into the editor.
    const renderCitation = vi.fn().mockReturnValue(null);
    const hit = makeHit("abc2024");

    const outcome = await resolveCitationInsert(
      insertDeps(renderCitation),
      hit,
      "main",
    );

    expect(renderCitation).toHaveBeenCalledWith(
      [{ citationKey: "abc2024", item: hit.item }],
      "main",
    );
    expect(outcome).toEqual({
      kind: "notice",
      message: m.notice_template_not_ready(),
    });
  });

  it("resolves an inert-template error to a notice carrying its own message", async () => {
    const renderCitation = vi.fn(() => {
      throw new InertTemplateError("The citation text is inert");
    });

    const outcome = await resolveCitationInsert(
      insertDeps(renderCitation),
      makeHit("abc2024"),
      "main",
    );

    expect(outcome).toEqual({
      kind: "notice",
      message: "The citation text is inert",
    });
  });

  it("rethrows render errors that are not inert-template errors", async () => {
    const renderCitation = vi.fn(() => {
      throw new Error("boom");
    });

    await expect(
      resolveCitationInsert(
        insertDeps(renderCitation),
        makeHit("abc2024"),
        "main",
      ),
    ).rejects.toThrow("boom");
  });

  it("resolves to a no-citekey notice without rendering when the item has none", async () => {
    const renderCitation = vi.fn();

    const outcome = await resolveCitationInsert(
      insertDeps(renderCitation),
      makeHit(null),
      "main",
    );

    expect(renderCitation).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      kind: "notice",
      message: m.notice_no_citekey({ key: "ABC123" }),
    });
  });

  it("refuses a Citation Key that names several Zotero Items", async () => {
    const renderCitation = vi.fn();

    const outcome = await resolveCitationInsert(
      insertDeps(renderCitation, {
        kind: "ambiguous",
        candidates: [
          UNIQUE_ITEM,
          { itemID: 2, libraryID: 4, key: "ROE2025", indexedKey: "ROE2025g7" },
        ],
      }),
      makeHit("abc2024"),
      "main",
    );

    // The inserted text carries the key alone, so inserting it would lose the
    // Item the user picked here.
    expect(renderCitation).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      kind: "notice",
      message: m.notice_citekey_ambiguous_insert({ citekey: "abc2024" }),
    });
  });

  it("refuses an insert while the resolution snapshot has no answer yet", async () => {
    const renderCitation = vi.fn();

    // A snapshot still resolving answers every key as missing, so an ambiguous
    // key would slip through the refusal above and lose its Item identity.
    const outcome = await resolveCitationInsert(
      insertDeps(renderCitation, { kind: "missing" }, null),
      makeHit("abc2024"),
      "main",
    );

    expect(renderCitation).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      kind: "notice",
      message: m.notice_citekey_not_ready(),
    });
  });

  it("refuses insertion when a fresh lookup fails despite a held answer", async () => {
    const renderCitation = vi.fn().mockReturnValue("[@abc2024]");

    const outcome = await resolveCitationInsert(
      insertDeps(
        renderCitation,
        { kind: "unique", item: UNIQUE_ITEM },
        "failed",
      ),
      makeHit("abc2024"),
      "main",
    );

    expect(renderCitation).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      kind: "notice",
      message: m.notice_citekey_not_ready(),
    });
  });

  it("resolves to the rendered citation for insertion", async () => {
    const renderCitation = vi.fn().mockReturnValue("[@abc2024]");

    const outcome = await resolveCitationInsert(
      insertDeps(renderCitation),
      makeHit("abc2024"),
      "main",
    );

    expect(outcome).toEqual({ kind: "insert", text: "[@abc2024]" });
  });
});

describe("resolveCitationTrigger", () => {
  const knownKeys = new Set([
    "rougier2014",
    "smith:2024/a.b-c",
    "key,with,commas",
  ]);
  const isKnownCitekey = (key: string): boolean => knownKeys.has(key);

  it.each([
    "[@rougier2014,]",
    "[@rougier2014, p]",
    "[@rougier2014, p. 1]",
    "【@rougier2014, p】",
    "[@smith:2024/a.b-c, p]",
    "[@{key,with,commas}, p]",
  ])("keeps locator edits out of the suggester: %s", (line) => {
    for (const atTrigger of [false, true]) {
      expect(
        resolveCitationTrigger(line, line.length - 1, {
          atTrigger,
          isKnownCitekey,
        }),
      ).toBeNull();
    }
  });

  it.each([
    "Ten Simple Rules",
    "Methods, results",
    "rougier2014 figures",
    "smith:2024/a.b-c",
    "{key,with,commas}",
  ])("keeps title and citation-key queries searchable: %s", (query) => {
    const line = `[@${query}]`;
    expect(
      resolveCitationTrigger(line, line.length - 1, {
        atTrigger: false,
        isKnownCitekey,
      }),
    ).toEqual({ start: 0, end: line.length, query, variant: "main" });
  });

  it("matches the Bracket Trigger `[@`", () => {
    const line = "see [@foo";
    expect(
      resolveCitationTrigger(line, line.length, { atTrigger: false }),
    ).toEqual({
      start: 4,
      end: 9,
      query: "foo",
      variant: "main",
    });
  });

  it("matches the Bracket Trigger `【@`", () => {
    const line = "见【@foo";
    expect(
      resolveCitationTrigger(line, line.length, { atTrigger: false }),
    ).toEqual({
      start: 1,
      end: 6,
      query: "foo",
      variant: "main",
    });
  });

  it("prefers the Bracket Trigger over the At Trigger even when at-trigger is enabled", () => {
    const bracketLine = "see [@foo";
    const wideBracketLine = "见【@foo";
    expect(
      resolveCitationTrigger(bracketLine, bracketLine.length, {
        atTrigger: true,
      }),
    ).toEqual({ start: 4, end: 9, query: "foo", variant: "main" });
    expect(
      resolveCitationTrigger(wideBracketLine, wideBracketLine.length, {
        atTrigger: true,
      }),
    ).toEqual({ start: 1, end: 6, query: "foo", variant: "main" });
  });

  it("extends `end` to swallow an adjacent closing bracket for bracket matches", () => {
    // "[@foo]" with the cursor right before "]": bracket match consumes it.
    const line = "[@foo]";
    expect(resolveCitationTrigger(line, 5, { atTrigger: false })).toEqual({
      start: 0,
      end: 6,
      query: "foo",
      variant: "main",
    });
  });

  it("does not extend `end` when the adjacent char is a bracket but the trigger isn't", () => {
    // "(@foo]" — no Bracket Trigger match here ("(" isn't an opener for it),
    // and the At Trigger never swallows a following bracket.
    const line = "(@foo]";
    expect(resolveCitationTrigger(line, 5, { atTrigger: true })).toEqual({
      start: 1,
      end: 5,
      query: "foo",
      variant: "main",
    });
  });

  it("never extends `end` for an At Trigger match even next to `]`", () => {
    const line = "@foo]";
    expect(resolveCitationTrigger(line, 4, { atTrigger: true })).toEqual({
      start: 0,
      end: 4,
      query: "foo",
      variant: "main",
    });
  });

  it.each([
    ["line start", "@foo", 0],
    ["a preceding space", " @foo", 1],
    ["a preceding `(`", "(@foo", 1],
    ["a preceding `{`", "{@foo", 1],
    ["a preceding `（`", "（@foo", 1],
    ["a preceding `「`", "「@foo", 1],
    ['a preceding `"`', '"@foo', 1],
    ["a preceding `'`", "'@foo", 1],
  ])("fires the At Trigger at %s", (_label, line, start) => {
    expect(
      resolveCitationTrigger(line, line.length, { atTrigger: true }),
    ).toEqual({
      start,
      end: line.length,
      query: "foo",
      variant: "main",
    });
  });

  it("never fires mid-word", () => {
    const line = "user@example.com";
    expect(
      resolveCitationTrigger(line, line.length, { atTrigger: true }),
    ).toBeNull();
  });

  it("converts underscores to spaces in At Trigger queries only", () => {
    const atLine = "@machine_learning";
    expect(
      resolveCitationTrigger(atLine, atLine.length, { atTrigger: true }),
    ).toEqual({
      start: 0,
      end: atLine.length,
      query: "machine learning",
      variant: "main",
    });

    const bracketLine = "[@machine_learning";
    expect(
      resolveCitationTrigger(bracketLine, bracketLine.length, {
        atTrigger: true,
      }),
    ).toEqual({
      start: 0,
      end: bracketLine.length,
      query: "machine_learning",
      variant: "main",
    });
  });

  it("strips a trailing `/` and asks for the alt variant in the Bracket Trigger", () => {
    const line = "[@foo/";
    expect(
      resolveCitationTrigger(line, line.length, { atTrigger: false }),
    ).toEqual({
      start: 0,
      end: line.length,
      query: "foo",
      variant: "alt",
    });
  });

  it("strips a trailing `/` (before underscore conversion) and asks for the alt variant in the At Trigger", () => {
    const line = "@foo_bar/";
    expect(
      resolveCitationTrigger(line, line.length, { atTrigger: true }),
    ).toEqual({
      start: 0,
      end: line.length,
      query: "foo bar",
      variant: "alt",
    });
  });

  it("fires on a bare `@` with an empty query", () => {
    const line = "@";
    expect(resolveCitationTrigger(line, 1, { atTrigger: true })).toEqual({
      start: 0,
      end: 1,
      query: "",
      variant: "main",
    });
  });

  it("never fires on the full-width `＠`", () => {
    const line = "＠foo";
    expect(
      resolveCitationTrigger(line, line.length, { atTrigger: true }),
    ).toBeNull();
  });

  it("does not fire the At Trigger when at-trigger is disabled, but the Bracket Trigger is unaffected", () => {
    expect(resolveCitationTrigger("@foo", 4, { atTrigger: false })).toBeNull();
    expect(resolveCitationTrigger(" @foo", 5, { atTrigger: false })).toBeNull();

    const bracketLine = "[@foo]";
    expect(
      resolveCitationTrigger(bracketLine, 5, { atTrigger: false }),
    ).toEqual({
      start: 0,
      end: 6,
      query: "foo",
      variant: "main",
    });
  });

  it("ends the At Trigger query at the first space, so trailing content after it never fires", () => {
    const line = "@foo bar";
    expect(
      resolveCitationTrigger(line, line.length, { atTrigger: true }),
    ).toBeNull();
  });
});

describe("padCitationInsert", () => {
  it("ends a bracketed citation at its closing bracket, with the cursor after it", () => {
    for (const next of ["", ".", " "]) {
      expect(padCitationInsert("[@smith2024]", next)).toEqual({
        text: "[@smith2024]",
        cursor: 12,
      });
    }
  });

  it("keeps an unpadded bracketed citation from re-matching either trigger", () => {
    const line = "see [@smith2024]";
    expect(
      resolveCitationTrigger(line, line.length, { atTrigger: true }),
    ).toBeNull();
  });

  it("appends the space before a non-space character", () => {
    expect(padCitationInsert("@smith2024", ".")).toEqual({
      text: "@smith2024 ",
      cursor: 11,
    });
  });

  it("reuses a space already at the insert position, moving the cursor past it", () => {
    expect(padCitationInsert("@smith2024", " ")).toEqual({
      text: "@smith2024",
      cursor: 11,
    });
  });

  it("keeps the padded alternate format from re-matching the At Trigger", () => {
    const padded = padCitationInsert("@smith2024", "");
    const line = `see ${padded.text}`;
    expect(
      resolveCitationTrigger(line, 4 + padded.cursor, { atTrigger: true }),
    ).toBeNull();
  });
});
