import { describe, expect, it } from "vitest";

import {
  pandocCliFilter,
  pandocDefaults,
  pandocSandboxFilter,
  PANDOC_FILTER_FILENAME,
  PANDOC_RESOLVE_MAP_FILENAME,
} from ".";

describe("bundled Pandoc integration files", () => {
  it("gives each filter variant only its own resolution path", () => {
    expect(pandocCliFilter).toContain('pandoc.pipe("obsidian"');
    expect(pandocCliFilter).not.toContain(PANDOC_RESOLVE_MAP_FILENAME);

    expect(pandocSandboxFilter).toContain(PANDOC_RESOLVE_MAP_FILENAME);
    expect(pandocSandboxFilter).not.toContain("pandoc.pipe");
  });

  it("locates the filter by co-location, ahead of citeproc", () => {
    expect(pandocDefaults).toContain(`\${.}/${PANDOC_FILTER_FILENAME}`);
    expect(pandocDefaults.indexOf(PANDOC_FILTER_FILENAME)).toBeLessThan(
      pandocDefaults.indexOf("citeproc"),
    );
  });
});
