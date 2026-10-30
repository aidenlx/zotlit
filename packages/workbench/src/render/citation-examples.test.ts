import { describe, expect, it, vi } from "vitest";

import { citationExampleData } from "./index";

describe("citation example sets", () => {
  it("leaves the note-root properties off a cited item and keeps its Zotero fields", () => {
    const [citation] = citationExampleData("one-item", "main").citations;
    const item = citation!.item;
    for (const absent of [
      "key",
      "indexedKey",
      "libraryID",
      "groupID",
      "dateAdded",
      "dateModified",
      "tags",
      "notePath",
      "noteLink",
      "authors",
      "authorsShort",
      "collections",
    ]) {
      expect(item).not.toHaveProperty(absent);
    }
    expect(item.publicationTitle).toBe("PLoS Medicine");
    expect(item.containerTitle).toBe("PLoS Medicine");
  });

  it("loads the render entry on a runtime that has yet to install Temporal", async () => {
    // The web Workbench statically imports this entry and installs its
    // `Temporal` polyfill in an effect, so nothing here may restore a Sample
    // Item's dates at import time.
    vi.resetModules();
    const native = globalThis.Temporal;
    Reflect.deleteProperty(globalThis, "Temporal");
    try {
      const entry = await import("./index");
      expect(entry.CITATION_EXAMPLE_IDS).toHaveLength(6);
      expect(() => entry.citationExampleData("one-item", "main")).toThrow(
        /Temporal is not defined/,
      );
    } finally {
      globalThis.Temporal = native;
    }
  });
});
