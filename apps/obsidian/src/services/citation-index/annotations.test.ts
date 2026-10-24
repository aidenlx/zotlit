import { expect, it } from "vitest";

import { Effect } from "@/lib/effect";
import { inProcessParseClient } from "@/services/citation-parse/in-process";
import { buildReferenceEntries } from "@/views/references/entries";

import { annotationRows, annotationUri } from "./__fixtures__/annotations";
import type { CitedBySnapshot } from "./service";
import { createCitationIndexHarness, KEY_A, KEY_B } from "./test-harness";

it("#1693 numbers Annotation Citations with other sources and lists their notes in Cited By", async () => {
  await using harness = await createCitationIndexHarness(
    {
      "draft.md": `[](${annotationUri})\n@roe2025\n[[Doe 2024]]\n[p. 42](${annotationUri})\n![](${annotationUri})`,
    },
    {
      zoteroRows: annotationRows,
      settings: {
        "citation.wikilink-citations": true,
        "citation.annotation-citations": true,
      },
    },
  );
  const { index, draft, workspace } = harness;
  const set = await index.getDocumentCitationSet(draft);
  expect(set.citations).toMatchObject([
    { indexedKey: KEY_A, refNumber: 1, linkpath: "Doe 2024.md" },
    { indexedKey: KEY_B, refNumber: 2 },
  ]);
  expect(set.occurrences.map(({ kind }) => kind)).toEqual([
    "annotation",
    "citekey",
    "wikilink",
  ]);
  expect(set.occurrences[0]).toEqual({
    kind: "annotation",
    raw: "ANN23456",
    pageLabel: "42",
    position: {
      start: { line: 0, col: 0, offset: 0 },
      end: { line: 0, col: 68, offset: 68 },
    },
  });
  workspace.layoutReady();
  await index.whenIndexed();
  expect((await index.getCitedBy(KEY_A)).groups).toMatchObject([
    {
      path: "draft.md",
      occurrences: [
        { kind: "annotation", raw: "ANN23456" },
        { kind: "wikilink" },
      ],
    },
  ]);
  const snapshots: CitedBySnapshot[] = [];
  const stop = index.observeCitedBy(KEY_A, (snapshot) =>
    snapshots.push(snapshot),
  );
  try {
    await expect
      .poll(() =>
        snapshots.at(-1)?.groups[0]?.occurrences.map(({ kind }) => kind),
      )
      .toEqual(["annotation", "wikilink"]);
  } finally {
    stop();
  }
});

it("#1693 keeps a deleted Annotation as an unresolved reference distinct from a literal citation key", async () => {
  await using harness = await createCitationIndexHarness(
    {
      "draft.md":
        "[](zotero://open/library/items/PDF23456?annotation=ZZZZZZZZ)\n@ZZZZZZZZ",
    },
    {
      zoteroRows: annotationRows,
      settings: { "citation.annotation-citations": true },
    },
  );
  const set = await harness.index.getDocumentCitationSet(harness.draft);
  expect(set.citations).toMatchObject([
    {
      indexedKey: null,
      refNumber: 1,
      occurrences: [{ kind: "annotation", raw: "ZZZZZZZZ" }],
    },
    {
      indexedKey: null,
      refNumber: 2,
      occurrences: [{ kind: "citekey", raw: "ZZZZZZZZ" }],
    },
  ]);
  expect(buildReferenceEntries(set.citations)).toMatchObject([
    { kind: "unresolved", annotationKey: "ZZZZZZZZ" },
    { kind: "unresolved", citekey: "ZZZZZZZZ" },
  ]);
});

