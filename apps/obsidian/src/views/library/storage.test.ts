// @vitest-environment happy-dom
// The Library View keeps its document in plugin data: a toolbar change in its
// Query View reaches the document there, and the toolbar says when the write
// failed.
import { resetMockPlatform, setMockPlatform } from "@mock/obsidian";
import { Stream } from "effect";
import { Scope } from "obsidian";
import type { App } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";

import { PluginStub } from "@/lib/__fixtures__/obsidian-host";
import { testRuntime } from "@/lib/__fixtures__/runtime";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
import type { QueryViewOutcome } from "@/services/item-query/query-view";
import { annotationReads } from "@/services/pdf-annotation-editor/__fixtures__";
import { buildSettings } from "@/services/settings/__fixtures__";
import { noLiteratureNotes } from "@/views/query-view/__fixtures__/literature-notes";
import { fakeQuery } from "@/views/query-view/__fixtures__/query-run";
import { QueryView } from "@/views/query-view/view";
import type { QueryViewDeps } from "@/views/query-view/view";

import {
  DEFAULT_LIBRARY_VIEW_DOCUMENT,
  libraryViewQuery,
  withCardWidth,
  withExpanded,
  withSelected,
} from "./document";
import type { LibraryViewDocument } from "./document";
import { LibraryViewStorage } from "./storage";

vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));

const LABELS = {
  papers: "Papers",
};

const EMPTY: QueryViewOutcome = {
  kind: "result",
  result: {
    libraries: [{ type: "personal" }],
    query: { filter: null, fields: [], sort: [], limit: null },
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
  card: { allFields: false, annotations: false },
};

/** {@link STORED} as an earlier build wrote it, with a Layout and Visible Properties. */
const STORED_EARLIER = {
  ...STORED,
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
  const app = stubService<App>("App", {});
  const plugin = new PluginStub(app, {
    __VERSION__: 10,
    "library.document": STORED_EARLIER,
  });
  const settings = cleanup.use(
    await buildSettings({
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
  await settings.bridge.runPromise(settings.loaded);
  const saveData = vi.spyOn(plugin, "saveData");
  const runtime = testRuntime();
  const deps = stubService<QueryViewDeps>("QueryViewDeps", {
    runtime,
    bridge: effectBridge(runtime),
    app,
    opener: stubService<QueryViewDeps["opener"]>("TargetOpener", {}),
    reads: stubService<QueryViewDeps["reads"]>("ZoteroReads", {
      changed: Stream.empty,
      degraded: Stream.empty,
      "refresh-failed": Stream.empty,
      refreshing: Stream.empty,
      "db-file-missing": Stream.empty,
      "refresh-requested": Stream.empty,
    }),
    libraryScope: stubService<QueryViewDeps["libraryScope"]>("LibraryScope", {
      changed: Stream.empty,
      "libraries-changed": Stream.empty,
    }),
    query: fakeQuery(() => Promise.resolve(EMPTY)),
    cardFocus: { hold: () => ({ [Symbol.dispose]: () => {} }) },
    annotations: stubService<QueryViewDeps["annotations"]>(
      "AnnotationRepository",
      annotationReads(),
    ),
    excerptDisplay: stubService<QueryViewDeps["excerptDisplay"]>(
      "ExcerptDisplay",
      {},
    ),
    noteFeature: stubService<QueryViewDeps["noteFeature"]>(
      "NoteFeatureHandle",
      {},
    ),
    zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
    libraryTagNames: async () => [],
    allowEditing: vi.fn(),
    reportBlockedGesture: vi.fn(),
    literatureNotes: noLiteratureNotes(),
  });
  // The view's text is the toolbar's, which the storage takes changes from.
  const toolbar = { text: (): string | null => null };
  const storage = new LibraryViewStorage(settings, settings.bridge, () =>
    toolbar.text(),
  );
  storage.load();
  const query = new QueryView(deps, {
    scope: new Scope(),
    sourcePath: () => "",
    context: () => undefined,
    save: () => storage.save(),
  });
  toolbar.text = () => query.document.text;
  const el = document.body.createDiv();
  query.load();
  query.render(el);
  cleanup.defer(() => query.unload());
  await act(async () => {
    query.setText(
      libraryViewQuery(storage.document(), {
        labels: LABELS,
        scope: { mode: "all" },
      }).text,
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
    sort: [{ property: "dateModified", direction: "DESC" }],
    node: {
      kind: "collection",
      library: { type: "personal" },
      path: ["Thesis", "Chapter 2"],
    },
    facets: ["annotated"],
    // The Collection above the selected one opens.
    expanded: [JSON.stringify(["personal", "Thesis"])],
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
  // The stored document, of an earlier build, selected no tags, left no
  // node open but the one above the selected Collection, and no paper.
  expect(saved(plugin)).toEqual({
    ...STORED,
    tags: [],
    expanded: [JSON.stringify(["personal", "Thesis"])],
    selected: null,
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
    query.document.editView({
      sort: [{ property: "title", direction: "ASC" }],
    });
    await query.flush();
  });
  expect(query.state.getState().saveFailed).toBe(true);
  expect(query.state.getState().view?.sort).toEqual([
    { property: "title", direction: "ASC" },
  ]);

  await act(async () => {
    query.document.editView({
      sort: [{ property: "title", direction: "DESC" }],
    });
    await query.flush();
  });
  expect(query.state.getState().saveFailed).toBe(false);
});

it("writes the changes of one task to disk once, holding the last of them", async () => {
  const { plugin, saveData, storage } = await openLibrary();
  saveData.mockClear();
  const reading = JSON.stringify(["personal", "Reading"]);
  await Promise.all([
    storage.change((doc) => withExpanded(doc, [...doc.expanded, reading])),
    storage.change((doc) => withSelected(doc, "1:ABCD2345")),
  ]);
  expect(saveData).toHaveBeenCalledTimes(1);
  expect(saved(plugin)).toMatchObject({
    expanded: [JSON.stringify(["personal", "Thesis"]), reading],
    selected: "1:ABCD2345",
  });
});

it("writes once more after a write that runs, holding the last change asked for meanwhile", async () => {
  const { plugin, saveData, storage } = await openLibrary();
  saveData.mockClear();
  const disk = Promise.withResolvers<void>();
  saveData.mockImplementationOnce(async (data) => {
    await disk.promise;
    plugin.data = data;
  });
  const first = storage.change((doc) => withSelected(doc, "1:AAAA1111"));
  await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(1));
  const rest = [
    storage.change((doc) => withSelected(doc, "1:BBBB2222")),
    storage.change((doc) => withSelected(doc, "1:CCCC3333")),
  ];
  disk.resolve();
  await Promise.all([first, ...rest]);
  expect(saveData).toHaveBeenCalledTimes(2);
  expect(saved(plugin)).toMatchObject({ selected: "1:CCCC3333" });
});

it("writes the Reading Card's width to disk at once, and drops it on a reset", async () => {
  const { plugin, saveData, storage } = await openLibrary();
  saveData.mockClear();
  await storage.change((doc) => withCardWidth(doc, 456));
  expect(saveData).toHaveBeenCalledTimes(1);
  expect(saved(plugin)).toMatchObject({ cardWidth: 456 });
  await storage.change((doc) => withCardWidth(doc, undefined));
  expect(saveData).toHaveBeenCalledTimes(2);
  expect(saved(plugin)).not.toHaveProperty("cardWidth");
  expect(storage.document()).not.toHaveProperty("cardWidth");
});
