// @vitest-environment happy-dom
import type { FrontMatterInfo } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";

import { SAMPLE_ANNOTATIONS } from "@zotlit/workbench/render";
import { annotationSamples } from "@zotlit/workbench/ui";

import {
  createRenderFixture,
  PROFILE_SOURCE,
  SAVED_NOTE,
} from "./__fixtures__/render";
import { presentCitations } from "./markdown";
import { renderNativeProfile, previewBaseline } from "./render";

vi.mock("obsidian", async (original) => ({
  ...(await original<typeof import("obsidian")>()),
  parseYaml: parse,
  stringifyYaml: stringify,
  getFrontMatterInfo: (source: string): FrontMatterInfo => {
    const end = source.startsWith("---\n") ? source.indexOf("\n---\n", 4) : -1;
    return end < 0
      ? { exists: false, frontmatter: "", from: 0, to: 0, contentStart: 0 }
      : {
          exists: true,
          frontmatter: source.slice(4, end),
          from: 4,
          to: end,
          contentStart: end + 5,
        };
  },
}));

describe("native Profile rendering", () => {
  it("renders real TemplateService data with inert links and preserves the source files", async () => {
    await using fixture = await createRenderFixture();
    const { example } = annotationSamples(fixture.snapshot, null);
    const result = await renderNativeProfile(fixture.deps, {
      source: PROFILE_SOURCE,
      snapshot: fixture.snapshot,
      mode: "create",
      annotation: example,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.filename).toBe("Better figures");
    expect(result.creationBody).toContain("# Better figures");
    expect(result.managedRegion).toContain("Managed Better figures.");
    expect(result.annotation).toBe("> [!quote]\n> Use readable figures.\n");
    expect(result.annotationRanges).toHaveLength(1);
    expect(
      result.creationBody!.slice(
        result.annotationRanges[0]!.from,
        result.annotationRanges[0]!.to,
      ),
    ).toBe(result.annotation);
    expect(result.properties).toEqual([
      { key: "title", value: "Better figures", position: 1, missing: false },
      { key: "tags", value: ["review"], position: 2, missing: false },
    ]);
    expect(parse(result.frontmatterBlock!)).toEqual({
      title: "Better figures",
      tags: ["review"],
      "zotero-key": "MAIN2345",
      "zotlit-profile": "Paper (paper)",
      "zotlit-csl": "numeric",
    });
    for (const write of Object.values(fixture.writes))
      expect(write).not.toHaveBeenCalled();
    expect([...fixture.vault.contents]).toEqual([]);
  });

  it("updates the real note's managed body and properties without changing personal content", async () => {
    await using fixture = await createRenderFixture({ existing: SAVED_NOTE });
    const result = await renderNativeProfile(fixture.deps, {
      source: PROFILE_SOURCE,
      snapshot: fixture.snapshot,
      mode: "update",
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.creationBody).toBe(
      "Personal introduction.\n\n%%zt-managed%%\nManaged Better figures.\n> [!quote]\n> Use readable figures.\n%%/zt-managed%%\n\nPersonal conclusion.\n",
    );
    expect(parse(result.frontmatterBlock!)).toEqual({
      title: "Better figures",
      private: "Keep this",
      number: 7,
      tags: ["mine", "review"],
      "zotero-key": "MAIN2345",
      "zotlit-profile": "Paper (paper)",
      "zotlit-csl": "numeric",
    });
    expect(fixture.vault.contents.get("notes/paper.md")).toBe(SAVED_NOTE);
    for (const write of Object.values(fixture.writes))
      expect(write).not.toHaveBeenCalled();
  });

  it("uses the synthesized form when no Literature Note exists and keeps a real note with no region", async () => {
    await using fixture = await createRenderFixture();
    const result = await renderNativeProfile(fixture.deps, {
      source: PROFILE_SOURCE,
      snapshot: fixture.snapshot,
      mode: "update",
    });
    expect(result.creationBody).toContain("# Better figures");
    expect(result.creationBody).toContain("Personal space.");
    expect(
      previewBaseline("Personal note.\n", "A new note.", "Replacement").body,
    ).toBe("Personal note.\n");
  });

  it("runs Eta and JavaScript only when the installed TemplateService gate allows them", async () => {
    await using fixture = await createRenderFixture();
    const eta = `---
id: eta-paper
name: Eta paper
version: 1.0.0
contract: 5
language: eta
filename: '<%= zt.title %>'
frontmatter: []
---
<%= zt.title %>
--- zotlit:annotation ---
<%= zt.text %>`;
    const gated = await renderNativeProfile(fixture.deps, {
      source: eta,
      snapshot: fixture.snapshot,
    });
    expect(gated.creationBody).toBeNull();
    expect(gated.diagnostics[0]?.message).toContain("JavaScript templates");
    await using enabled = await createRenderFixture({ javascript: true });
    const rendered = await renderNativeProfile(enabled.deps, {
      source: eta,
      snapshot: enabled.snapshot,
    });
    expect(rendered.creationBody?.trim()).toBe("Better figures");
    expect(rendered.filename).toBe("Better figures");
    expect(rendered.diagnostics).toEqual([]);
  });

  it("reports a JavaScript property at its authored row and runs it after consent", async () => {
    await using fixture = await createRenderFixture();
    const source = PROFILE_SOURCE.replace(
      "expr: zt.title",
      'js: zt.title + "!"',
    );
    const gated = await renderNativeProfile(fixture.deps, {
      source,
      snapshot: fixture.snapshot,
    });
    expect(gated.diagnostics).toContainEqual(
      expect.objectContaining({
        part: "properties",
        position: 1,
        message: expect.stringContaining("Enable JavaScript templates"),
      }),
    );
    await using enabled = await createRenderFixture({ javascript: true });
    const rendered = await renderNativeProfile(enabled.deps, {
      source,
      snapshot: enabled.snapshot,
    });
    expect(rendered.properties[0]?.value).toBe("Better figures!");
    expect(rendered.diagnostics).toEqual([]);
  });

  it("keeps selected built-in examples separate from the real annotation", async () => {
    await using fixture = await createRenderFixture();
    const example = SAMPLE_ANNOTATIONS[0]!;
    const result = await renderNativeProfile(fixture.deps, {
      source: PROFILE_SOURCE,
      snapshot: fixture.snapshot,
      annotation: example,
    });
    expect(result.annotation).toContain(
      "Clear methods make research easier to reproduce.",
    );
    expect(result.annotation).not.toContain("Use readable figures.");
    expect(result.annotationId).toBe(example.id);
  });

  it("shows formatted citation text from an unsaved style change, not only its property", async () => {
    await using fixture = await createRenderFixture({ existing: SAVED_NOTE });
    const source = PROFILE_SOURCE.replace(
      "Personal space.",
      "See [@figures2014].",
    );
    const numeric = await renderNativeProfile(fixture.deps, {
      source,
      snapshot: fixture.snapshot,
    });
    const author = await renderNativeProfile(fixture.deps, {
      source: source.replace(
        "citationStyle: numeric",
        "citationStyle: author-date",
      ),
      snapshot: fixture.snapshot,
    });
    expect(numeric.diagnostics).toEqual([]);
    expect(author.diagnostics).toEqual([]);
    const element = document.createElement("div");
    element.textContent = "See [@figures2014].";
    presentCitations(element, numeric.citations);
    expect(element.textContent).toBe("See [1].");
    element.textContent = "See [@figures2014].";
    presentCitations(element, author.citations);
    expect(element.textContent).toBe("See (Rougier 2014).");
    expect(fixture.renderCitations).toHaveBeenLastCalledWith(
      ["[@MAIN2345]"],
      [expect.objectContaining({ id: "MAIN2345", title: "Better figures" })],
      { styleId: "author-date", locale: null },
    );
    expect(fixture.vault.contents.get("notes/paper.md")).toBe(SAVED_NOTE);
  });

  it("renders an inherited style while keeping the note's style stamp sparse", async () => {
    await using fixture = await createRenderFixture({
      defaultStyle: "author-date",
    });
    const source = PROFILE_SOURCE.replace(
      "citationStyle: numeric\n",
      "",
    ).replace("Personal space.", "See [@figures2014].");
    const result = await renderNativeProfile(fixture.deps, {
      source,
      snapshot: fixture.snapshot,
    });
    expect(result.diagnostics).toEqual([]);
    expect(parse(result.frontmatterBlock!)).not.toHaveProperty("zotlit-csl");
    expect(fixture.renderCitations).toHaveBeenCalledWith(
      ["[@MAIN2345]"],
      expect.any(Array),
      { styleId: "author-date", locale: null },
    );
  });

  it("uses the real note's document language and stops CSL for an invalid language", async () => {
    const source = PROFILE_SOURCE.replace(
      "Managed {{ zt.title }}.",
      "See [@figures2014].",
    );
    await using fixture = await createRenderFixture({
      existing: SAVED_NOTE.replace(
        "title: Old title",
        "title: Old title\nlang: de-DE",
      ),
    });
    const result = await renderNativeProfile(fixture.deps, {
      source,
      snapshot: fixture.snapshot,
      mode: "update",
    });
    expect(result.diagnostics).toEqual([]);
    expect(fixture.renderCitations).toHaveBeenCalledWith(
      ["[@MAIN2345]"],
      expect.any(Array),
      { styleId: "numeric", locale: "de-DE" },
    );
    await using invalid = await createRenderFixture({
      existing: SAVED_NOTE.replace(
        "title: Old title",
        "title: Old title\nlang: 7",
      ),
    });
    const failed = await renderNativeProfile(invalid.deps, {
      source,
      snapshot: invalid.snapshot,
      mode: "update",
    });
    expect(failed.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "citation-style-error",
        message: "This note's document language is invalid",
      }),
    );
    expect(invalid.renderCitations).not.toHaveBeenCalled();
  });

  it("formats native Literature Note links through the same draft presentation and retains their target", async () => {
    await using fixture = await createRenderFixture({
      existing: SAVED_NOTE,
      wikilinks: true,
    });
    const result = await renderNativeProfile(fixture.deps, {
      source: PROFILE_SOURCE.replace("Personal space.", "[[notes/paper.md]]"),
      snapshot: fixture.snapshot,
    });
    expect(result.diagnostics).toEqual([]);
    const element = document.createElement("div");
    element.innerHTML =
      '<a class="internal-link" data-href="notes/paper.md" href="notes/paper.md">notes/paper.md</a>';
    presentCitations(element, result.citations);
    expect(element.textContent).toBe("[1]");
    expect(element.querySelector("a")?.getAttribute("href")).toBe(
      "notes/paper.md",
    );
  });

  it("ignores citations in code and comments, and reports an unavailable citation processor", async () => {
    await using fixture = await createRenderFixture();
    const source = PROFILE_SOURCE.replace(
      "Personal space.",
      "`[@figures2014]`\n\n%% [@figures2014] %%",
    );
    await renderNativeProfile(fixture.deps, {
      source,
      snapshot: fixture.snapshot,
    });
    expect(fixture.renderCitations).not.toHaveBeenCalled();
    fixture.renderCitations.mockResolvedValue({
      kind: "unavailable",
      reason: "engine-absent",
    });
    const failed = await renderNativeProfile(fixture.deps, {
      source: `${source}\n[@figures2014]`,
      snapshot: fixture.snapshot,
      annotation: annotationSamples(fixture.snapshot, null).example,
    });
    expect(failed.diagnostics).toContainEqual(
      expect.objectContaining({ code: "citation-style-error" }),
    );
  });
});
