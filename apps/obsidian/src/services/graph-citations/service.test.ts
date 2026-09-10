// @vitest-environment happy-dom
import { Menu } from "@mock/obsidian";
import type { App, EventRef, WorkspaceLeaf } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import * as m from "@/lib/i18n/generated/messages";
import type { CitationOccurrence } from "@/services/citation-index/scan";
import type { CitekeyResolution } from "@/services/citation-index/service";
import { SettingsStub } from "@/services/citation-index/test-harness";
import type { NoteIndex } from "@/services/note-index/service";
import { NoteIndexStub } from "@/services/note-index/test-stub";

import { GraphCitations } from "./service";

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

function occurrence(raw: string): CitationOccurrence {
  return {
    kind: "citekey",
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

/** Stands in for Obsidian's engine: `render` is inherited, reads `app` once, hands off to the renderer. */
class FakeEngine {
  readonly renders: RenderRecord[] = [];
  readonly renderer: FakeRenderer;
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

  render(): number {
    const { metadataCache } = this.app;
    this.renders.push({
      facaded: this.app !== this.#realApp,
      resolved: metadataCache.resolvedLinks,
      unresolved: metadataCache.unresolvedLinks,
    });
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
      : { getViewType: () => viewType, renderer: engine.renderer, engine };
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
  citationsByPath = vi.fn(() => OCCURRENCES);
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

function makeFixture(options: { graphEnabled?: boolean } = {}) {
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
  };
  const app = {
    workspace,
    internalPlugins: {
      getEnabledPluginById: (id: string) =>
        id === "graph" && (options.graphEnabled ?? true) ? {} : null,
    },
    metadataCache: {
      resolvedLinks: { "Draft.md": { "Other.md": 1 } },
      unresolvedLinks: {},
    },
  } as unknown as App;
  const citationIndex = new CitationIndexStub();
  const noteIndex = new NoteIndexStub({
    DOE00001: [{ path: "Literature/Doe 2024.md" }],
  });
  const settings = new SettingsStub();
  const openCitekey = vi.fn(() => Promise.resolve());
  const service = new GraphCitations({
    app,
    citationIndex,
    // The stub answers plain `{ path }` records where the index answers files.
    noteIndex: noteIndex as unknown as Pick<
      NoteIndex,
      "getNotesByItemKey" | "on"
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
    addLeaf(viewType: "graph" | "localgraph") {
      const made = fakeLeaf(viewType, app, app);
      leaves.push(made.leaf);
      return made.engine;
    },
    /** A leaf in a background tab: its view is Obsidian's placeholder until `load()`. */
    addDeferredLeaf(viewType: "graph" | "localgraph") {
      const made = fakeLeaf(viewType, app, app);
      Object.assign(made.leaf, {
        view: { getViewType: () => viewType },
        isDeferred: true,
      });
      leaves.push(made.leaf);
      return { engine: made.engine, load: made.load };
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
