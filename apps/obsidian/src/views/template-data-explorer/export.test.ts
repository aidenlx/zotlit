import { describe, expect, it } from "vitest";

import { buildTemplateDataExport } from "./export";

const BASE = {
  indexedKey: "ABCD2345",
  pluginVersion: "2.1.0-beta.3",
  timestamp: "20260512-143000",
} as const;

describe("buildTemplateDataExport", () => {
  it("names the file after the exported key and the timestamp", () => {
    const { filename } = buildTemplateDataExport({
      ...BASE,
      root: {},
      contractRoot: "note",
    });
    expect(filename).toBe("zotlit-template-data-ABCD2345-20260512-143000.json");
  });

  it("carries the group suffix of a group-library key into the file name", () => {
    const { filename } = buildTemplateDataExport({
      ...BASE,
      indexedKey: "ABCD2345g12345",
      root: {},
      contractRoot: "note",
    });
    expect(filename).toBe(
      "zotlit-template-data-ABCD2345g12345-20260512-143000.json",
    );
  });

  it("heads the file with the zt-contract version, the plugin version, and the request", () => {
    const { json } = buildTemplateDataExport({
      ...BASE,
      root: { title: "On the Origin of Species" },
      contractRoot: "note",
    });
    expect(JSON.parse(json)).toEqual({
      templateContractVersion: expect.any(Number),
      pluginVersion: "2.1.0-beta.3",
      request: { key: "ABCD2345", root: "note" },
      zt: { title: "On the Origin of Species" },
    });
  });

  it("echoes the annotation root when the pane is anchored at an annotation", () => {
    const { json } = buildTemplateDataExport({
      ...BASE,
      indexedKey: "WXYZ6789",
      root: { text: "natural selection" },
      contractRoot: "annotation",
    });
    expect(JSON.parse(json).request).toEqual({
      key: "WXYZ6789",
      root: "annotation",
    });
  });

  it("serializes the root through the contract, keeping nested data", () => {
    const { json } = buildTemplateDataExport({
      ...BASE,
      root: { tags: ["evolution", "biology"], citekey: "darwin1859origin" },
      contractRoot: "note",
    });
    expect(JSON.parse(json).zt).toEqual({
      tags: ["evolution", "biology"],
      citekey: "darwin1859origin",
    });
  });

  it("indents the file so a reader can scan it", () => {
    const { json } = buildTemplateDataExport({
      ...BASE,
      root: {},
      contractRoot: "note",
    });
    expect(json).toContain('\n  "pluginVersion"');
  });
});
