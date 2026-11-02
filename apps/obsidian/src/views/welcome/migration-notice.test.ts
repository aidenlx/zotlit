import { expect, it } from "vitest";

import { templateMigrationNotice } from "./migration-notice";

it("#1904: names the properties a converted document still needs fixed", () => {
  const notice = templateMigrationNotice({
    outcome: "converted",
    document: "zotlit-profile.default.md",
    trashed: ["templates/zotlit-note.liquid.md"],
    pendingCleanup: [],
    kept: [],
    frontmatterFailures: ["Date Added", "Authors"],
  });

  expect(notice).toContain("Date Added, Authors");
  expect(notice).toContain("Edit profile");
});
