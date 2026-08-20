// Database notice copy and recovery actions at the Obsidian UI seam.

import { describe, expect, it } from "vitest";

import { staleReadNotice } from "./actions";

describe("staleReadNotice", () => {
  it("carries the approved recovery copy and guide", () => {
    const notice = staleReadNotice();

    expect(notice).toMatchObject({
      title: "Recent Zotero edits may be missing",
      explanation:
        "Install or update the Zotero companion to keep its database current for ZotLit.",
      fixAction: "Fix stale data",
      dismissAction: "Dismiss",
      guideUrl: "https://zotlit.aidenlx.site/docs/how-to/fix-stale-data",
      duration: 0,
    });
    expect(
      [
        notice.title,
        notice.explanation,
        notice.fixAction,
        notice.dismissAction,
      ].join(" "),
    ).not.toContain("—");
  });
});
