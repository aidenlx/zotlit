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
