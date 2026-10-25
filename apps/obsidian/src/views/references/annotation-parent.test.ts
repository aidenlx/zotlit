// @vitest-environment happy-dom
import { Effect, Layer, Stream } from "effect";
import type { EventRef, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import {
  beforeEach as beforeStreamTest,
  afterEach as afterStreamTest,
} from "vitest";
import { expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { buildRuntime } from "@/lib/effect-layer";
import {
  annotationRows,
  annotationUri,
} from "@/services/citation-index/__fixtures__/annotations";
import {
  createCitationIndexHarness,
  KEY_A,
} from "@/services/citation-index/test-harness";
import type { ManagedBinaryApi } from "@/services/managed-binary/service";
import { profileReader } from "@/services/profile/__fixtures__/reader";

import { ReferencesView } from "./view";

let streamStack: AsyncDisposableStack;
let streamRuntime: ReturnType<typeof buildRuntime<never>>;
beforeStreamTest(() => {
  streamStack = new AsyncDisposableStack();
  streamRuntime = buildRuntime(Layer.empty, streamStack);
});
afterStreamTest(() => streamStack.disposeAsync());

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
    {
      zoteroRows: annotationRows,
      settings: { "citation.annotation-citations": true },
    },
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
    runtime: streamRuntime,
    citationText: { peek: () => null, changed: Stream.empty },
    citekeyEditor: { openIndexedKey: async () => {} },
    profile: profileReader(
      () => harness.settingsBridge.runSync(harness.settings.current),
      app.metadataCache,
    ),
    pandocEngine: {
      binary: stubService<ManagedBinaryApi<Disposable | AsyncDisposable>>(
        "PandocEngine",
        {
          getStatus: () => Effect.succeed({ kind: "absent" }),
          changes: Stream.empty,
          decline: () => Effect.void,
        },
      ),
      runSync: Effect.runSync,
    },
    bibliographyRender: {
      vaultPresentation: { styleId: null, locale: null },
      render: async () => ({ kind: "unavailable", reason: "engine-absent" }),
      changed: Stream.empty,
      settled: Stream.empty,
      invalidated: Stream.empty,
      "style-missing": Stream.empty,
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
