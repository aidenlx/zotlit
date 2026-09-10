// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import { SAMPLE_ANNOTATIONS } from "@zotlit/workbench/render";
import { annotationSamples } from "@zotlit/workbench/ui";

import {
  getSampleItem,
  SAMPLE_ITEM_CHOICES,
} from "@/views/template-workbench/selection-data";

import {
  createRenderFixture,
  PROFILE_SOURCE,
  SAVED_NOTE,
} from "./__fixtures__/render";
import { presentCitations } from "./markdown";
import {
  renderNativeProfile,
  previewBaseline,
  renderRegisteredPartial,
} from "./render";

/** Where the counting template records how often its body has rendered. */
const BODY_RENDERS = "__zotlitPreviewBodyRenders";

describe("native Profile rendering", () => {
  it.each(SAMPLE_ITEM_CHOICES)(
    "renders $id with installed templates and no database",
    async ({ id, title }) => {
      await using fixture = await createRenderFixture();
      const acquire = vi
        .spyOn(fixture.deps.db, "acquireRead")
        .mockRejectedValue(new Error("Database offline"));
      const lookup = vi.spyOn(fixture.deps.noteIndex, "getNotesByItemKey");
      const snapshot = getSampleItem(id)!;
      const result = await renderNativeProfile(fixture.deps, {
        source: PROFILE_SOURCE.replace(
          "Personal space.",
          "See [@figures2014].",
        ),
        snapshot,
        annotation: annotationSamples(snapshot, null).example,
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.filename).toBe(title);
      expect(result.creationBody).toContain(`# ${title}`);
      expect(result.creationBody).toContain("See [@figures2014].");
      expect(result.properties[0]?.value).toBe(title);
      expect(result.annotation).toBeTruthy();
      expect(result.sourcePath).toBe("");
      expect(acquire).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
      expect(fixture.renderCitations).not.toHaveBeenCalled();
    },
  );

  it("keeps a colliding sample key separate from an existing Literature Note in update mode", async () => {
    await using fixture = await createRenderFixture({ existing: SAVED_NOTE });
    const sample = getSampleItem("sample:conference-paper")!;
    const acquire = vi
      .spyOn(fixture.deps.db, "acquireRead")
      .mockRejectedValue(new Error("Database offline"));
    const lookup = vi.spyOn(fixture.deps.noteIndex, "getNotesByItemKey");
    const result = await renderNativeProfile(fixture.deps, {
      source: PROFILE_SOURCE,
      snapshot: { ...sample, item: { ...sample.item, indexedKey: "MAIN2345" } },
      mode: "update",
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.sourcePath).toBe("");
    expect(result.creationBody).toContain(
      "# Designing reproducible research interfaces",
    );
    expect(result.creationBody).toContain("Personal space.");
    expect(result.creationBody).not.toContain("Personal introduction.");
    expect(parse(result.frontmatterBlock!)).not.toHaveProperty("private");
    expect(acquire).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(fixture.vault.contents.get("notes/paper.md")).toBe(SAVED_NOTE);
  });

  it("restores sample helpers, dates, and coercions for installed Eta and JavaScript", async () => {
    const source = `---
id: sample-eta
name: Sample Eta
version: 1.0.0
contract: 5
language: eta
filename: '<%= zt.title %>'
frontmatter:
  - key: author
    merge: replace
    js: String(zt.creators[0])
---
<%= zt.dateAdded.toZonedDateTimeISO('UTC').year %>|<%= zt.creators.join(', ') %>|<%= zt.noteLink() === null %>
--- zotlit:annotation ---
<%= String(zt.parentItem) %>|<%= zt.fileLink() === null %>`;
    const snapshot = getSampleItem("sample:conference-paper")!;
    await using gated = await createRenderFixture();
    const disabled = await renderNativeProfile(gated.deps, {
      source,
      snapshot,
    });
    expect(disabled.creationBody).toBeNull();
    expect(disabled.diagnostics[0]?.message).toContain("JavaScript templates");
    await using fixture = await createRenderFixture({ javascript: true });
    const acquire = vi
      .spyOn(fixture.deps.db, "acquireRead")
      .mockRejectedValue(new Error("Database offline"));
    const result = await renderNativeProfile(fixture.deps, {
      source,
      snapshot,
      annotation: annotationSamples(snapshot, null).example,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.creationBody?.trim()).toBe("2025|Mara Rivera, Tao Chen|true");
    expect(result.properties[0]?.value).toBe("Mara Rivera");
    expect(result.annotation?.trim()).toBe(
      "Designing reproducible research interfaces|true",
    );
    expect(acquire).not.toHaveBeenCalled();
  });

  it.each(SAMPLE_ANNOTATIONS)(
    "renders $id against its own parent when the note Item differs",
    async (annotation) => {
      await using fixture = await createRenderFixture();
      const result = await renderNativeProfile(fixture.deps, {
        source: PROFILE_SOURCE.replace(
          "> {{ zt.text }}",
          "> {{ zt.parentItem.title }}: {{ zt.type }}",
        ),
        snapshot: fixture.snapshot,
        annotation,
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.creationBody).toContain("# Better figures");
      expect(result.annotation).toBe(
        `> [!quote]\n> Designing reproducible research interfaces: ${String(annotation.root.type)}\n`,
      );
      expect(result.annotationCitation).toContain(
        "riveraResearchInterfaces2026",
      );
    },
  );

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

  it("shows update mode the body the preparation rendered, without a second render", async () => {
    // A JavaScript template may carry state between renders, so a body rendered
    // a second time can differ from the one the preparation already produced.
    await using fixture = await createRenderFixture({ javascript: true });
    const counting = `---
id: counting-paper
name: Counting paper
version: 1.0.0
contract: 5
language: eta
filename: '<%= zt.title %>'
frontmatter: []
---
Body render <%= (globalThis.${BODY_RENDERS} = (globalThis.${BODY_RENDERS} ?? 0) + 1) %>
--- zotlit:annotation ---
<%= zt.text %>`;
    try {
      const result = await renderNativeProfile(fixture.deps, {
        source: counting,
        snapshot: fixture.snapshot,
        mode: "update",
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.creationBody?.trim()).toBe("Body render 1");
    } finally {
      delete (globalThis as Record<string, unknown>)[BODY_RENDERS];
    }
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

describe("renderRegisteredPartial", () => {
  it("reads the caller's own annotation data under the Annotation context, unlike the Note context", async () => {
    await using fixture = await createRenderFixture({
      partials: { "venue-line": "Page {{ zt.pageLabel }}" },
    });
    const { example } = annotationSamples(fixture.snapshot, null);
    const request = {
      source: PROFILE_SOURCE,
      snapshot: fixture.snapshot,
      annotation: example,
    };

    const underAnnotation = await renderRegisteredPartial(
      fixture.deps,
      request,
      { name: "venue-line", context: "annotation", profile: null },
    );
    const underNote = await renderRegisteredPartial(fixture.deps, request, {
      name: "venue-line",
      context: "note",
      profile: null,
    });

    // The fixture's annotation carries pageLabel "2" (see the fixture's
    // itemAnnotations row); the note root has no such field.
    expect(underAnnotation).toBe("Page 2");
    expect(underNote).not.toBe(underAnnotation);
  });
});
