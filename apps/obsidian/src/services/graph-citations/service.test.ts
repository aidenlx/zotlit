import { settingsOf } from "@mock/obsidian";
import type { ToggleComponent } from "@mock/obsidian";
// @vitest-environment happy-dom
import { Menu } from "@mock/obsidian";
import type { App, EventRef, GraphOptions, WorkspaceLeaf } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import * as m from "@/lib/i18n/generated/messages";
import type { CitationOccurrence } from "@/services/citation-index/scan";
import type { CitekeyResolution } from "@/services/citation-index/service";
import { SettingsStub } from "@/services/citation-index/test-harness";
import type { NoteIndex } from "@/services/note-index/service";
import { NoteIndexStub } from "@/services/note-index/test-stub";

import type { LinkMap } from "./adapter";
import { GraphCitations } from "./service";
import { FakeControlSection } from "./test-double";

const warn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/log", () => ({
  getLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn }),
}));

const DOE = {
  itemID: 1,
  libraryID: 1,
  key: "DOE00001",
  indexedKey: "DOE00001",
};
const ROE = {
  itemID: 2,
  libraryID: 1,
  key: "ROE00002",
  indexedKey: "ROE00002",
};
const ROE_GROUP = {
  itemID: 3,
  libraryID: 4,
  key: "ROE00002",
  indexedKey: "4_ROE00002",
};
/** One Item, in a group library, that has no Literature Note yet. */
const PINE = {
  itemID: 4,
  libraryID: 4,
  key: "PINE2345",
  indexedKey: "PINE2345g4",
};
const RESOLUTIONS: Record<string, CitekeyResolution> = {
  doe2024: { kind: "unique", item: DOE },
  pine2023: { kind: "unique", item: PINE },
  roe2025: { kind: "ambiguous", candidates: [ROE, ROE_GROUP] },
  typo2024: { kind: "missing" },
};

/** Draft cites Doe (with a Literature Note), a noteless key, an ambiguous key, and a missing key. */
const OCCURRENCES = new Map<string, readonly CitationOccurrence[]>([
  [
    "Draft.md",
    [
      occurrence("doe2024"),
      occurrence("pine2023"),
      occurrence("roe2025"),
      occurrence("typo2024"),
    ],
  ],
]);

/** What each linkpath in the fixture's vault resolves to, as Obsidian answers it. */
const LINK_TARGETS: Record<string, string> = {
  "Doe 2024": "Literature/Doe 2024.md",
  Other: "Other.md",
};

/** The link maps one facaded render of the fixture is expected to see. */
const EXPECTED_RESOLVED = {
  "Draft.md": { "Other.md": 1, "Literature/Doe 2024.md": 1 },
};
const EXPECTED_UNRESOLVED = {
  "Draft.md": { "@pine2023": 1, "@roe2025": 1, "@typo2024": 1 },
};

/** Right-clicks a node; answers the menu ZotLit built for it, or `null` when it built none. */
function rightClick(
  engine: FakeEngine,
  id: string,
  type = "unresolved",
): Menu | null {
  Menu.instances.length = 0;
  engine.renderer.onNodeRightClick(new MouseEvent("contextmenu"), id, type);
  return Menu.instances[0] ?? null;
}

function occurrence(
  raw: string,
  kind: CitationOccurrence["kind"] = "citekey",
): CitationOccurrence {
  return {
    kind,
    raw,
    position: {
      start: { line: 0, col: 0, offset: 0 },
      end: { line: 0, col: 0, offset: 0 },
    },
  };
}

interface RenderRecord {
  facaded: boolean;
  resolved: Record<string, Record<string, number>>;
  unresolved: Record<string, Record<string, number>>;
}

/** The vault's own files, and the link map every fixture starts from. */
const CACHED_FILES = ["Draft.md", "Other.md", "Literature/Doe 2024.md"];
const VAULT_LINKS: LinkMap = { "Draft.md": { "Other.md": 1 } };

