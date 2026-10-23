import "fake-indexeddb/auto";
import { deleteDB, openDB } from "idb";
import type { App } from "obsidian";
import { expect, it } from "vitest";

import { openCitekeyStore, SCANNER_REVISION } from "./store";
import { createCitationIndexHarness, makeFile } from "./test-harness";

it("reads all Annotation Occurrence forms in document order (#1692)", async () => {
  await using harness = await createCitationIndexHarness({
    "draft.md": [
      "[](zotero://open/library/items/ABCD2345?annotation=EFGH6789)",
      "[label](zotero://open/library/items/ABCD2345?annotation=EFGH6789)",
      "![crop](zotero://open/library/items/ABCD2345?annotation=EFGH6789)",
    ].join("\n"),
  });
  harness.workspace.layoutReady();
  await harness.index.whenIndexed();

  expect(harness.index.getAnnotationUses("EFGH6789")).toEqual([
    {
      path: "draft.md",
      occurrence: {
        indexedKey: "EFGH6789",
        attachmentKey: "ABCD2345",
        pageLabel: null,
        form: "citation",
        text: "",
        position: {
          start: { line: 0, col: 0, offset: 0 },
          end: { line: 0, col: 60, offset: 60 },
        },
      },
    },
    {
      path: "draft.md",
      occurrence: {
        indexedKey: "EFGH6789",
        attachmentKey: "ABCD2345",
        pageLabel: null,
        form: "labelled",
        text: "label",
        position: {
          start: { line: 1, col: 0, offset: 61 },
          end: { line: 1, col: 65, offset: 126 },
        },
      },
    },
    {
      path: "draft.md",
      occurrence: {
        indexedKey: "EFGH6789",
        attachmentKey: "ABCD2345",
        pageLabel: null,
        form: "embed",
        text: "crop",
        position: {
          start: { line: 2, col: 0, offset: 127 },
          end: { line: 2, col: 65, offset: 192 },
        },
      },
    },
  ]);
  expect(harness.index.getAnnotationUses("MISSING1")).toEqual([]);
});

it("restores schema v2 Annotation Occurrences with link text without a read (#1692)", async () => {
  const appId = crypto.randomUUID();
  const name = `${appId}-zotlit-citation-index`;
  const body =
    "[label](zotero://open/library/items/ABCD2345?annotation=EFGH6789)";
  const stored = await openDB(name, 2, {
    upgrade(db) {
      db.createObjectStore("scans", { keyPath: "path" });
    },
  });
  await stored.put("scans", {
    path: "draft.md",
    ...makeFile("draft.md", body).stat,
    scannerRevision: SCANNER_REVISION,
    citekeys: [],
    wikilinks: [],
    malformedWikilinks: [],
    malformedAnnotationCitations: [],
    annotations: [
      {
        indexedKey: "EFGH6789",
        attachmentKey: "ABCD2345",
        pageLabel: null,
        form: "labelled",
        text: "label",
        position: {
          start: { line: 0, col: 0, offset: 0 },
          end: { line: 0, col: 65, offset: 65 },
        },
      },
    ],
  });
  stored.close();
  try {
    await using harness = await createCitationIndexHarness(
      { "draft.md": body },
      {
        notes: false,
        openStore: () => openCitekeyStore({ appId } as App),
      },
    );
    expect(harness.index.getAnnotationUses("EFGH6789")).toMatchObject([
      { path: "draft.md", occurrence: { text: "label", form: "labelled" } },
    ]);
    harness.workspace.layoutReady();
    await harness.index.whenIndexed();
    expect(harness.vault.reads).toEqual([]);
  } finally {
    await deleteDB(name);
  }
});