it.each([
  {
    label: "a parent without a Citation Key",
    library: "library",
    annotation: "ANNNCKEY",
    attachment: "PDFNCKEY",
    key: "NCKEY234",
    citekey: null,
  },
  {
    label: "a group Library Annotation",
    library: "groups/7",
    annotation: "ANN23456",
    attachment: "PDF23456",
    key: KEY_B,
    citekey: "roe2025",
  },
])(
  "#1693 resolves $label by Item identity",
  async ({ library, annotation, attachment, key, citekey }) => {
    await using harness = await createCitationIndexHarness(
      {
        "draft.md": `[](zotero://open/${library}/items/${attachment}?page=iv&annotation=${annotation})`,
      },
      {
        zoteroRows: annotationRows,
        settings: { "citation.annotation-citations": true },
      },
    );
    const set = await harness.index.getDocumentCitationSet(harness.draft);
    expect(set.citations).toMatchObject([{ indexedKey: key, refNumber: 1 }]);
    expect(buildReferenceEntries(set.citations)).toMatchObject([
      { kind: "summary", source: { citekey } },
    ]);
  },
);

it("#1693 reports an attachment-only empty link as a Reference Error", async () => {
  await using harness = await createCitationIndexHarness(
    {
      "draft.md":
        "[](zotero://open/library/items/PDF23456)\n[PDF](zotero://open/library/items/PDF23456)",
    },
    { settings: { "citation.annotation-citations": true } },
  );
  const { index, draft, settings, settingsBridge } = harness;
  const set = await index.getDocumentCitationSet(draft);
  expect(set.citations).toEqual([]);
  expect(set.errors).toMatchObject([
    {
      kind: "malformed-annotation",
      occurrence: {
        kind: "annotation",
        raw: "zotero://open/library/items/PDF23456",
        position: { start: { offset: 0 }, end: { offset: 40 } },
      },
    },
  ]);
  expect(
    buildReferenceEntries(set.citations, { errors: set.errors }),
  ).toMatchObject([{ kind: "malformed" }]);
  settingsBridge.runSync(
    settings.update({ "citation.annotation-citations": false }),
  );
  expect((await index.getDocumentCitationSet(draft)).errors).toEqual([]);
  expect(await index.documentOmittedSyntaxes(draft)).toEqual(["annotation"]);
});

it("#1693 omits and restores Annotation Citations without another parse", async () => {
  let parses = 0;
  await using harness = await createCitationIndexHarness(
    {
      "draft.md": `[](${annotationUri})`,
      "labels.md": `[p. 42](${annotationUri})\n![](${annotationUri})`,
    },
    {
      zoteroRows: annotationRows,
      settings: { "citation.annotation-citations": true },
      notes: false,
      parseClient: {
        parse: (request) =>
          inProcessParseClient
            .parse(request)
            .pipe(Effect.tap(() => Effect.sync(() => parses++))),
      },
    },
  );
  const { index, draft, workspace, settings, settingsBridge } = harness;
  workspace.layoutReady();
  await index.whenIndexed();
  expect((await index.getDocumentCitationSet(draft)).citations).toHaveLength(1);
  const snapshots: CitedBySnapshot[] = [];
  const stop = index.observeCitedBy(KEY_A, (snapshot) =>
    snapshots.push(snapshot),
  );
  try {
    await expect.poll(() => snapshots.at(-1)?.groups.length).toBe(1);
    settingsBridge.runSync(
      settings.update({ "citation.annotation-citations": false }),
    );
    expect((await index.getDocumentCitationSet(draft)).citations).toEqual([]);
    expect(await index.documentOmittedSyntaxes(draft)).toEqual(["annotation"]);
    expect(await index.citedByOmittedSyntaxes(KEY_A)).toEqual(["annotation"]);
    expect(
      await index.documentOmittedSyntaxes(
        harness.vault.getFileByPath("labels.md")!,
      ),
    ).toEqual([]);
    await expect.poll(() => snapshots.at(-1)?.groups).toEqual([]);
    settingsBridge.runSync(
      settings.update({ "citation.annotation-citations": true }),
    );
    expect((await index.getDocumentCitationSet(draft)).citations).toMatchObject(
      [{ indexedKey: KEY_A }],
    );
    expect(await index.documentOmittedSyntaxes(draft)).toEqual([]);
    expect(await index.citedByOmittedSyntaxes(KEY_A)).toEqual([]);
    await expect.poll(() => snapshots.at(-1)?.groups.length).toBe(1);
    expect(parses).toBe(2);
  } finally {
    stop();
  }
});
