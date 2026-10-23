// @vitest-environment happy-dom
import type { EventRef, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { expect, it, vi } from "vitest";

import {
  annotationRows,
  annotationUri,
} from "@/services/citation-index/__fixtures__/annotations";
import {
  createCitationIndexHarness,
  KEY_A,
} from "@/services/citation-index/test-harness";
import { profileReader } from "@/services/profile/__fixtures__/reader";

import { ReferencesView } from "./view";

vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));

class TestReferencesView extends ReferencesView {
  open() {
    return this.onOpen();
  }
  close() {
    return this.onClose();
  }
}

it("#1704 refreshes an Annotation Citation's parent in References after a database change", async () => {
  await using harness = await createCitationIndexHarness(
    { "draft.md": `[](${annotationUri})` },
    { zoteroRows: annotationRows },
  );
  const { app, draft, index, lookup, db, libraryScope } = harness;
  app.workspace.getActiveFile = () => draft;
  app.workspace.on = () => ({}) as EventRef;
  const view = new TestReferencesView({} as WorkspaceLeaf, {
    app,
    db,
    libraryScope,
    citationIndex: index,
    citationLookup: lookup,
    citationText: { peek: () => null, on: () => () => {} },
    citekeyEditor: { openIndexedKey: async () => {} },
    profile: profileReader(harness.settings.current, app.metadataCache),
    pandocEngine: {
      getStatus: () => ({ kind: "absent" }),
      subscribe: () => () => {},
      decline: () => {},
    },
    bibliographyRender: {
      vaultPresentation: { styleId: null, locale: null },
      render: async () => ({ kind: "unavailable", reason: "engine-absent" }),
      on: () => () => {},
    },
    openSettings: () => {},
    openStyleSettings: () => {},
  });
  try {
    document.body.append(view.contentEl);
    await act(() => view.open());
    expect((await index.getDocumentCitationSet(draft)).citations).toMatchObject(
      [{ indexedKey: KEY_A }],
    );
    await expect.poll(() => view.contentEl.textContent).toContain("doe2024");
    await act(() =>
      db.replaceRows(
        `${annotationRows}\nupdate itemAnnotations set parentItemID = 20 where itemID = 11;`,
      ),
    );
    expect((await index.getDocumentCitationSet(draft)).citations).toMatchObject(
      [{ indexedKey: "NCKEY234" }],
    );
    await expect
      .poll(() => view.contentEl.textContent)
      .toContain("Study without a citation key");
    expect(view.contentEl.textContent).not.toContain("doe2024");
  } finally {
    await act(() => view.close());
    view.contentEl.remove();
  }
});
