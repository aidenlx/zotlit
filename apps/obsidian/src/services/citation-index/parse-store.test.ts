import "fake-indexeddb/auto";
import { openDB, deleteDB } from "idb";
import type { App } from "obsidian";
import { expect, it } from "vitest";

import { openCitekeyStore } from "./store";
import { createCitationIndexHarness, makeFile } from "./test-harness";

it("discards schema v1 once, then restores current records without a read (#1691)", async () => {
  const appId = crypto.randomUUID();
  const name = `${appId}-zotlit-citation-index`;
  const body = "@doe2024";
  const legacy = await openDB(name, 1, {
    upgrade(db) {
      db.createObjectStore("scans", { keyPath: "path" });
    },
  });
  await legacy.put("scans", {
    path: "draft.md",
    ...makeFile("draft.md", body).stat,
    occurrences: [
      {
        kind: "citekey",
        raw: "old-key",
        position: {
          start: { line: 0, col: 0, offset: 0 },
          end: { line: 0, col: 8, offset: 8 },
        },
      },
    ],
  });
  legacy.close();
  const options = {
    notes: false,
    openStore: () => openCitekeyStore({ appId } as App),
  };
  try {
    {
      await using harness = await createCitationIndexHarness(
        { "draft.md": body },
        options,
      );
      expect(harness.index.citationKeys()).toEqual([]);
      harness.workspace.layoutReady();
      await harness.index.whenIndexed();
      expect(harness.index.citationKeys()).toEqual(["doe2024"]);
    }
    {
      await using restored = await createCitationIndexHarness(
        { "draft.md": body },
        options,
      );
      expect(restored.index.citationKeys()).toEqual(["doe2024"]);
      restored.workspace.layoutReady();
      await restored.index.whenIndexed();
      expect(restored.vault.reads).toEqual([]);
      await restored.index.reset();
      await restored.index.whenIndexed();
      expect(restored.vault.reads).toEqual(["draft.md"]);
    }
  } finally {
    await deleteDB(name);
  }
});
