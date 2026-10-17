// @vitest-environment happy-dom
// The Library View tab runs the query its Library View Document derives: the
// document plugin data holds when the tab opens, and after a toolbar change,
// the same query when the tab opens again.
import { resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";

import {
  createObsidianHost,
  PluginStub,
} from "@/lib/__fixtures__/obsidian-host";
import type {
  QueryViewOutcome,
  QueryViewRequest,
} from "@/services/item-query/query-view";
import { SettingsService } from "@/services/settings/service";

import { LibraryView } from "./view";
import type { LibraryViewDeps } from "./view";

vi.mock("zustand", () => import("../__fixtures__/zustand"));

const EMPTY: QueryViewOutcome = {
  kind: "result",
  result: {
    libraries: [{ type: "personal" }],
    query: {} as never,
    returnedCount: 0,
    matchedCount: 0,
    truncated: false,
    warnings: [],
    rows: [],
  },
};

let cleanup = new AsyncDisposableStack();
afterEach(async () => {
  await cleanup.disposeAsync();
  cleanup = new AsyncDisposableStack();
  document.body.replaceChildren();
});

class OpenView extends LibraryView {
  override readonly containerEl = document.createElement("div");
  open(): Promise<void> {
    return this.onOpen();
  }
  close(): Promise<void> {
    return this.onClose();
  }
}

/** Plugin data with `stored` as its Library View Document, still loading. */
function pluginData(stored?: unknown) {
  setMockPlatform({ isMacOS: true });
  cleanup.defer(resetMockPlatform);
  const host = createObsidianHost({});
  const plugin = new PluginStub(host.app as unknown as App, {
    __VERSION__: 10,
    ...(stored !== undefined && { "library.document": stored }),
  });
  const settings = cleanup.use(
    new SettingsService({
      plugin,
      migrateLegacy: (raw) => raw,
      migrateV1: (raw) => raw,
      migrateV2: (raw) => raw,
      migrateV3: (raw) => raw,
      migrateV4: (raw) => raw,
      migrateV5: (raw) => raw,
      migrateV6: (raw) => raw,
      migrateV7: (raw) => raw,
      migrateV8: (raw) => raw,
      migrateV9: (raw) => raw,
    }),
  );
  const run = vi.fn((_request: QueryViewRequest, _signal: AbortSignal) =>
    Promise.resolve(EMPTY),
  );
  const off = () => () => {};
  const deps = {
    app: {
      ...host.app,
      scope: undefined,
      workspace: { ...host.workspace, leftSplit: null, rightSplit: null },
    },
    reads: { on: off },
    libraryScope: { on: off },
    query: { run },
    cardFocus: { hold: () => ({ [Symbol.dispose]: () => {} }) },
    annotations: { on: off, hold: () => ({ [Symbol.dispose]: () => {} }) },
    settings,
  } as unknown as LibraryViewDeps;
  return { deps, run, settings };
}

/** A Library View tab, opened and settled on its first run. */
async function openTab(deps: LibraryViewDeps) {
  const view = new OpenView(
    {
      app: deps.app,
      getRoot: () => null,
    } as unknown as WorkspaceLeaf,
    deps,
  );
  document.body.append(view.contentEl);
  await act(async () => {
    await view.open();
    await view.query.settled;
  });
  cleanup.defer(() => view.close());
  return view;
}

it("opens on My Library, newest change first, where plugin data holds no document", async () => {
  const { deps, run } = pluginData();
  await openTab(deps);
  expect(run).toHaveBeenCalledTimes(1);
  const [request] = run.mock.calls[0]!;
  expect(request).toMatchObject({
    from: "items",
    libraries: { mode: "selected", libraries: [{ type: "personal" }] },
    sort: [{ field: "dateModified", direction: "desc" }],
  });
  // A large library shows its newest rows; the toolbar says how many match.
  expect(request.limit).toBe(1000);
  expect(request).not.toHaveProperty("filter");
  expect(request).not.toHaveProperty("context");
});

it("opens on the document plugin data holds, once it has loaded", async () => {
  const { deps, run } = pluginData({
    node: {
      kind: "collection",
      library: { type: "group", groupID: 4815 },
      path: ["Thesis", "Chapter 2"],
    },
    facets: [],
    search: "",
    sort: [{ property: "title", direction: "ASC" }],
    layout: "table",
    order: ["title"],
  });
  await openTab(deps);
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]![0]).toMatchObject({
    libraries: {
      mode: "selected",
      libraries: [{ type: "group", groupID: 4815 }],
    },
    filter: 'collections.within("Thesis/Chapter 2")',
    sort: [{ field: "title", direction: "asc" }],
  });
});

it("opens again on a sort the toolbar changed, and runs the query the toolbar ran", async () => {
  const { deps, run } = pluginData();
  const first = await openTab(deps);
  await act(async () => {
    first.query.document.editView({
      sort: [{ property: "title", direction: "ASC" }],
    });
    await first.query.flush();
    await first.query.settled;
  });
  const changed = run.mock.calls.at(-1)![0];
  expect(changed.sort).toEqual([{ field: "title", direction: "asc" }]);
  await act(() => first.close());

  run.mockClear();
  await openTab(deps);
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]![0]).toEqual(changed);
});
