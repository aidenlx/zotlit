// @vitest-environment happy-dom
import { Effect } from "effect";
import type { WorkspaceLeaf } from "obsidian";
import { expect, it, vi } from "vitest";

import type { AnnotViewAttachment } from "@zotlit/db";

import { AnnotationView } from "./view";
import type { AnnotViewDeps } from "./view";

class TestView extends AnnotationView {
  close(): Promise<void> {
    return this.onClose();
  }
}

it("settles a pending attachment load without restarting a closed view", async () => {
  const pending = Promise.withResolvers<AnnotViewAttachment[]>();
  const started = Promise.withResolvers<void>();
  const subscribe = vi.fn(() => vi.fn());
  const read = vi.fn(() => Promise.resolve({ annotations: [], source: null }));
  const deps = {
    app: {
      scope: {},
      loadLocalStorage: () => null,
      workspace: { getActiveFile: () => null },
    },
    reads: {
      state: "ready",
      ready: Promise.resolve({
        reads: {
          ItemsByIndexedKeys: () => Effect.succeed(new Map()),
          AnnotViewAttachments: () =>
            Effect.promise(() => {
              started.resolve();
              return pending.promise;
            }),
        },
      }),
    },
    libraryScope: { libraryRows: [] },
    annotations: { on: subscribe, read },
    zoteroPref: { dataDir: "/data" },
  } as unknown as AnnotViewDeps;
  const view = new TestView({} as WorkspaceLeaf, deps);
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => view.close());
  await view.setState(
    { followMode: "pinned", pinnedItemKey: "BKRV2345" },
    { history: false },
  );
  let settled = false;
  const reading = view.read.then(() => {
    settled = true;
  });
  await started.promise;
  expect(settled).toBe(false);
  await view.close();
  pending.resolve([
    {
      itemID: 2,
      indexedKey: "ATTACH23",
      path: "storage:test.pdf",
      annotCount: 0,
    },
  ]);
  await reading;
  expect(subscribe).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});
