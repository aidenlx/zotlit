import { describe, expect, it } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import { candidateMatches, candidateRow } from "./candidates";
import type { AmbiguousCandidate } from "./service";

function candidate(
  overrides: Partial<AmbiguousCandidate> = {},
): AmbiguousCandidate {
  return {
    itemID: 11,
    libraryID: 1,
    key: "DOE2024",
    indexedKey: "DOE2024",
    summary: "Doe (2024): A study of citations",
    library: { selector: { type: "personal" }, libraryID: 1, name: null },
    ...overrides,
  };
}

describe("candidateRow", () => {
  it("states the Item summary, the Library, and the bare Zotero item key", () => {
    expect(candidateRow(candidate())).toEqual({
      summary: "Doe (2024): A study of citations",
      library: m.settings_db_library_user(),
      key: "DOE2024",
    });
  });

  it("names a group Library by the name Zotero holds for it", () => {
    const row = candidateRow(
      candidate({
        library: {
          selector: { type: "group", groupID: 7 },
          libraryID: 4,
          name: "Shared group",
        },
      }),
    );

    expect(row.library).toBe("Shared group");
  });

  it("carries no Library label when the scope no longer names one", () => {
    expect(candidateRow(candidate({ library: null })).library).toBeNull();
  });
});

describe("candidateMatches", () => {
  const row = candidateRow(
    candidate({
      library: {
        selector: { type: "group", groupID: 7 },
        libraryID: 4,
        name: "Shared group",
      },
    }),
  );

  it("keeps every candidate while the filter is empty", () => {
    expect(candidateMatches(row, "  ")).toBe(true);
  });

  it("matches the summary, the Library name, and the bare Zotero item key", () => {
    expect(candidateMatches(row, "study")).toBe(true);
    expect(candidateMatches(row, "shared")).toBe(true);
    expect(candidateMatches(row, "doe2024")).toBe(true);
    expect(candidateMatches(row, "roe")).toBe(false);
  });
});