/** Stands in for Obsidian's engine: `render` is inherited, reads `app` once, hands off to the renderer. */
class FakeEngine {
  readonly renders: RenderRecord[] = [];
  /** What each render saw as the vault's file list, for the narrowing rows. */
  readonly cachedFiles: string[][] = [];
  readonly renderer: FakeRenderer;
  readonly filterOptions = new FakeControlSection();
  readonly onOptionsChange = vi.fn();
  options: GraphOptions = {};
  app: App;
  throwNext = false;

  constructor(app: App, realApp: App) {
    this.app = app;
    this.renderer = new FakeRenderer();
    this.renderer.onNodeClick = this.onNodeClick.bind(this);
    this.renderer.onNodeRightClick = this.onNodeRightClick.bind(this);
    this.#realApp = realApp;
  }

  readonly #realApp: App;

  getOptions(): GraphOptions {
    return this.filterOptions.getOptions();
  }

  setOptions(options: GraphOptions): void {
    this.filterOptions.setOptions(options);
    this.render();
  }

  render(): number {
    const { metadataCache } = this.app;
    this.renders.push({
      facaded: this.app !== this.#realApp,
      resolved: metadataCache.resolvedLinks,
      unresolved: metadataCache.unresolvedLinks,
    });
    this.cachedFiles.push(metadataCache.getCachedFiles!());
    if (this.throwNext) {
      this.throwNext = false;
      throw new Error("render failed");
    }
    this.renderer.setData({ nodes: {} });
    return 0;
  }

  readonly nativeClicks: [string, string][] = [];

  onNodeClick(_evt: MouseEvent, id: string, type: string): void {
    this.nativeClicks.push([id, type]);
  }

  readonly nativeRightClicks: [string, string][] = [];

  onNodeRightClick(_evt: MouseEvent, id: string, type: string): void {
    this.nativeRightClicks.push([id, type]);
  }
}

class FakeRenderer {
  onNodeClick!: (evt: MouseEvent, id: string, type: string) => void;
  onNodeRightClick!: (evt: MouseEvent, id: string, type: string) => void;
  setData = vi.fn();
}

/** A fake leaf; `deferred` starts it as Obsidian's placeholder view, with no members until `load()`. */
function fakeLeaf(
  viewType: "graph" | "localgraph",
  app: App,
  realApp: App,
): { leaf: WorkspaceLeaf; engine: FakeEngine; load: () => void } {
  const engine = new FakeEngine(app, realApp);
  const view =
    viewType === "graph"
      ? {
          getViewType: () => viewType,
          renderer: engine.renderer,
          dataEngine: engine,
        }
      : {
          getViewType: () => viewType,
          renderer: engine.renderer,
          engine,
          // `LocalGraphView.getState` reports the engine's options, which is
          // how a local graph's rows reach the workspace file.
          getState: () => ({ options: engine.getOptions() }),
        };
  const leaf = { view, isDeferred: false };
  return {
    leaf: leaf as unknown as WorkspaceLeaf,
    engine,
    load: () => {
      leaf.view = view;
      leaf.isDeferred = false;
    },
  };
}

class CitationIndexStub {
  readonly ready = Promise.resolve();
  readonly #emitter =
    createNanoEvents<Record<string, (...args: never[]) => void>>();
  /** What the wikilink syntax adds to {@link OCCURRENCES}, per path. */
  wikilinks = new Map<string, readonly CitationOccurrence[]>();
  citationsByPath = vi.fn((syntaxes: readonly string[]) => {
    if (!syntaxes.includes("wikilink")) return OCCURRENCES;
    const byPath = new Map(OCCURRENCES);
    for (const [path, occurrences] of this.wikilinks) {
      byPath.set(path, [...(byPath.get(path) ?? []), ...occurrences]);
    }
    return byPath as ReadonlyMap<string, readonly CitationOccurrence[]>;
  });
  /** Answers every key `null`, as the index does until its snapshot is warm. */
  cold = false;
  resolveCitekey = (citekey: string): CitekeyResolution | null =>
    this.cold ? null : (RESOLUTIONS[citekey] ?? null);

