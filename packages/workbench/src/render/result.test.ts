import { describe, expect, it } from "vitest";

import { emptyRender, retainOutputs } from "./result";
import type { TemplateRenderResult } from "./result";

interface HostResult extends TemplateRenderResult {
  readonly sourcePath: string;
  readonly annotationSourcePath?: string;
  readonly citations: readonly { start: number; end: number; html: string }[];
  readonly annotationCitations: readonly {
    start: number;
    end: number;
    html: string;
  }[];
}

describe("retained output metadata", () => {
  const kept: HostResult = {
    ...emptyRender({ sourceRevision: "first", snapshotRevision: "paper" }),
    creationBody: "First note [@paper]",
    managedRegion: "First note [@paper]",
    annotation: "First highlight [@paper]",
    annotationCitation: "(Author, 2020)",
    sourcePath: "notes/paper.md",
    citations: [{ start: 11, end: 19, html: "<cite>First note</cite>" }],
    annotationCitations: [
      { start: 16, end: 24, html: "<cite>First highlight</cite>" },
    ],
  };

  it("keeps note metadata while publishing a successful Annotation after a Property failure", () => {
    const result: HostResult = {
      ...emptyRender({ sourceRevision: "second", snapshotRevision: "paper" }),
      annotation: "New highlight [@paper]",
      annotationCitation: "(Author, 2021)",
      sourcePath: "notes/renamed-paper.md",
      citations: [],
      annotationCitations: [
        { start: 14, end: 22, html: "<cite>New highlight</cite>" },
      ],
      diagnostics: [{ code: "property-error", part: "properties" }],
    };

    expect(retainOutputs(kept, result)).toMatchObject({
      creationBody: "First note [@paper]",
      managedRegion: "First note [@paper]",
      sourcePath: "notes/paper.md",
      citations: [{ start: 11, end: 19, html: "<cite>First note</cite>" }],
      annotation: "New highlight [@paper]",
      annotationSourcePath: "notes/renamed-paper.md",
      annotationCitation: "(Author, 2021)",
      annotationCitations: [
        { start: 14, end: 22, html: "<cite>New highlight</cite>" },
      ],
      sourceRevision: "second",
      diagnostics: [{ code: "property-error", part: "properties" }],
    });
  });

  it("keeps Annotation metadata while publishing a successful note", () => {
    const result: HostResult = {
      ...emptyRender({ sourceRevision: "second", snapshotRevision: "paper" }),
      creationBody: "New note [@paper]",
      managedRegion: "New note [@paper]",
      sourcePath: "notes/renamed-paper.md",
      citations: [{ start: 9, end: 17, html: "<cite>New note</cite>" }],
      annotationCitations: [],
      diagnostics: [{ code: "render-error", part: "annotation" }],
    };

    expect(retainOutputs(kept, result)).toMatchObject({
      creationBody: "New note [@paper]",
      managedRegion: "New note [@paper]",
      sourcePath: "notes/renamed-paper.md",
      citations: [{ start: 9, end: 17, html: "<cite>New note</cite>" }],
      annotation: "First highlight [@paper]",
      annotationSourcePath: "notes/paper.md",
      annotationCitation: "(Author, 2020)",
      annotationCitations: [
        { start: 16, end: 24, html: "<cite>First highlight</cite>" },
      ],
      sourceRevision: "second",
      diagnostics: [{ code: "render-error", part: "annotation" }],
    });
  });

  it("replaces metadata with successful empty output and with another selection", () => {
    const empty = {
      ...kept,
      creationBody: "",
      annotation: "",
      citations: [],
      annotationCitations: [],
    };
    expect(retainOutputs(kept, empty)).toBe(empty);

    const other = {
      ...empty,
      ...emptyRender({ sourceRevision: "second", snapshotRevision: "other" }),
    };
    expect(retainOutputs(kept, other)).toBe(other);
  });
});