it("keeps uses current through edits, identical touches, renames and deletion (#1692)", async () => {
  const body = "[](zotero://open/library/items/ABCD2345?annotation=EFGH6789)";
  await using harness = await createCitationIndexHarness(
    {
      "draft.md": body,
      "other.md": body,
    },
    { notes: false },
  );
  const { index, draft, metadataCache, vault, workspace } = harness;
  workspace.layoutReady();
  await index.whenIndexed();
  const changes: string[] = [];
  index.on("changed", (path) => changes.push(path));

  metadataCache.change(draft, body);
  await index.getDocumentCitationSet(draft);
  expect(changes).toEqual([]);

  metadataCache.change(
    draft,
    "[new](zotero://open/library/items/ABCD2345?annotation=EFGH6789)",
  );
  await index.getDocumentCitationSet(draft);
  expect(changes).toEqual(["draft.md"]);
  expect(index.getAnnotationUses("EFGH6789")).toMatchObject([
    {
      path: "draft.md",
      occurrence: {
        form: "labelled",
        text: "new",
        position: {
          start: { line: 0, col: 0, offset: 0 },
          end: { line: 0, col: 63, offset: 63 },
        },
      },
    },
    { path: "other.md", occurrence: { form: "citation", text: "" } },
  ]);

  metadataCache.change(
    draft,
    "[](zotero://open/library/items/ABCD2345?annotation=NEXT2345)",
  );
  await index.getDocumentCitationSet(draft);
  expect(index.getAnnotationUses("EFGH6789")).toMatchObject([
    { path: "other.md" },
  ]);
  expect(index.getAnnotationUses("NEXT2345")).toMatchObject([
    { path: "draft.md", occurrence: { text: "", form: "citation" } },
  ]);

  vault.rename(draft, "renamed.md");
  expect(index.getAnnotationUses("NEXT2345")).toMatchObject([
    { path: "renamed.md" },
  ]);
  vault.deleteFile(draft);
  expect(index.getAnnotationUses("NEXT2345")).toEqual([]);
  expect(index.getAnnotationUses("EFGH6789")).toMatchObject([
    { path: "other.md" },
  ]);
});

it.each([
  [
    "inline code",
    "`[](zotero://open/library/items/ABCD2345?annotation=EFGH6789)`",
  ],
  [
    "fenced code",
    "```\n[](zotero://open/library/items/ABCD2345?annotation=EFGH6789)\n```",
  ],
  [
    "indented code",
    "    [](zotero://open/library/items/ABCD2345?annotation=EFGH6789)",
  ],
  [
    "inline math",
    "$x [](zotero://open/library/items/ABCD2345?annotation=EFGH6789)$",
  ],
  [
    "display math",
    "$$\n[](zotero://open/library/items/ABCD2345?annotation=EFGH6789)\n$$",
  ],
  [
    "comment",
    "%% [](zotero://open/library/items/ABCD2345?annotation=EFGH6789) %%",
  ],
  [
    "frontmatter",
    "---\nlink: '[](zotero://open/library/items/ABCD2345?annotation=EFGH6789)'\n---",
  ],
])("excludes Annotation links inside %s (#1692)", async (_name, hidden) => {
  await using harness = await createCitationIndexHarness(
    {
      "draft.md": `${hidden}\n\n[visible](zotero://open/library/items/ABCD2345?annotation=NEXT2345)`,
    },
    { notes: false },
  );
  harness.workspace.layoutReady();
  await harness.index.whenIndexed();
  expect(harness.index.getAnnotationUses("EFGH6789")).toEqual([]);
  expect(harness.index.getAnnotationUses("NEXT2345")).toMatchObject([
    { path: "draft.md", occurrence: { form: "labelled", text: "visible" } },
  ]);
});

it("separates personal and group Annotation keys and restores their uses before backfill (#1692)", async () => {
  const documents = {
    "z.md": "[](zotero://open/library/items/ABCD2345?annotation=EFGH6789)",
    "a.md": "[](zotero://open/groups/42/items/ABCD2345?annotation=EFGH6789)",
  };
  await using first = await createCitationIndexHarness(documents, {
    notes: false,
  });
  first.workspace.layoutReady();
  await first.index.whenIndexed();
  await using restored = await createCitationIndexHarness(documents, {
    notes: false,
    store: first.store,
  });
  expect(restored.index.getAnnotationUses("EFGH6789")).toMatchObject([
    { path: "z.md" },
  ]);
  expect(restored.index.getAnnotationUses("EFGH6789g42")).toEqual([
    {
      path: "a.md",
      occurrence: {
        indexedKey: "EFGH6789g42",
        attachmentKey: "ABCD2345",
        pageLabel: null,
        form: "citation",
        text: "",
        position: {
          start: { line: 0, col: 0, offset: 0 },
          end: { line: 0, col: 62, offset: 62 },
        },
      },
    },
  ]);
  restored.workspace.layoutReady();
  await restored.index.whenIndexed();
  expect(restored.vault.reads).toEqual([]);
});
