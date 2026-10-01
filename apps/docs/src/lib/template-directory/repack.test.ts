import { describe, expect, it } from "vitest";

import { parseLiteratureNoteTemplate } from "@zotlit/templates/facade";

import { repackTemplateDirectory, verifyTemplateDirectory } from "./index";
import {
  edit,
  FIXTURE_HEADING_FILE,
  FIXTURE_PROFILE,
  FIXTURE_PROFILE_FILE,
  fixtureFiles,
} from "./test-fixtures";

function applied(
  files: Map<string, string>,
  changes: ReadonlyMap<string, string>,
): Map<string, string> {
  return new Map([...files, ...changes]);
}

function drift(files: ReadonlyMap<string, string>) {
  return verifyTemplateDirectory(files).problems.filter(
    ({ entry, code }) =>
      entry === FIXTURE_PROFILE &&
      [
        "partial-not-packed",
        "packed-partial-differs",
        "packed-partial-uncalled",
      ].includes(code),
  );
}

describe("re-packing the Directory", () => {
  it("rewrites a Profile's packed partial after its partial entry changes", () => {
    const files = edit(fixtureFiles(), FIXTURE_HEADING_FILE, [
      "## {{ zt.title }}",
      "### {{ zt.title }}",
    ]);
    expect(drift(files)).toContainEqual(
      expect.objectContaining({ code: "packed-partial-differs" }),
    );

    const changes = repackTemplateDirectory(files);

    expect([...changes.keys()]).toEqual([FIXTURE_PROFILE_FILE]);
    const repacked = applied(files, changes);
    expect(drift(repacked)).toEqual([]);
    expect(
      parseLiteratureNoteTemplate(repacked.get(FIXTURE_PROFILE_FILE)!).manifest
        .partials,
    ).toContainEqual({
      name: "fixture-heading",
      language: "liquid",
      source: "### {{ zt.title }}\n",
    });
  });

  it("packs a partial that a packed partial calls", () => {
    const files = fixtureFiles()
      .set(
        "partials/fixture-byline/entry.md",
        fixtureFiles()
          .get("partials/fixture-heading/entry.md")!
          .replace("Fixture heading", "Fixture byline"),
      )
      .set(
        "partials/fixture-byline/zotlit-partial.fixture-byline.md",
        "---\nlanguage: liquid\n---\nby {{ zt.authorsShort }}\n",
      );
    edit(files, FIXTURE_HEADING_FILE, [
      "## {{ zt.title }}\n",
      '## {{ zt.title }}\n{% render "fixture-byline" with zt as zt %}\n',
    ]);

    const repacked = applied(files, repackTemplateDirectory(files));

    expect(drift(repacked)).toEqual([]);
    expect(
      parseLiteratureNoteTemplate(
        repacked.get(FIXTURE_PROFILE_FILE)!,
      ).manifest.partials?.map(({ name }) => name),
    ).toEqual(["fixture-byline", "fixture-heading", "fixture-quote"]);
  });

  it("drops a packed partial the Profile no longer calls", () => {
    const files = edit(fixtureFiles(), FIXTURE_PROFILE_FILE, [
      '{% render "fixture-heading" with zt as zt %}\n',
      "## {{ zt.title }}\n",
    ]);

    const repacked = applied(files, repackTemplateDirectory(files));

    expect(drift(repacked)).toEqual([]);
    expect(
      parseLiteratureNoteTemplate(
        repacked.get(FIXTURE_PROFILE_FILE)!,
      ).manifest.partials?.map(({ name }) => name),
    ).toEqual(["fixture-quote"]);
  });

  it("packs a Profile that packs nothing yet, keeping the rest of its bytes", () => {
    const files = edit(fixtureFiles(), FIXTURE_PROFILE_FILE, [
      /partials:\n[\s\S]*?\n---\n/.exec(
        fixtureFiles().get(FIXTURE_PROFILE_FILE)!,
      )![0],
      "---\n",
    ]);

    const repacked = repackTemplateDirectory(files).get(FIXTURE_PROFILE_FILE)!;

    expect(repacked).toBe(fixtureFiles().get(FIXTURE_PROFILE_FILE));
  });

  it("changes nothing in a Directory whose Profiles are packed", () => {
    expect(repackTemplateDirectory(fixtureFiles()).size).toBe(0);
  });
});
