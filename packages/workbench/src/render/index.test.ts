import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import { CONTRACT_VERSION } from "@zotlit/db";
import annotationSchema from "@zotlit/db/contract/annotation.schema.json";
import filenameSchema from "@zotlit/db/contract/filename.schema.json";
import noteSchema from "@zotlit/db/contract/note.schema.json";

import {
  DEFAULT_PROFILE_SOURCE,
  renderProfile,
  restoreTemplateData,
  SAMPLE_ITEMS,
} from "./index";

describe("Sample Items", () => {
  it("ships four current-contract item types", () => {
    expect(
      SAMPLE_ITEMS.map((sample) => [
        sample.provenance.kind === "sample" ? sample.provenance.id : null,
        sample.item.itemType,
        sample.contractVersion,
        sample.provenance.kind === "sample" ? sample.provenance.source : null,
      ]),
    ).toEqual([
      ["journal-article", "journalArticle", CONTRACT_VERSION, "fixture-vault"],
      [
        "conference-paper",
        "conferencePaper",
        CONTRACT_VERSION,
        "fixture-vault",
      ],
      ["book", "book", CONTRACT_VERSION, "maintainer-library"],
      ["thesis", "thesis", CONTRACT_VERSION, "migrated-library"],
    ]);
  });

  it("validates every root against the current contract artifacts", () => {
    const ajv = new Ajv2020({ strict: true });
    const note = ajv.compile(noteSchema);
    const filename = ajv.compile(filenameSchema);
    const annotation = ajv.compile(annotationSchema);

    for (const sample of SAMPLE_ITEMS) {
      expect(note(sample.roots.note)).toBe(true);
      expect(filename(sample.roots.filename)).toBe(true);
      for (const root of sample.roots.annotations) {
        expect(annotation(root)).toBe(true);
      }
    }
  });

  it("renders the default Profile over every Sample Item without diagnostics", () => {
    for (const sample of SAMPLE_ITEMS) {
      const result = renderProfile(DEFAULT_PROFILE_SOURCE, sample);

      expect(result.diagnostics).toEqual([]);
      expect(result.filename).toBeTruthy();
      expect(result.creationBody).toContain(sample.item.title);
    }
  });

  it("returns the complete result set for an edited Profile over every Sample Item", () => {
    const edited = DEFAULT_PROFILE_SOURCE.replace(
      "# {{ zt.title }}",
      "# Edited: {{ zt.title }}",
    );

    for (const sample of SAMPLE_ITEMS) {
      const result = renderProfile(edited, sample);

      expect(result.diagnostics).toEqual([]);
      expect(result.filename).toBeTruthy();
      expect(result.properties).toHaveLength(4);
      expect(result.creationBody).toContain(`# Edited: ${sample.item.title}`);
      expect(result.managedRegion).not.toBeNull();
      const annotationText = sample.roots.annotations[0]?.text;
      expect(result.annotation === null).toBe(annotationText === undefined);
      expect(result.annotation ?? "").toContain(
        typeof annotationText === "string" ? annotationText : "",
      );
      expect(result.sourceRevision).toHaveLength(8);
      expect(result.snapshotRevision).toBe(sample.revision);
    }
  });

  it("rejects a stale Sample Item after a contract bump", () => {
    const stale = {
      ...SAMPLE_ITEMS[0]!,
      contractVersion: CONTRACT_VERSION + 1,
    };

    expect(renderProfile(DEFAULT_PROFILE_SOURCE, stale)).toMatchObject({
      filename: null,
      creationBody: null,
      diagnostics: [{ code: "contract-version-mismatch" }],
    });
  });

  it("renders a required partial supplied by a Workbench Connection", () => {
    const source = DEFAULT_PROFILE_SOURCE.replace(
      "# {{ zt.title }}",
      "{% render 'connected-heading' with zt as zt %}",
    );

    const result = renderProfile(source, SAMPLE_ITEMS[0]!, {
      dependencies: {
        templates: [
          {
            name: "connected-heading",
            language: "liquid",
            source: "# Connected: {{ zt.title }}",
          },
        ],
        diagnostics: [],
      },
      citationStyle: { kind: "default" },
    });

    expect(result.creationBody).toContain(
      "# Connected: Why Most Published Research Findings Are False",
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a dependency the Local Bridge could not bundle", () => {
    const source = DEFAULT_PROFILE_SOURCE.replace(
      "# {{ zt.title }}",
      "{% render 'summary' with zt as zt %}",
    );
    const result = renderProfile(source, SAMPLE_ITEMS[0]!, {
      dependencies: {
        templates: [],
        diagnostics: [
          {
            code: "missing-dependency",
            message: "Template dependency 'summary' is missing.",
          },
        ],
      },
      citationStyle: { kind: "default" },
    });

    expect(result.diagnostics).toContainEqual({
      code: "missing-dependency",
      message: "Template dependency 'summary' is missing.",
      part: "profile",
    });
  });

  it("names an Eta dependency instead of running it", () => {
    const source = DEFAULT_PROFILE_SOURCE.replace(
      "# {{ zt.title }}",
      "{% render 'connected-heading' with zt as zt %}",
    );

    const result = renderProfile(source, SAMPLE_ITEMS[0]!, {
      dependencies: {
        templates: [
          {
            name: "connected-heading",
            language: "eta",
            source: "# <%= it.title %>",
          },
        ],
        diagnostics: [],
      },
      citationStyle: { kind: "default" },
    });

    expect(result.diagnostics).toContainEqual({
      code: "unsupported-dependency",
      params: { name: "connected-heading" },
      part: "profile",
    });
    // Nothing defined it, so the render fails where the call stands rather
    // than running Eta in the Worker.
    expect(result.creationBody).toBeNull();
  });

  it("reports a selected citation style the Local Bridge could not resolve", () => {
    const result = renderProfile(DEFAULT_PROFILE_SOURCE, SAMPLE_ITEMS[0]!, {
      dependencies: { templates: [], diagnostics: [] },
      citationStyle: {
        kind: "failed",
        styleId: "http://www.zotero.org/styles/missing",
        reason: "style-missing",
      },
    });

    expect(result.diagnostics).toContainEqual({
      code: "citation-style-error",
      params: {
        reason: "style-missing",
        styleId: "http://www.zotero.org/styles/missing",
      },
      part: "render",
    });
  });

  it("restores dates, graph references, string values, and link arguments", () => {
    const root = restoreTemplateData(
      {
        dateAdded: "2026-01-02T03:04:05Z",
        author: { fullName: "Mara Rivera" },
        noteLink: {
          $helper: "noteLink",
          signature: "(alias?: string, subpath?: string) => string | null",
          value: "[[Notes/Paper#page=7|Paper]]",
        },
        parentItem: { $ref: "zt" },
      },
      {
        stringCoercions: [{ path: ["author"], value: "Mara Rivera" }],
        temporalValues: [{ path: ["dateAdded"], type: "Temporal.Instant" }],
        graphReferences: [{ path: ["parentItem"], target: [] }],
      },
    );

    expect(root.dateAdded).toBeInstanceOf(Temporal.Instant);
    expect(String(root.author)).toBe("Mara Rivera");
    expect(root.parentItem).toBe(root);
    expect((root.noteLink as () => unknown)()).toBe(
      "[[Notes/Paper#page=7|Paper]]",
    );
    expect(
      (root.noteLink as (alias?: string, subpath?: string) => unknown)(
        "Source",
        "Summary",
      ),
    ).toBe("[[Notes/Paper#Summary|Source]]");
  });

  it("restores nested references and coercion at every serialized path", () => {
    const root = restoreTemplateData(
      {
        attachments: [{ filename: "paper.pdf" }],
        annotation: {
          parentAttachment: { $ref: "zt.attachments[0]" },
        },
      },
      {
        stringCoercions: [
          { path: ["attachments", 0], value: "paper.pdf" },
          {
            path: ["annotation", "parentAttachment"],
            value: "paper.pdf",
          },
        ],
        temporalValues: [],
        graphReferences: [
          {
            path: ["annotation", "parentAttachment"],
            target: ["attachments", 0],
          },
        ],
      },
    );

    const attachment = (root.attachments as Record<string, unknown>[])[0]!;
    const annotation = root.annotation as Record<string, unknown>;
    expect(annotation.parentAttachment).toBe(attachment);
    expect((attachment as { toString(): string }).toString()).toBe("paper.pdf");
    expect(
      (annotation.parentAttachment as { toString(): string }).toString(),
    ).toBe("paper.pdf");
  });
});

/**
 * The default Profile with three entries appended: a Spread Entry that produces
 * one new key and overrides one an earlier entry set, a rule that cannot
 * evaluate, and a `js` entry the web host refuses to run.
 */
const ROWS_PROFILE = DEFAULT_PROFILE_SOURCE.replace(
  "---\n# {{ zt.title }}",
  `  - value: { title: 'From the spread', kind: { $eval: 'zt.itemType' } }
    merge: replace
  - key: broken
    value: { $eval: 'zt.nowhere.deep' }
    merge: replace
  - key: computed
    js: zt.title
    merge: replace
---
# {{ zt.title }}`,
);

/**
 * The default Profile with four entries appended: a rule that produces nothing
 * followed by a spread that produces the same key, then a value one entry sets
 * and a spread that cannot append to it.
 */
const MERGE_PROFILE = DEFAULT_PROFILE_SOURCE.replace(
  "---\n# {{ zt.title }}",
  `  - key: doi
    expr: zt.nowhere
    merge: replace
  - value: { doi: { $eval: 'zt.title' } }
    merge: replace
  - key: tags
    expr: zt.title
    merge: replace
  - value: { tags: { $eval: '[zt.title]' } }
    merge: append
---
# {{ zt.title }}`,
);

describe("Managed Frontmatter rows", () => {
  const sample = SAMPLE_ITEMS[0]!;

  it("stamps every produced field with the entry that produced it", () => {
    const result = renderProfile(ROWS_PROFILE, sample);

    expect(
      result.properties.map(({ position, key }) => [position, key]),
    ).toEqual([
      [1, "title"],
      [2, "related"],
      [3, "collections"],
      [4, "citekey"],
      [5, "title"],
      [5, "kind"],
    ]);
  });

  it("folds the contributions in first-producer order", () => {
    const result = renderProfile(ROWS_PROFILE, sample);

    expect(result.fold.map(({ position, key }) => [position, key])).toEqual([
      [1, "title"],
      [2, "related"],
      [3, "collections"],
      [4, "citekey"],
      [5, "kind"],
    ]);
    expect(result.fold[0]?.value).toBe("From the spread");
  });

  it("names the entry every property diagnostic came from", () => {
    const result = renderProfile(ROWS_PROFILE, sample);

    expect(
      result.diagnostics.map(({ code, part, position }) => ({
        code,
        part,
        position,
      })),
    ).toEqual([
      { code: "property-error", part: "properties", position: 6 },
      { code: "property-javascript", part: "properties", position: 7 },
    ]);
    expect(result.diagnostics[0]?.message).toContain("broken");
    expect(result.diagnostics[1]?.params).toEqual({ key: "computed" });
  });

  it("folds a key under the entry that produced its value, not the one that tried", () => {
    const result = renderProfile(MERGE_PROFILE, sample);

    expect(result.properties.filter(({ key }) => key === "doi")).toMatchObject([
      { position: 5, missing: true },
      { position: 6 },
    ]);
    expect(result.fold.find(({ key }) => key === "doi")).toMatchObject({
      position: 6,
      value: sample.item.title,
    });
  });

  it("names the entry whose append the fold could not take", () => {
    const result = renderProfile(MERGE_PROFILE, sample);

    expect(result.diagnostics).toMatchObject([
      {
        code: "property-append-conflict",
        params: { key: "tags" },
        part: "properties",
        position: 8,
      },
    ]);
    expect(result.fold.find(({ key }) => key === "tags")).toMatchObject({
      position: 7,
    });
  });
});
