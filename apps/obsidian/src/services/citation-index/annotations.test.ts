import { expect, it } from "vitest";

import { inProcessParseClient } from "@/services/citation-parse/in-process";
import { buildReferenceEntries } from "@/views/references/entries";

import { annotationRows, annotationUri } from "./__fixtures__/annotations";
import type { CitedBySnapshot } from "./service";
import { createCitationIndexHarness, KEY_A, KEY_B } from "./test-harness";

it("keeps Annotation Citations outside the Document Citation Set", async () => {
  await using harness = await createCitationIndexHarness(
    {
      "draft.md": `[](${annotationUri})\n@roe2025\n[[Doe 2024]]\n[p. 42](${annotationUri})\n![](${annotationUri})`,
    },
    {
      zoteroRows: annotationRows,
      settings: { "citation.wikilink-citations": true },
    },
  );
  const { index, draft, workspace } = harness;
  const set = await index.getDocumentCitationSet(draft);
  expect(set.citations).toMatchObject([
    { indexedKey: KEY_B, refNumber: 1 },
    { indexedKey: KEY_A, refNumber: 2, linkpath: "Doe 2024" },
  ]);
  expect(set.occurrences.map(({ kind }) => kind)).toEqual([
    "citekey",
    "wikilink",
  ]);
  expect(set.omittedSyntaxes).toEqual(["annotation"]);
  workspace.layoutReady();
  await index.whenIndexed();
  expect((await index.getCitedBy(KEY_A)).groups).toMatchObject([
    {
      path: "draft.md",
      occurrences: [{ kind: "wikilink" }],
    },
  ]);
  expect(await index.citedByOmittedSyntaxes(KEY_A)).toEqual(["annotation"]);
  const snapshots: CitedBySnapshot[] = [];
  const stop = index.observeCitedBy(KEY_A, (snapshot) =>
    snapshots.push(snapshot),
  );
  try {
    await expect
      .poll(() =>
        snapshots.at(-1)?.groups[0]?.occurrences.map(({ kind }) => kind),
      )
      .toEqual(["wikilink"]);
  } finally {
    stop();
  }
});

it("keeps a deleted Annotation Citation outside unresolved references", async () => {
  await using harness = await createCitationIndexHarness(
    {
      "draft.md":
        "[](zotero://open/library/items/PDF23456?annotation=ZZZZZZZZ)\n@ZZZZZZZZ",
    },
    { zoteroRows: annotationRows },
  );
  const set = await harness.index.getDocumentCitationSet(harness.draft);
  expect(set.citations).toMatchObject([{ indexedKey: null, refNumber: 1 }]);
  expect(buildReferenceEntries(set.citations)).toMatchObject([
    { kind: "unresolved", citekey: "ZZZZZZZZ" },
  ]);
  expect(set.omittedSyntaxes).toEqual(["annotation"]);
});

it.each(["library", "groups/7"])(
  "excludes an Annotation Citation from a %s source",
  async (library) => {
    await using harness = await createCitationIndexHarness(
      {
        "draft.md": `[](zotero://open/${library}/items/PDF23456?page=iv&annotation=ANN23456)`,
      },
      { zoteroRows: annotationRows },
    );
    const set = await harness.index.getDocumentCitationSet(harness.draft);
    expect(set.citations).toEqual([]);
    expect(set.omittedSyntaxes).toEqual(["annotation"]);
  },
);

it("does not report a disabled Annotation Citation as a Reference Error", async () => {
  await using harness = await createCitationIndexHarness({
    "draft.md":
      "[](zotero://open/library/items/PDF23456)\n[PDF](zotero://open/library/items/PDF23456)",
  });
  const { index, draft, settings } = harness;
  const set = await index.getDocumentCitationSet(draft);
  expect(set.citations).toEqual([]);
  expect(set.errors).toEqual([]);
  expect(set.omittedSyntaxes).toEqual(["annotation"]);
  settings.update({ "citation.pandoc-citations": false });
  expect((await index.getDocumentCitationSet(draft)).errors).toEqual([]);
  expect(await index.documentOmittedSyntaxes(draft)).toEqual(["annotation"]);
});

it("keeps Annotation Citations omitted across citation source changes", async () => {
  let parses = 0;
  await using harness = await createCitationIndexHarness(
    {
      "draft.md": `[](${annotationUri})`,
      "labels.md": `[p. 42](${annotationUri})\n![](${annotationUri})`,
    },
    {
      zoteroRows: annotationRows,
      notes: false,
      parseClient: {
        parse: (...args) => {
          parses++;
          return inProcessParseClient.parse(...args);
        },
      },
    },
  );
  const { index, draft, workspace, settings } = harness;
  workspace.layoutReady();
  await index.whenIndexed();
  expect((await index.getDocumentCitationSet(draft)).citations).toEqual([]);
  const snapshots: CitedBySnapshot[] = [];
  const stop = index.observeCitedBy(KEY_A, (snapshot) =>
    snapshots.push(snapshot),
  );
  try {
    await expect.poll(() => snapshots.at(-1)?.groups.length).toBe(0);
    settings.update({ "citation.pandoc-citations": false });
    expect((await index.getDocumentCitationSet(draft)).citations).toEqual([]);
    expect(await index.documentOmittedSyntaxes(draft)).toEqual(["annotation"]);
    expect(await index.citedByOmittedSyntaxes(KEY_A)).toEqual(["annotation"]);
    expect(
      await index.documentOmittedSyntaxes(
        harness.vault.getFileByPath("labels.md")!,
      ),
    ).toEqual([]);
    await expect.poll(() => snapshots.at(-1)?.groups).toEqual([]);
    expect(parses).toBe(2);
  } finally {
    stop();
  }
});
