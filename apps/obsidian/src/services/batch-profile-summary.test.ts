import { describe, expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import { batchProfileSummary } from "./batch-profile-summary";

describe("batch Profile summary", () => {
  it.each([
    { cancelled: false, aborted: false, message: m.batch_profile_summary },
    {
      cancelled: true,
      aborted: false,
      message: m.batch_profile_summary_cancelled,
    },
    {
      cancelled: true,
      aborted: true,
      message: m.batch_profile_summary_aborted,
    },
  ])(
    "reports an empty run with cancelled=$cancelled and aborted=$aborted",
    ({ cancelled, aborted, message }) => {
      expect(
        batchProfileSummary(
          { created: 0, updated: 0, failed: 0, skipped: 0, cancelled },
          {
            profiles: [],
            cancelled,
            aborted,
          },
        ),
      ).toBe(
        message({
          created: m.batch_profile_created_none(),
          updated: m.batch_profile_updated_none(),
          failed: 0,
          skipped: 0,
          kept: 0,
          notFound: 0,
        }),
      );
    },
  );

  it("names successful Profile groups and keeps failure, skip, kept, and missing counts separate", () => {
    expect(
      batchProfileSummary(
        { created: 3, updated: 5, failed: 2, skipped: 1, cancelled: false },
        {
          profiles: [
            { label: "Articles", created: 3, updated: 4 },
            { label: "Default", created: 0, updated: 1 },
            { label: "Books", created: 0, updated: 0 },
          ],
          kept: 6,
          notFound: 7,
          cancelled: false,
          aborted: false,
        },
      ),
    ).toBe(
      m.batch_profile_summary({
        created: m.batch_profile_created({ count: 3, label: "Articles" }),
        updated: `${m.batch_profile_updated({ count: 4, label: "Articles" })}, ${m.batch_profile_updated({ count: 1, label: "Default" })}`,
        failed: 2,
        skipped: 1,
        kept: 6,
        notFound: 7,
      }),
    );
  });
});