  on(event: string, cb: () => void): () => void {
    return this.#emitter.on(event, cb);
  }

  emit(event: string): void {
    this.#emitter.emit(event);
  }
}

interface FixtureOptions {
  graphEnabled?: boolean;
  /** What the Graph core plugin saved, which the global graph starts from. */
  savedGlobal?: GraphOptions;
  /** Whether the vault-wide Wikilink Citations setting admits the syntax. */
  wikilinkCitations?: boolean;
  /** The vault's own resolved links. */
  links?: LinkMap;
  /** The serialized layout Obsidian restored this session's leaves from. */
  savedLayout?: unknown;
}

function makeFixture(options: FixtureOptions = {}) {
  const listeners = new Map<string, Set<() => void>>();
  const leaves: WorkspaceLeaf[] = [];
  let layoutReady: (() => void) | undefined;
  const workspace = {
    onLayoutReady(cb: () => void) {
      layoutReady = cb;
    },
    on(name: string, cb: () => void): EventRef {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(cb);
      return { e: workspace, name, cb } as unknown as EventRef;
    },
    offref(ref: EventRef) {
      const { name, cb } = ref as unknown as { name: string; cb: () => void };
      listeners.get(name)?.delete(cb);
    },
    getLeavesOfType: (type: string) =>
      leaves.filter((leaf) => leaf.view.getViewType() === type),
    readWorkspaceFile: () => Promise.resolve(options.savedLayout ?? {}),
  };
  const graphPlugin = { options: options.savedGlobal ?? {} };
  const app = {
    workspace,
    internalPlugins: {
      getEnabledPluginById: (id: string) =>
        id === "graph" && (options.graphEnabled ?? true) ? graphPlugin : null,
    },
    metadataCache: {
      resolvedLinks: options.links ?? VAULT_LINKS,
      unresolvedLinks: {},
      getCachedFiles: () => [...CACHED_FILES],
      getFirstLinkpathDest: (linkpath: string) => {
        const path = LINK_TARGETS[linkpath];
        return path ? { path } : null;
      },
    },
  } as unknown as App;
  const citationIndex = new CitationIndexStub();
  const noteIndex = new NoteIndexStub({
    DOE00001: [{ path: "Literature/Doe 2024.md" }],
  });
  const settings = new SettingsStub({
    "citation.wikilink-citations": options.wikilinkCitations ?? false,
  });
  const openCitekey = vi.fn(() => Promise.resolve());
  const service = new GraphCitations({
    app,
    citationIndex,
    // The stub answers plain `{ path }` records where the index answers files.
    noteIndex: noteIndex as unknown as Pick<
      NoteIndex,
      "getIndexedItemKeys" | "getNotesByItemKey" | "on"
    >,
    citekeyEditor: { openCitekey },
    settings,
  });
  return {
    app,
    service,
    citationIndex,
    noteIndex,
    settings,
    openCitekey,
    addLeaf(viewType: "graph" | "localgraph", id = `leaf-${leaves.length}`) {
      const made = fakeLeaf(viewType, app, app);
      Object.assign(made.leaf, { id });
      leaves.push(made.leaf);
      return made.engine;
    },
    /**
     * A leaf in a background tab: its view is Obsidian's placeholder, which
     * carries the state the leaf saved until the leaf loads.
     */
    addDeferredLeaf(viewType: "graph" | "localgraph", saved?: GraphOptions) {
      const made = fakeLeaf(viewType, app, app);
      Object.assign(made.leaf, {
        id: `leaf-${leaves.length}`,
        view: {
          getViewType: () => viewType,
          getState: () => (saved ? { options: saved } : {}),
        },
        isDeferred: true,
      });
      leaves.push(made.leaf);
      return { engine: made.engine, load: made.load };
    },
    /** What Obsidian would serialize for a leaf, as its view reports it. */
    leafState(id: string) {
      const leaf = leaves.find((candidate) => candidate.id === id);
      return leaf!.view.getState();
    },
    layoutReady: () => layoutReady?.(),
    fire: (name: string) => {
      for (const cb of listeners.get(name) ?? []) cb();
    },
    listenerCount: () =>
      [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

afterEach(() => {
  vi.useRealTimers();
  warn.mockClear();
});

describe("GraphCitations installation", () => {
  it("installs once per renderer across repeated layout events and draws the additions", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const global = fixture.addLeaf("graph");
    const local = fixture.addLeaf("localgraph");

    fixture.layoutReady();
    fixture.fire("layout-change");
    fixture.fire("active-leaf-change");

    for (const engine of [global, local]) {
      expect(engine.renders).toEqual([
        {
          facaded: true,
          resolved: EXPECTED_RESOLVED,
          unresolved: EXPECTED_UNRESOLVED,
        },
      ]);
      expect(engine.app).toBe(fixture.app);
    }
    global.renderer.onNodeClick(new MouseEvent("click"), "Other.md", "");
    expect(global.nativeClicks).toEqual([["Other.md", ""]]);
    // Wikilink occurrences cost a link-cache pass, so a graph that cannot
    // take those edges away does not ask for them.
    expect(fixture.citationIndex.citationsByPath).toHaveBeenCalledWith([
      "citekey",
    ]);
  });

  it("installs a graph opened after layout ready on the next layout change", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    fixture.layoutReady();

    const engine = fixture.addLeaf("graph");
    expect(engine.renders).toEqual([]);
    fixture.fire("layout-change");

    expect(engine.renders).toHaveLength(1);
    expect(engine.renders[0]!.facaded).toBe(true);
  });

  it("restores the real app when the native render throws", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    engine.throwNext = true;
    fixture.citationIndex.emit("backfilled");
    vi.useFakeTimers();
    fixture.citationIndex.emit("changed");
    vi.runAllTimers();

    expect(engine.app).toBe(fixture.app);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "Graph render failed",
      expect.objectContaining({ viewType: "graph" }),
    );
  });

  it("leaves a leaf with a missing member native and reports it once", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    delete (engine.renderer as { onNodeClick?: unknown }).onNodeClick;
    fixture.layoutReady();
    fixture.fire("layout-change");
    fixture.fire("active-leaf-change");

    expect(engine.renders).toEqual([]);
    expect(Object.hasOwn(engine, "render")).toBe(false);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "Graph leaf is missing an internal member; left native",
      { viewType: "graph", missing: ["renderer.onNodeClick"] },
    );
  });

  it("installs nothing while the Graph core plugin is disabled", async () => {
    const fixture = makeFixture({ graphEnabled: false });
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    expect(engine.renders).toEqual([]);
    expect(Object.hasOwn(engine, "render")).toBe(false);
  });

  it("waits for a deferred leaf without a report, then installs on the layout change its load fires", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const { engine, load } = fixture.addDeferredLeaf("localgraph");
    fixture.layoutReady();
    fixture.fire("layout-change");
    fixture.fire("active-leaf-change");

    expect(engine.renders).toEqual([]);
    expect(warn).not.toHaveBeenCalled();

    load();
    fixture.fire("layout-change");

    expect(engine.renders).toEqual([
      {
        facaded: true,
        resolved: EXPECTED_RESOLVED,
        unresolved: EXPECTED_UNRESOLVED,
      },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("GraphCitations clicks", () => {
  it("opens a Cited Work Node through the citekey action and never natively", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    engine.renderer.onNodeClick(
      new MouseEvent("click"),
      "@typo2024",
      "unresolved",
    );

    expect(fixture.openCitekey).toHaveBeenCalledExactlyOnceWith(
      "typo2024",
      false,
    );
    expect(engine.nativeClicks).toEqual([]);
  });

  it("opens an ambiguous Cited Work Node through the citekey action, which offers the candidates", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("localgraph");
    fixture.layoutReady();

    engine.renderer.onNodeClick(
      new MouseEvent("click"),
      "@roe2025",
      "unresolved",
    );

    expect(fixture.openCitekey).toHaveBeenCalledExactlyOnceWith(
      "roe2025",
      false,
    );
    expect(engine.nativeClicks).toEqual([]);
  });

  it("calls through for every other node", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    engine.renderer.onNodeClick(
      new MouseEvent("click"),
      "Literature/Doe 2024.md",
      "",
    );
    engine.renderer.onNodeClick(
      new MouseEvent("click"),
      "missing",
      "unresolved",
    );

    expect(engine.nativeClicks).toEqual([
      ["Literature/Doe 2024.md", ""],
      ["missing", "unresolved"],
    ]);
    expect(fixture.openCitekey).not.toHaveBeenCalled();
  });
});

