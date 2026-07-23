import { describe, expect, it, vi } from "vitest";

import * as m from "@/paraglide/messages";
import { type SearchHit } from "@/services/item-lookup/service";
import { InertTemplateError } from "@/services/template/errors";

import { resolveCitationInsert } from "./editor-suggest";

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
