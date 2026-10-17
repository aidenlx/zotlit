// @vitest-environment happy-dom
// The Library View keeps its document in plugin data: a toolbar change in its
// Query View reaches the document there, and the toolbar says when the write
// failed.
import { resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import { Scope } from "obsidian";
import type { App } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";

import {
  createObsidianHost,
  PluginStub,
} from "@/lib/__fixtures__/obsidian-host";
import type { QueryViewOutcome } from "@/services/item-query/query-view";
import { SettingsService } from "@/services/settings/service";
import { QueryView } from "@/views/query-view/view";
import type { QueryViewDeps } from "@/views/query-view/view";

import { DEFAULT_LIBRARY_VIEW_DOCUMENT } from "./document";
import type { LibraryViewDocument } from "./document";
import { libraryViewQuery } from "./query-text";
import { libraryViewStorage } from "./storage";

vi.mock("zustand", () => import("../__fixtures__/zustand"));

const LABELS = { papers: "Papers", creators: "Creators", year: "Year" };

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

/** The document plugin data holds before the view opens. */
const STORED = {
  node: {
    kind: "collection",
    library: { type: "personal" },
    path: ["Thesis", "Chapter 2"],
  },
  facets: ["annotated"],
  search: "",
  sort: [{ property: "dateModified", direction: "DESC" }],
  layout: "table",
  order: ["title", "creators"],
};

let cleanup = new AsyncDisposableStack();
afterEach(async () => {
  await cleanup.disposeAsync();
  cleanup = new AsyncDisposableStack();
  document.body.replaceChildren();
});

/**
 * A Query View hosted as the Library View hosts it: no file and no Query
 * Context, its text derived from the document in plugin data, and its saves
 * written there.
 */
async function openLibrary() {
  setMockPlatform({ isMacOS: true });
  cleanup.defer(resetMockPlatform);
  const host = createObsidianHost({});
  const plugin = new PluginStub(host.app as unknown as App, {
    __VERSION__: 10,
    "library.document": STORED,
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
  await settings.ready;
  const saveData = vi.spyOn(plugin, "saveData");
  const off = () => () => {};
  const deps = {
    app: { ...host.app, scope: undefined },
    reads: { on: off },
    libraryScope: { on: off },
    query: { run: () => Promise.resolve(EMPTY) },
    cardFocus: { hold: () => ({ [Symbol.dispose]: () => {} }) },
    annotations: { on: off, hold: () => ({ [Symbol.dispose]: () => {} }) },
  } as unknown as QueryViewDeps;
  const storage = libraryViewStorage(settings);
  const query = new QueryView(deps, {
    scope: new Scope(),
    sourcePath: () => "",
    context: () => undefined,
    ...storage,
  });
  const el = document.body.createDiv();
  query.load();
  query.render(el);
  cleanup.defer(() => query.unload());
  await act(async () => {
    query.setText(
      libraryViewQuery(storage.document(), { labels: LABELS }).text,
    );
    await query.settled;
  });
  return { query, plugin, saveData, storage };
}

/** The document plugin data holds now. */
const saved = (plugin: PluginStub) =>
  (plugin.data as Record<string, unknown>)["library.document"];

it("reads the document that plugin data holds", async () => {
  const { storage, query } = await openLibrary();
  expect(storage.document()).toEqual<LibraryViewDocument>({
    ...DEFAULT_LIBRARY_VIEW_DOCUMENT,
    node: {
      kind: "collection",
      library: { type: "personal" },
      path: ["Thesis", "Chapter 2"],
    },
    facets: ["annotated"],
    layout: "table",
    order: ["title", "creators"],
  });
  expect(query.state.getState().file?.filters).toEqual({
    and: ['collections.within("Thesis/Chapter 2")', "annotations.length > 0"],
  });
});

it("writes a toolbar change to the document in plugin data at once", async () => {
  const { query, plugin, storage } = await openLibrary();
  await act(async () => {
    query.document.editView({
      sort: [{ property: "title", direction: "ASC" }],
    });
    await query.flush();
  });
  expect(saved(plugin)).toEqual({
    ...STORED,
    sort: [{ property: "title", direction: "ASC" }],
  });
  expect(storage.document().sort).toEqual([
    { property: "title", direction: "ASC" },
  ]);
  expect(query.state.getState().view?.sort).toEqual([
    { property: "title", direction: "ASC" },
  ]);
  expect(query.state.getState().saveFailed).toBe(false);
});

it("says a change is not saved when the write fails, until a later write succeeds", async () => {
  const { query, saveData } = await openLibrary();
  saveData.mockRejectedValueOnce(new Error("disk full"));
  await act(async () => {
    query.document.editView({ order: ["title"] });
    await query.flush();
  });
  expect(query.state.getState().saveFailed).toBe(true);
  expect(query.state.getState().view?.order).toEqual(["title"]);

  await act(async () => {
    query.document.editView({ order: ["title", "date.year"] });
    await query.flush();
  });
  expect(query.state.getState().saveFailed).toBe(false);
});