describe("GraphCitations right-clicks", () => {
  it("offers every action for a Cited Work Node whose key names one item", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    const menu = rightClick(engine, "@pine2023");

    expect(menu?.items.map((item) => item.title)).toEqual([
      m.graph_citations_menu_create_note(),
      m.references_open_in_zotero(),
      m.graph_citations_menu_copy_citekey(),
    ]);
    expect(engine.nativeRightClicks).toEqual([]);

    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    const copied = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    for (const item of menu!.items) item.click();

    expect(fixture.openCitekey).toHaveBeenCalledExactlyOnceWith(
      "pine2023",
      false,
    );
    expect(opened).toHaveBeenCalledExactlyOnceWith(
      "zotero://select/groups/4/items/PINE2345",
    );
    expect(copied).toHaveBeenCalledExactlyOnceWith("pine2023");
  });

  it("leaves out Open in Zotero for an ambiguous key, which names no single item", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("localgraph");
    fixture.layoutReady();

    const menu = rightClick(engine, "@roe2025");

    expect(menu?.items.map((item) => item.title)).toEqual([
      m.graph_citations_menu_create_note(),
      m.graph_citations_menu_copy_citekey(),
    ]);
    menu!.items[0]!.click();
    expect(fixture.openCitekey).toHaveBeenCalledExactlyOnceWith(
      "roe2025",
      false,
    );
  });

  it("offers the citation key alone for a key that names no item", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    const menu = rightClick(engine, "@typo2024");

    expect(menu?.items.map((item) => item.title)).toEqual([
      m.graph_citations_menu_copy_citekey(),
    ]);
    const copied = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    menu!.items[0]!.click();

    expect(copied).toHaveBeenCalledExactlyOnceWith("typo2024");
    expect(fixture.openCitekey).not.toHaveBeenCalled();
  });

  it("offers the create action while the resolution snapshot is cold", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    fixture.citationIndex.cold = true;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    // The key names one Item once the snapshot warms, and the menu cannot read
    // that yet: create shows, and Open in Zotero waits for a named Item.
    const menu = rightClick(engine, "@doe2024");

    expect(menu?.items.map((item) => item.title)).toEqual([
      m.graph_citations_menu_create_note(),
      m.graph_citations_menu_copy_citekey(),
    ]);
    menu!.items[0]!.click();
    expect(fixture.openCitekey).toHaveBeenCalledExactlyOnceWith(
      "doe2024",
      false,
    );
  });

  it("calls through for every node while the additions carry no Cited Work Node", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    fixture.citationIndex.citationsByPath.mockReturnValue(
      new Map<string, readonly CitationOccurrence[]>(),
    );
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    engine.renderer.onNodeClick(
      new MouseEvent("click"),
      "@pine2023",
      "unresolved",
    );

    expect(rightClick(engine, "@pine2023")).toBeNull();
    expect(engine.nativeClicks).toEqual([["@pine2023", "unresolved"]]);
    expect(engine.nativeRightClicks).toEqual([["@pine2023", "unresolved"]]);
    expect(fixture.openCitekey).not.toHaveBeenCalled();
  });

  it("calls through to the native menu for every other node", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    expect(rightClick(engine, "Literature/Doe 2024.md", "")).toBeNull();
    expect(rightClick(engine, "missing", "unresolved")).toBeNull();

    expect(engine.nativeRightClicks).toEqual([
      ["Literature/Doe 2024.md", ""],
      ["missing", "unresolved"],
    ]);
    expect(fixture.openCitekey).not.toHaveBeenCalled();
  });
});

