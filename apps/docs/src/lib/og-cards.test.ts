import { describe, expect, it } from "vitest";

import { getPackageRoot } from "@zotlit/scripts/package-roots";

import { m } from "@/paraglide/messages.js";

import { ogCards } from "./og-cards";
import { directorySite } from "./template-directory/site-data";
import {
  edit,
  FIXTURE_PROPERTY,
  fixtureFiles,
} from "./template-directory/test-fixtures";
import { verifyTemplateDirectory } from "./template-directory/verify";

const packageRoot = getPackageRoot(import.meta.filename);

describe("the Template Directory's social cards", () => {
  it("give the index and every entry a card of its own, which names the entry and what kind it is", async () => {
    const cards = await ogCards(
      packageRoot,
      directorySite(verifyTemplateDirectory(fixtureFiles())),
    );

    expect(cards.get("/og/templates/image.webp")).toEqual({
      kind: m.docs_directory_title(),
      title: m.docs_directory_heading(),
      description: m.docs_directory_description(),
      meta: "https://zotlit.aidenlx.site/templates",
    });
    expect(
      cards.get("/og/templates/profiles/fixture-profile/image.webp"),
    ).toEqual({
      kind: m.docs_directory_title(),
      title: "Fixture profile",
      description: "A Profile the verification tests break one rule at a time.",
      meta: `${m.docs_directory_kind_profile()} · ${m.docs_directory_level_ready()}`,
    });
    expect(
      cards.get("/og/templates/properties/fixture-year/image.webp"),
    ).toMatchObject({
      title: "Fixture year",
      meta: `${m.docs_directory_kind_property()} · ${m.docs_directory_level_customize()}`,
    });
  });

  it("shorten a summary longer than three lines of the card at a word, so the card keeps its footer", async () => {
    const summary =
      "Separate properties for the details each kind of source has — journal, volume, issue, and pages for an article; publisher, place, edition, and ISBN for a book.";
    const files = edit(fixtureFiles(), `${FIXTURE_PROPERTY}/entry.md`, [
      "summary: The year.",
      `summary: ${summary}`,
    ]);
    const cards = await ogCards(
      packageRoot,
      directorySite(verifyTemplateDirectory(files)),
    );

    expect(
      cards.get("/og/templates/properties/fixture-year/image.webp")
        ?.description,
    ).toBe(
      "Separate properties for the details each kind of source has — journal, volume, issue, and pages for an article…",
    );
  });
});
