// @vitest-environment happy-dom
import { Effect, Layer, Stream } from "effect";
import type { EventRef, Workspace, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import {
  annotationRows,
  annotationUri,
} from "@/services/citation-index/__fixtures__/annotations";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import { CitationIndex } from "@/services/citation-index/service";
import {
  createCitationIndexHarness,
  harnessApp,
  KEY_A,
} from "@/services/citation-index/test-harness";

import { makeReferencesHost } from "./__fixtures__";
import { ReferencesView } from "./view";

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
  const { draft, index, db } = harness;
  const host = await makeReferencesHost({
    sources: harness.host,
    services: Layer.mergeAll(
      Layer.succeed(CitationIndex, harness.runtime.runSync(CitationIndex)),
      Layer.succeed(
        CitationLookup,
        harness.lookup.runtime.runSync(CitationLookup),
      ),
    ),
    zoteroEvents: Stream.map(db.changed, () => ({ _tag: "changed" as const })),
    render: () =>
      Effect.succeed({ kind: "unavailable", reason: "engine-absent" }),
  });
  harness.workspace.open(draft);
  const app = harnessApp(
    harness.host,
    stubService<Workspace>("Workspace", {
      getActiveFile: () => draft,
      on: () => stubService<EventRef>("EventRef", {}),
    }),
  );
  const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
    updateHeader: vi.fn(),
  });
  Object.defineProperty(leaf, "app", { value: app });
  const view = new TestReferencesView(leaf, {
    app,
    registry: host.registry,
    openSettings: () => {},
    openStyleSettings: () => {},
  });
  try {
    document.body.append(view.contentEl);
    await act(() => view.open());
    expect(
      (await index.bridge.runPromise(index.getDocumentCitationSet(draft)))
        .citations,
    ).toMatchObject([{ indexedKey: KEY_A }]);
    await expect.poll(() => view.contentEl.textContent).toContain("doe2024");
    await act(() =>
      db.replaceRows(
        `${annotationRows}\nupdate itemAnnotations set parentItemID = 20 where itemID = 11;`,
      ),
    );
    expect(
      (await index.bridge.runPromise(index.getDocumentCitationSet(draft)))
        .citations,
    ).toMatchObject([{ indexedKey: "NCKEY234" }]);
    await expect
      .poll(() => view.contentEl.textContent)
      .toContain("Study without a citation key");
    expect(view.contentEl.textContent).not.toContain("doe2024");
  } finally {
    await act(() => view.close());
    view.contentEl.remove();
    await host.close();
  }
});