describe("GraphCitations re-rendering", () => {
  it("re-renders every installed leaf once per burst of index events", async () => {
    vi.useFakeTimers();
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const global = fixture.addLeaf("graph");
    const local = fixture.addLeaf("localgraph");
    fixture.layoutReady();

    fixture.citationIndex.emit("changed");
    fixture.citationIndex.emit("changed");
    fixture.citationIndex.emit("backfilled");
    vi.runAllTimers();
    expect(global.renders).toHaveLength(2);
    expect(local.renders).toHaveLength(2);

    for (const event of ["resolution-changed", "membership-changed"]) {
      fixture.citationIndex.emit(event);
      vi.runAllTimers();
    }
    fixture.noteIndex.emit("changed");
    vi.runAllTimers();

    expect(global.renders).toHaveLength(5);
    expect(local.renders).toHaveLength(5);
    expect(global.renders.every((render) => render.facaded)).toBe(true);
  });
});

describe("GraphCitations teardown", () => {
  it("restores every member and draws natively once per leaf when the setting turns off", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const global = fixture.addLeaf("graph");
    const local = fixture.addLeaf("localgraph");
    const nativeClick = global.renderer.onNodeClick;
    const nativeRightClick = global.renderer.onNodeRightClick;
    fixture.layoutReady();
    expect(Object.hasOwn(global, "render")).toBe(true);
    expect(global.renderer.onNodeClick).not.toBe(nativeClick);
    expect(global.renderer.onNodeRightClick).not.toBe(nativeRightClick);

    fixture.settings.update({ "citation.graph-citations": false });

    for (const engine of [global, local]) {
      expect(Object.hasOwn(engine, "render")).toBe(false);
      expect(engine.renders).toHaveLength(2);
      expect(engine.renders[1]).toEqual({
        facaded: false,
        resolved: { "Draft.md": { "Other.md": 1 } },
        unresolved: {},
      });
    }
    expect(global.renderer.onNodeClick).toBe(nativeClick);
    expect(global.renderer.onNodeRightClick).toBe(nativeRightClick);

    fixture.fire("layout-change");
    fixture.citationIndex.emit("backfilled");
    expect(global.renders).toHaveLength(2);
  });

  it("installs again when the setting turns back on", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    const nativeClick = engine.renderer.onNodeClick;
    const nativeRightClick = engine.renderer.onNodeRightClick;
    fixture.layoutReady();
    fixture.settings.update({ "citation.graph-citations": false });
    expect(engine.renderer.onNodeClick).toBe(nativeClick);
    expect(engine.renderer.onNodeRightClick).toBe(nativeRightClick);

    fixture.settings.update({ "citation.graph-citations": true });

    expect(engine.renders).toHaveLength(3);
    expect(engine.renders[2]!.facaded).toBe(true);
    expect(engine.renderer.onNodeClick).not.toBe(nativeClick);
    expect(engine.renderer.onNodeRightClick).not.toBe(nativeRightClick);
  });

  it("restores every member, draws natively once, and unsubscribes on dispose", async () => {
    const fixture = makeFixture();
    const service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    const nativeClick = engine.renderer.onNodeClick;
    const nativeRightClick = engine.renderer.onNodeRightClick;
    fixture.layoutReady();

    await service[Symbol.asyncDispose]();

    expect(Object.hasOwn(engine, "render")).toBe(false);
    expect(engine.renderer.onNodeClick).toBe(nativeClick);
    expect(engine.renderer.onNodeRightClick).toBe(nativeRightClick);
    expect(engine.renders).toHaveLength(2);
    expect(engine.renders[1]!.facaded).toBe(false);
    expect(fixture.listenerCount()).toBe(0);
    fixture.citationIndex.emit("backfilled");
    fixture.noteIndex.emit("changed");
    expect(engine.renders).toHaveLength(2);
  });
});

