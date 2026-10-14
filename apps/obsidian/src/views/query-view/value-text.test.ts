import { describe, expect, it } from "vitest";

import { DATASETS } from "./datasets";
import { columnLabel } from "./value-text";
import { datasetProperties } from "./visible-properties";

describe("columnLabel", () => {
  it.each([
    // Zotero's own label for an Item field.
    ["title", "Title"],
    ["DOI", "DOI"],
    // The Query Dataset's label where Zotero has none.
    ["item.title", "Item title"],
    ["colorName", "Color"],
    ["attachment.title", "Attachment title"],
    ["tags", "Tag"],
    // A field of the Item or the Attachment, under its parent's name.
    ["item.publicationTitle", "Item publication"],
    ["item.DOI", "Item DOI"],
    ["item.archiveID", "Item archive ID"],
    ["item.dateAdded", "Item date added"],
    ["item.itemType", "Item type"],
    // A path no label covers stays as it is.
    ["attachment.contentType", "attachment.contentType"],
  ])("names %s as %s", (property, label) => {
    expect(columnLabel(property)).toBe(label);
  });

  it.each(Object.entries(DATASETS))(
    "names every property %s sort and group by",
    (dataset, spec) => {
      const paths = [
        ...spec.sort.map(([path, label]) => [path, label()] as const),
        ...spec.group.map(({ path, label }) => [path, label()] as const),
      ].filter(([path]) =>
        datasetProperties(dataset as keyof typeof DATASETS).includes(path),
      );
      expect(paths.length).toBeGreaterThan(0);
      for (const [path] of paths) expect(columnLabel(path)).not.toBe(path);
    },
  );
});
