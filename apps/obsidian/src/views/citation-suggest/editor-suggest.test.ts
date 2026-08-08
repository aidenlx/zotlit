import { describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { SearchHit } from "@/services/item-lookup/service";
import { InertTemplateError } from "@/services/template/errors";

import {
  padCitationInsert,
  resolveCitationInsert,
  resolveCitationTrigger,
} from "./editor-suggest";

function makeHit(citationKey: string | null): SearchHit {
  return {
    item: { key: "ABC123", fields: { citationKey } },
    score: 0,
    matches: [],
  } as unknown as SearchHit;
}

describe("resolveCitationInsert", () => {
  it("resolves to a not-ready notice when the template isn't loaded yet", () => {
    // Regression for the C3 readiness gap: renderCitation returns null instead
    // of throwing when `template.loaded` is false, so the handler (which can't
    // await) must resolve to a notice rather than inserting an empty string
    // into the editor.
    const renderCitation = vi.fn().mockReturnValue(null);
    const hit = makeHit("abc2024");

    const outcome = resolveCitationInsert({ renderCitation }, hit, false);

    expect(renderCitation).toHaveBeenCalledWith(
      [{ citationKey: "abc2024", item: hit.item }],
      false,
    );
    expect(outcome).toEqual({
      kind: "notice",
      message: m.notice_template_not_ready(),
    });
  });

  it("resolves an inert-template error to a notice carrying its own message", () => {
    const renderCitation = vi.fn(() => {
      throw new InertTemplateError("cite template is inert");
    });

    const outcome = resolveCitationInsert(
      { renderCitation },
      makeHit("abc2024"),
      false,
    );

    expect(outcome).toEqual({
      kind: "notice",
      message: "cite template is inert",
    });
  });

  it("rethrows render errors that are not inert-template errors", () => {
    const renderCitation = vi.fn(() => {
      throw new Error("boom");
    });

    expect(() =>
      resolveCitationInsert({ renderCitation }, makeHit("abc2024"), false),
    ).toThrow("boom");
  });

  it("resolves to a no-citekey notice without rendering when the item has none", () => {
    const renderCitation = vi.fn();

    const outcome = resolveCitationInsert(
      { renderCitation },
      makeHit(null),
      false,
    );

    expect(renderCitation).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      kind: "notice",
      message: m.notice_no_citekey({ key: "ABC123" }),
    });
  });

  it("resolves to the rendered citation for insertion", () => {
    const renderCitation = vi.fn().mockReturnValue("[@abc2024]");

    const outcome = resolveCitationInsert(
      { renderCitation },
      makeHit("abc2024"),
      false,
    );

    expect(outcome).toEqual({ kind: "insert", text: "[@abc2024]" });
  });
});

describe("resolveCitationTrigger", () => {
  it("matches the Bracket Trigger `[@`", () => {
    const line = "see [@foo";
    expect(resolveCitationTrigger(line, line.length, false)).toEqual({
      start: 4,
      end: 9,
      query: "foo",
      secondary: false,
    });
  });

  it("matches the Bracket Trigger `【@`", () => {
    const line = "见【@foo";
    expect(resolveCitationTrigger(line, line.length, false)).toEqual({
      start: 1,
      end: 6,
      query: "foo",
      secondary: false,
    });
  });

  it("prefers the Bracket Trigger over the At Trigger even when at-trigger is enabled", () => {
    const bracketLine = "see [@foo";
    const wideBracketLine = "见【@foo";
    expect(
      resolveCitationTrigger(bracketLine, bracketLine.length, true),
    ).toEqual({ start: 4, end: 9, query: "foo", secondary: false });
    expect(
      resolveCitationTrigger(wideBracketLine, wideBracketLine.length, true),
    ).toEqual({ start: 1, end: 6, query: "foo", secondary: false });
  });

  it("extends `end` to swallow an adjacent closing bracket for bracket matches", () => {
    // "[@foo]" with the cursor right before "]": bracket match consumes it.
    const line = "[@foo]";
    expect(resolveCitationTrigger(line, 5, false)).toEqual({
      start: 0,
      end: 6,
      query: "foo",
      secondary: false,
    });
  });

  it("does not extend `end` when the adjacent char is a bracket but the trigger isn't", () => {
    // "(@foo]" — no Bracket Trigger match here ("(" isn't an opener for it),
    // and the At Trigger never swallows a following bracket.
    const line = "(@foo]";
    expect(resolveCitationTrigger(line, 5, true)).toEqual({
      start: 1,
      end: 5,
      query: "foo",
      secondary: false,
    });
  });

  it("never extends `end` for an At Trigger match even next to `]`", () => {
    const line = "@foo]";
    expect(resolveCitationTrigger(line, 4, true)).toEqual({
      start: 0,
      end: 4,
      query: "foo",
      secondary: false,
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
    expect(resolveCitationTrigger(line, line.length, true)).toEqual({
      start,
      end: line.length,
      query: "foo",
      secondary: false,
    });
  });

  it("never fires mid-word", () => {
    const line = "user@example.com";
    expect(resolveCitationTrigger(line, line.length, true)).toBeNull();
  });

  it("converts underscores to spaces in At Trigger queries only", () => {
    const atLine = "@machine_learning";
    expect(resolveCitationTrigger(atLine, atLine.length, true)).toEqual({
      start: 0,
      end: atLine.length,
      query: "machine learning",
      secondary: false,
    });

    const bracketLine = "[@machine_learning";
    expect(
      resolveCitationTrigger(bracketLine, bracketLine.length, true),
    ).toEqual({
      start: 0,
      end: bracketLine.length,
      query: "machine_learning",
      secondary: false,
    });
  });

  it("strips a trailing `/` and marks `secondary` for the Bracket Trigger", () => {
    const line = "[@foo/";
    expect(resolveCitationTrigger(line, line.length, false)).toEqual({
      start: 0,
      end: line.length,
      query: "foo",
      secondary: true,
    });
  });

  it("strips a trailing `/` (before underscore conversion) and marks `secondary` for the At Trigger", () => {
    const line = "@foo_bar/";
    expect(resolveCitationTrigger(line, line.length, true)).toEqual({
      start: 0,
      end: line.length,
      query: "foo bar",
      secondary: true,
    });
  });

  it("fires on a bare `@` with an empty query", () => {
    const line = "@";
    expect(resolveCitationTrigger(line, 1, true)).toEqual({
      start: 0,
      end: 1,
      query: "",
      secondary: false,
    });
  });

  it("never fires on the full-width `＠`", () => {
    const line = "＠foo";
    expect(resolveCitationTrigger(line, line.length, true)).toBeNull();
  });

  it("does not fire the At Trigger when at-trigger is disabled, but the Bracket Trigger is unaffected", () => {
    expect(resolveCitationTrigger("@foo", 4, false)).toBeNull();
    expect(resolveCitationTrigger(" @foo", 5, false)).toBeNull();

    const bracketLine = "[@foo]";
    expect(resolveCitationTrigger(bracketLine, 5, false)).toEqual({
      start: 0,
      end: 6,
      query: "foo",
      secondary: false,
    });
  });

  it("ends the At Trigger query at the first space, so trailing content after it never fires", () => {
    const line = "@foo bar";
    expect(resolveCitationTrigger(line, line.length, true)).toBeNull();
  });
});

describe("padCitationInsert", () => {
  it("appends a single trailing space with the cursor after it", () => {
    expect(padCitationInsert("[@smith2024]", "")).toEqual({
      text: "[@smith2024] ",
      cursor: 13,
    });
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
    expect(resolveCitationTrigger(line, 4 + padded.cursor, true)).toBeNull();
  });
});
