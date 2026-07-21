import { describe, expect, it } from "vitest";

import { releaseNoteUrl } from "./constants";

describe("releaseNoteUrl", () => {
  it("builds the per-version changelog URL with the raw semver slug", () => {
    expect(releaseNoteUrl("2.0.0-alpha.6")).toBe(
      "https://zotlit.aidenlx.site/changelog/2.0.0-alpha.6",
    );
  });
});