/** The rows the panel shows, in the order the user reads them. */
function rowNames(engine: FakeEngine): string[] {
  return settingsOf(engine.filterOptions.childrenEl).map((row) => row.name);
}

function rowToggle(engine: FakeEngine, name: string): ToggleComponent {
  const row = settingsOf(engine.filterOptions.childrenEl).find(
    (candidate) => candidate.name === name,
  );
  return row!.components[0] as ToggleComponent;
}

describe("GraphCitations Filters rows", () => {
  it("builds the rows in the Filters section, without the Wikilink row while the vault-wide setting excludes the syntax", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");

    fixture.layoutReady();

    expect(rowNames(engine)).toEqual([
      "Pandoc citations",
      "Citation-connected only",
    ]);
    expect(engine.getOptions()).toEqual({
      "zotlit-pandoc-citations": true,
      "zotlit-citation-connected-only": false,
    });
  });

  it("adds the Wikilink row while the vault-wide setting admits the syntax, and rebuilds the rows when that choice changes", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    fixture.settings.update({ "citation.wikilink-citations": true });

    expect(rowNames(engine)).toEqual([
      "Pandoc citations",
      "Wikilink citations",
      "Citation-connected only",
    ]);

    fixture.settings.update({ "citation.wikilink-citations": false });

    expect(rowNames(engine)).toEqual([
      "Pandoc citations",
      "Citation-connected only",
    ]);
  });

  it("starts the global graph at what the Graph core plugin saved", async () => {
    const fixture = makeFixture({
      savedGlobal: { "zotlit-pandoc-citations": false, showTags: true },
    });
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");

    fixture.layoutReady();

    expect(rowToggle(engine, "Pandoc citations").getValue()).toBe(false);
    expect(engine.renders.at(-1)).toEqual({
      facaded: true,
      resolved: VAULT_LINKS,
      unresolved: {},
    });
  });

  it("starts a local graph at what its leaf carried while deferred", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const { engine, load } = fixture.addDeferredLeaf("localgraph", {
      "zotlit-citation-connected-only": true,
    });
    fixture.layoutReady();

    load();
    fixture.fire("layout-change");

    expect(rowToggle(engine, "Citation-connected only").getValue()).toBe(true);
    expect(engine.cachedFiles.at(-1)).toEqual([
      "Draft.md",
      "Literature/Doe 2024.md",
    ]);
  });

  it("starts a local graph the layout loaded straight away from the workspace file", async () => {
    const fixture = makeFixture({
      savedLayout: {
        main: {
          type: "split",
          children: [
            {
              id: "local-1",
              type: "leaf",
              state: {
                type: "localgraph",
                state: { options: { "zotlit-pandoc-citations": false } },
              },
            },
          ],
        },
      },
    });
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("localgraph", "local-1");

    fixture.layoutReady();

    expect(rowToggle(engine, "Pandoc citations").getValue()).toBe(false);
    expect(engine.renders.at(-1)).toEqual({
      facaded: true,
      resolved: VAULT_LINKS,
      unresolved: {},
    });
  });

  it("round-trips through the engine's set options", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    engine.setOptions({
      "zotlit-pandoc-citations": false,
      "zotlit-citation-connected-only": true,
    });

    expect(engine.getOptions()).toEqual({
      "zotlit-pandoc-citations": false,
      "zotlit-citation-connected-only": true,
    });
    expect(rowToggle(engine, "Pandoc citations").getValue()).toBe(false);
    expect(engine.renders.at(-1)).toEqual({
      facaded: true,
      resolved: VAULT_LINKS,
      unresolved: {},
    });
    expect(engine.cachedFiles.at(-1)).toEqual(["Literature/Doe 2024.md"]);
  });

  it("returns the rows to their defaults when the panel restores default settings", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();
    rowToggle(engine, "Pandoc citations").toggle(false);
    rowToggle(engine, "Citation-connected only").toggle(true);

    engine.filterOptions.setDefaultOptions();

    expect(engine.getOptions()).toEqual({
      "zotlit-pandoc-citations": true,
      "zotlit-citation-connected-only": false,
    });
    expect(engine.filterOptions.natives).toBe(1);
    expect(engine.renders.at(-1)).toEqual({
      facaded: true,
      resolved: EXPECTED_RESOLVED,
      unresolved: EXPECTED_UNRESOLVED,
    });
  });

  it("draws no citation edge while Pandoc citations is off", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    rowToggle(engine, "Pandoc citations").toggle(false);

    expect(engine.renders.at(-1)).toEqual({
      facaded: true,
      resolved: VAULT_LINKS,
      unresolved: {},
    });
  });

  it("takes each note's Wikilink Citations away while that row is off, and leaves every other link to a Literature Note alone", async () => {
    const fixture = makeFixture({
      wikilinkCitations: true,
      links: {
        "Draft.md": { "Other.md": 1 },
        // Reading writes `[[Doe 2024]]`, a Citation; Alias writes
        // `[[Doe 2024|that paper]]` and Heading writes `[[Doe 2024#Notes]]`,
        // which ADR 0022 leaves as ordinary Obsidian links.
        "Reading.md": { "Literature/Doe 2024.md": 1 },
        "Alias.md": { "Literature/Doe 2024.md": 1 },
        "Heading.md": { "Literature/Doe 2024.md": 1 },
      },
    });
    fixture.citationIndex.wikilinks.set("Reading.md", [
      occurrence("Doe 2024", "wikilink"),
    ]);
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    rowToggle(engine, "Wikilink citations").toggle(false);

    expect(engine.renders.at(-1)!.resolved).toEqual({
      "Draft.md": { "Other.md": 1, "Literature/Doe 2024.md": 1 },
      "Reading.md": {},
      "Alias.md": { "Literature/Doe 2024.md": 1 },
      "Heading.md": { "Literature/Doe 2024.md": 1 },
    });
    expect(fixture.citationIndex.citationsByPath).toHaveBeenCalledWith([
      "citekey",
      "wikilink",
    ]);
  });

  it("keeps a local graph's row in the leaf state Obsidian persists", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("localgraph", "local-1");
    fixture.layoutReady();

    rowToggle(engine, "Citation-connected only").toggle(true);

    expect(fixture.leafState("local-1")).toEqual({
      options: {
        "zotlit-pandoc-citations": true,
        "zotlit-citation-connected-only": true,
      },
    });
  });

  it("rebuilds the rows without drawing the graph natively in between", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();
    const drawn = engine.renders.length;

    fixture.settings.update({ "citation.wikilink-citations": true });

    expect(engine.renders.slice(drawn).map((render) => render.facaded)).toEqual(
      [true],
    );
    expect(rowNames(engine)).toEqual([
      "Pandoc citations",
      "Wikilink citations",
      "Citation-connected only",
    ]);
  });

  it("removes every row when the feature turns off", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    fixture.settings.update({ "citation.graph-citations": false });

    expect(rowNames(engine)).toEqual([]);
    expect(engine.filterOptions.optionListeners).toEqual({});
    expect(Object.hasOwn(engine.filterOptions, "setDefaultOptions")).toBe(
      false,
    );
  });
});
