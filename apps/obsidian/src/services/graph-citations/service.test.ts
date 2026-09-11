import { settingsOf } from "@mock/obsidian";
import type { ToggleComponent } from "@mock/obsidian";
// @vitest-environment happy-dom
import { Keymap, Menu } from "@mock/obsidian";
import { around } from "monkey-around";
import { PopoverState } from "obsidian";
import type {
  App,
  EventRef,
  GraphColor,
  GraphData,
  GraphDrawnNode,
  GraphLinkSprite,
  GraphOptions,
  HoverPopover,
  WorkspaceLeaf,
} from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import * as m from "@/lib/i18n/generated/messages";
import { themeProperty } from "@/lib/theme-hooks";
import type { CitationOccurrence } from "@/services/citation-index/scan";
import type { CitekeyResolution } from "@/services/citation-index/service";
import { SettingsStub } from "@/services/citation-index/test-harness";
import { CITEKEY_HOVER_SOURCE } from "@/services/citekey-navigation";
import type { NoteIndex } from "@/services/note-index/service";
import { NoteIndexStub } from "@/services/note-index/test-stub";
import type { Settings } from "@/services/settings/schema";

import type { LinkMap } from "./adapter";
import { GraphCitations } from "./service";
import { FakeColorGroupSection, FakeControlSection } from "./test-double";
import { graphNode, themeStates, themeStatesNothing } from "./test-stub";

const DEFAULT_COLOR = { a: 1, rgb: 0xe8622c };

const warn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/log", () => ({
  getLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn }),
}));

const DOE = {
  itemID: 1,
  libraryID: 1,
  key: "DEE23456",
  indexedKey: "DEE23456",
};
const ROE = {
  itemID: 2,
  libraryID: 1,
  key: "REE34567",
  indexedKey: "REE34567",
};
const ROE_GROUP = {
  itemID: 3,
  libraryID: 4,
  key: "REE34567",
  indexedKey: "4_REE34567",
};
/** One Item, in a group library, that has no Literature Note yet. */
const PINE = {
  itemID: 4,
  libraryID: 4,
  key: "PINE2345",
  indexedKey: "PINE2345g4",
};
/** Two more Items with a Literature Note each: Lee is cited, Kay is not. */
const LEE = {
  itemID: 5,
  libraryID: 1,
  key: "LEE56789",
  indexedKey: "LEE56789",
};
const KAY = {
  itemID: 6,
  libraryID: 1,
  key: "KAY23456",
  indexedKey: "KAY23456",
};
/** The key each Item is written as, which a Literature Note node is read by. */
const CITEKEYS: Record<string, string> = {
  DEE23456: "doe2024",
  LEE56789: "lee2019",
  KAY23456: "kay2020",
};
const RESOLUTIONS: Record<string, CitekeyResolution> = {
  doe2024: { kind: "unique", item: DOE },
  pine2023: { kind: "unique", item: PINE },
  roe2025: { kind: "ambiguous", candidates: [ROE, ROE_GROUP] },
  typo2024: { kind: "missing" },
  lee2019: { kind: "unique", item: LEE },
  kay2020: { kind: "unique", item: KAY },
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
  "Roe 2025": "Literature/Roe 2025.md",
  "Literature/Lee 2019": "Literature/Lee 2019.md",
  Other: "Other.md",
};

/** The metadata each node id answers, which a Literature Note is told by. */
const CACHES: Record<string, { frontmatter: Record<string, string> }> = {
  "Literature/Doe 2024.md": { frontmatter: { "zotero-key": "DEE23456" } },
  "Literature/Lee 2019.md": { frontmatter: { "zotero-key": "LEE56789" } },
  "Literature/Kay 2020.md": { frontmatter: { "zotero-key": "KAY23456" } },
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
  readonly colorGroupOptions = new FakeColorGroupSection();
  readonly displayOptions = new FakeControlSection();
  readonly onOptionsChange = vi.fn();
  options: GraphOptions = {};
  app: App;
  throwNext = false;
  /** The engine is the `HoverParent` of the hover its own nodes answer. */
  hoverPopover: HoverPopover | null = null;
  /** The node set one render builds; the native engine builds a fresh one per render. */
  nodes: () => GraphData["nodes"] = () => ({});
  /** The node set of the last hand-off, as the renderer received it. */
  handedOff: GraphData["nodes"] = {};

  constructor(app: App, realApp: App) {
    this.app = app;
    this.renderer = new FakeRenderer();
    this.renderer.onNodeClick = this.onNodeClick.bind(this);
    this.renderer.onNodeRightClick = this.onNodeRightClick.bind(this);
    this.renderer.onNodeHover = this.onNodeHover.bind(this);
    this.renderer.onNodeUnhover = this.onNodeUnhover.bind(this);
    // The native Groups section builds its body in its own constructor.
    this.colorGroupOptions.setColorQueries([]);
    this.#realApp = realApp;
  }

  readonly #realApp: App;

  getOptions(): GraphOptions {
    return {
      ...this.filterOptions.getOptions(),
      ...this.displayOptions.getOptions(),
    };
  }

  setOptions(options: GraphOptions): void {
    this.filterOptions.setOptions(options);
    this.displayOptions.setOptions(options);
    const colorGroups = options.colorGroups;
    if (Array.isArray(colorGroups)) {
      // What the Groups section's own option listener does: rebuild the rows,
      // then ask the engine to run the search again, which saves the options.
      // Obsidian debounces that ask; the fake answers it straight away.
      this.colorGroupOptions.setColorQueries(colorGroups);
      this.onOptionsChange();
    }
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
    const data: GraphData = { nodes: this.nodes() };
    this.renderer.setData(data);
    this.handedOff = data.nodes;
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

  readonly nativeHovers: [string, string][] = [];
  nativeUnhovers = 0;

  onNodeHover(_evt: MouseEvent, id: string, type: string): void {
    this.nativeHovers.push([id, type]);
  }

  onNodeUnhover(): void {
    this.nativeUnhovers += 1;
  }
}

/** World coordinates the fake renderer holds each node at. */
const NODE_POSITIONS: Record<string, { x: number; y: number }> = {
  "@typo2024": { x: 10, y: 20 },
  "Literature/Doe 2024.md": { x: -5, y: 5 },
  "Literature/Lee 2019.md": { x: 0, y: 0 },
  "Literature/Kay 2020.md": { x: 1, y: 1 },
};

class FakeRenderer {
  onNodeClick!: (evt: MouseEvent, id: string, type: string) => void;
  onNodeRightClick!: (evt: MouseEvent, id: string, type: string) => void;
  onNodeHover!: (evt: MouseEvent, id: string, type: string) => void;
  onNodeUnhover!: () => void;
  containerEl = document.createElement("div");
  /** Copied, so a test that takes a node out leaves the fixture as it found it. */
  nodeLookup: Record<string, { x: number; y: number } | undefined> = {
    ...NODE_POSITIONS,
  };
  scale = 2;
  panX = 4;
  panY = 6;
  setData = vi.fn();
  links: FakeLink[] = [];
  /** The node the pointer rests on, which the renderer answers by identity. */
  highlightNode: GraphDrawnNode | null = null;
  /** Whether a frame has been asked for and not yet drawn. */
  pending = false;
  readonly #nodes = new Map<string, GraphDrawnNode>();

  getHighlightNode(): GraphDrawnNode | null {
    return this.highlightNode;
  }

  /** Asks for the frame that draws the graph again. */
  changed(): void {
    this.pending = true;
  }

  /**
   * Gives the renderer one edge per pair, in the direction the link maps
   * state it.
   *
   * @param built whether each edge already owns its line sprite. An edge owns
   *   none until the first frame that draws both its nodes, which is many
   *   frames after the hand-off that named it.
   */
  drawEdges(pairs: readonly (readonly [string, string])[], built = true): void {
    this.links = pairs.map(
      ([source, target]) => new FakeLink(this.node(source), this.node(target)),
    );
    if (built) for (const link of this.links) link.initGraphics();
  }

  /** The one drawn node this id stands for, which a highlight is compared against. */
  node(id: string): GraphDrawnNode {
    const held = this.#nodes.get(id) ?? { id };
    this.#nodes.set(id, held);
    return held;
  }
}

/**
 * One line sprite. `tint` is declared on the class, where the real sprite
 * declares it too — Obsidian 1.14.1 draws its edges as PIXI sprites, whose
 * `tint` is an accessor on the sprite's prototype and whose setter is what
 * colours the line.
 */
class FakeSprite implements GraphLinkSprite {
  #tint = 0;

  get tint(): number {
    return this.#tint;
  }

  set tint(next: number) {
    this.#tint = next;
  }
}

/** One drawn edge, whose line sprite the frames build, clear, and tint. */
class FakeLink {
  /** The sprite behind whatever `line` answers, which a test reads the drawn tint off. */
  readonly sprite: GraphLinkSprite = new FakeSprite();
  line: GraphLinkSprite | null = null;

  constructor(
    readonly source: GraphDrawnNode,
    readonly target: GraphDrawnNode,
  ) {}

  initGraphics(): void {
    this.line = this.sprite;
  }

  clearGraphics(): void {
    this.line = null;
  }
}

/** The tints Obsidian's own frame writes, and the one ZotLit substitutes. */
const NATIVE_LINE = 0x999999;
const NATIVE_HIGHLIGHT = 0xffffff;
const CITATION_LINK = 0x0000ff;

/**
 * Draws the frame the renderer was asked for, if it was asked for one, as
 * Obsidian's own frame draws the edges: each built edge's line takes the link
 * colour, or the highlight colour where the pointer's node is one of its ends.
 * A renderer that was asked for no frame draws nothing and leaves every edge
 * standing in the colour it was last drawn in, which is what an idle graph
 * does.
 *
 * @returns the tint each edge stands drawn in, read off the sprite itself
 *   rather than through whatever stands in front of it.
 */
function paint(renderer: FakeRenderer): Record<string, number> {
  if (renderer.pending) {
    renderer.pending = false;
    for (const link of renderer.links) {
      const highlight = renderer.getHighlightNode();
      const incident = highlight === link.source || highlight === link.target;
      if (link.line) link.line.tint = incident ? NATIVE_HIGHLIGHT : NATIVE_LINE;
    }
  }
  return Object.fromEntries(
    renderer.links.map((link) => [
      `${link.source.id} -> ${link.target.id}`,
      link.sprite.tint,
    ]),
  );
}

/** A fake leaf; `deferred` starts it as Obsidian's placeholder view, with no members until `load()`. */
function fakeLeaf(
  viewType: "graph" | "localgraph",
  app: App,
  realApp: App,
): {
  leaf: WorkspaceLeaf;
  engine: FakeEngine;
  load: () => void;
  /** Closes the view, which is what unloads it and runs what it registered. */
  close: () => void;
  /** What the view still holds for its own unload, in registration order. */
  registered: readonly (() => unknown)[];
} {
  const engine = new FakeEngine(app, realApp);
  /** What the view registered for its own unload, as a `Component` holds it. */
  const registered: (() => unknown)[] = [];
  const shared = {
    app: realApp,
    getViewType: () => viewType,
    renderer: engine.renderer,
    register: (cb: () => unknown) => registered.push(cb),
    getState: () => ({}),
    setState: async (_state: unknown, _result: unknown) => {},
    onOptionsChange: () => {},
    onload: () => {},
  };
  const view =
    viewType === "graph"
      ? { ...shared, dataEngine: engine }
      : {
          ...shared,
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
    close: () => {
      for (const cb of registered.splice(0)) cb();
    },
    registered,
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
  citekeyOf = (indexedKey: string): string | null =>
    CITEKEYS[indexedKey] ?? null;

  on(event: string, cb: () => void): () => void {
    return this.#emitter.on(event, cb);
  }

  emit(event: string): void {
    this.#emitter.emit(event);
  }
}

interface FixtureOptions {
  presentation?: boolean;
  graphEnabled?: boolean;
  /** What the Graph core plugin saved, which the global graph starts from. */
  savedGlobal?: GraphOptions;
  /** Whether the vault-wide Wikilink Citations setting admits the syntax. */
  wikilinkCitations?: boolean;
  /** The vault's own resolved links. */
  links?: LinkMap;
  /** The vault's own unresolved links: the `[[wikilink]]`s that reach no file. */
  unresolved?: LinkMap;
  /** The Note Index's key-to-notes table; Doe's one note by default. */
  notes?: Record<string, { path: string }[]>;
  /** The serialized layout Obsidian restored this session's leaves from. */
  savedLayout?: unknown;
  /** What the vault-wide settings say beyond the Wikilink Citations choice. */
  settings?: Partial<Settings>;
}

function makeFixture(options: FixtureOptions = {}) {
  const listeners = new Map<string, Set<() => void>>();
  const leaves: WorkspaceLeaf[] = [];
  /** What unloads each leaf's view, which is what closing the leaf runs. */
  const closers = new Map<WorkspaceLeaf, () => void>();
  /** What each leaf's view holds for that unload, as a `Component` holds it. */
  const registrations = new Map<WorkspaceLeaf, readonly (() => unknown)[]>();
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
    trigger: vi.fn(),
    requestSaveLayout: vi.fn(),
  };
  const graphPlugin = { options: options.savedGlobal ?? {} };
  const app = {
    workspace,
    viewRegistry: {
      getViewCreatorByType: (type: "graph" | "localgraph") => () => {
        const made = fakeLeaf(type, app, app);
        Object.assign(made.leaf.view, {
          onload: () => made.engine.setOptions(graphPlugin.options),
        });
        return made.leaf.view;
      },
    },
    internalPlugins: {
      getEnabledPluginById: (id: string) =>
        id === "graph" && (options.graphEnabled ?? true) ? graphPlugin : null,
    },
    metadataCache: {
      resolvedLinks: options.links ?? VAULT_LINKS,
      unresolvedLinks: options.unresolved ?? {},
      getCachedFiles: () => [...CACHED_FILES],
      getFirstLinkpathDest: (linkpath: string) => {
        const path = LINK_TARGETS[linkpath];
        return path ? { path } : null;
      },
      getCache: (path: string) => CACHES[path] ?? null,
      getFileCache: ({ path }: { path: string }) => CACHES[path] ?? null,
    },
  } as unknown as App;
  const citationIndex = new CitationIndexStub();
  const noteIndex = new NoteIndexStub(
    options.notes ?? { DEE23456: [{ path: "Literature/Doe 2024.md" }] },
  );
  const settings = new SettingsStub({
    "citation.wikilink-citations": options.wikilinkCitations ?? false,
    ...options.settings,
  });
  const openCitekey = vi.fn(() => Promise.resolve());
  const openIndexedKey = vi.fn(() => Promise.resolve());
  const citationPopover = { show: vi.fn(), showWork: vi.fn(), hide: vi.fn() };
  const service = new GraphCitations({
    app,
    citationIndex,
    // The stub answers plain `{ path }` records where the index answers files.
    noteIndex: noteIndex as unknown as Pick<
      NoteIndex,
      "getIndexedItemKeys" | "getNotesByItemKey" | "on"
    >,
    citekeyEditor: { openCitekey, openIndexedKey },
    citationPopover,
    settings,
  });
  return {
    app,
    service,
    citationIndex,
    noteIndex,
    settings,
    openCitekey,
    openIndexedKey,
    citationPopover,
    /** What a page preview goes out through: `workspace.trigger("hover-link", …)`. */
    trigger: workspace.trigger,
    addLeaf(viewType: "graph" | "localgraph", id = `leaf-${leaves.length}`) {
      const made = fakeLeaf(viewType, app, app);
      if (options.presentation)
        Object.assign(made.engine.options, {
          "zotlit-color-citation-links": true,
          "zotlit-citation-popover": true,
        });
      Object.assign(made.leaf, { id });
      leaves.push(made.leaf);
      closers.set(made.leaf, made.close);
      registrations.set(made.leaf, made.registered);
      return made.engine;
    },
    /** What this leaf's view still holds for its own unload. */
    viewCallbacks(id: string) {
      const leaf = leaves.find((candidate) => candidate.id === id)!;
      return registrations.get(leaf)!;
    },
    /** The leaf `addLeaf` gave this id, which is what a command hands the preset. */
    leaf: (id: string) => leaves.find((candidate) => candidate.id === id)!,
    /**
     * Closes a leaf as Obsidian closes one: the leaf leaves the workspace, so
     * no walk of the live leaves reaches it again, and its view unloads.
     */
    closeLeaf(id: string) {
      const leaf = leaves.find((candidate) => candidate.id === id)!;
      leaves.splice(leaves.indexOf(leaf), 1);
      closers.get(leaf)!();
    },
    /**
     * A leaf in a background tab: its view is Obsidian's placeholder, which
     * carries the state the leaf saved until the leaf loads.
     */
    addDeferredLeaf(viewType: "graph" | "localgraph", saved?: GraphOptions) {
      const made = fakeLeaf(viewType, app, app);
      if (options.presentation)
        Object.assign(made.engine.options, {
          "zotlit-color-citation-links": true,
          "zotlit-citation-popover": true,
        });
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

function makePresentationFixture(options: FixtureOptions = {}) {
  return makeFixture({ ...options, presentation: true });
}

afterEach(() => {
  vi.useRealTimers();
  warn.mockClear();
  themeStatesNothing();
});

describe("GraphCitations installation", () => {
  it("keeps current view choices after the graph feature is toggled off and on", async () => {
    const fixture = makeFixture({
      savedLayout: {
        id: "leaf-0",
        type: "leaf",
        state: {
          type: "graph",
          state: { options: { "zotlit-citation-popover": false } },
        },
      },
    });
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();
    engine.setOptions({ "zotlit-citation-popover": true });
    fixture.settings.update({ "citation.graph-citations": false });
    fixture.settings.update({ "citation.graph-citations": true });
    expect(engine.getOptions()["zotlit-citation-popover"]).toBe(true);
  });

  it("installs before a new view loads and ignores shared presentation choices", async () => {
    const fixture = makeFixture({
      savedGlobal: {
        "zotlit-color-citation-links": true,
        "zotlit-citation-popover": true,
      },
    });
    await using service = fixture.service;
    await service.ready;
    const leaf = { id: "new" } as WorkspaceLeaf;
    const create = fixture.app.viewRegistry!.getViewCreatorByType("graph")!;
    const view = create(leaf);
    Object.assign(leaf, { view });
    view.onload();
    expect(
      (view.getState() as { options: GraphOptions }).options,
    ).toMatchObject({
      "zotlit-color-citation-links": false,
      "zotlit-citation-popover": false,
    });
    await view.setState(
      { options: { "zotlit-citation-popover": true } },
      { history: false },
    );
    expect(
      (view.getState() as { options: GraphOptions }).options,
    ).toMatchObject({
      "zotlit-color-citation-links": false,
      "zotlit-citation-popover": true,
    });
  });

  it("restores independent global graph view states", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const first = fixture.addLeaf("graph", "first");
    fixture.layoutReady();
    first.setOptions({
      "zotlit-color-citation-links": true,
      "zotlit-citation-popover": true,
    });
    const state = fixture.leafState("first");
    expect((state as { options: GraphOptions }).options).toMatchObject({
      "zotlit-color-citation-links": true,
      "zotlit-citation-popover": true,
    });
    const second = fixture.addLeaf("graph", "second");
    fixture.fire("layout-change");
    expect(second.getOptions()).toMatchObject({
      "zotlit-color-citation-links": false,
      "zotlit-citation-popover": false,
    });
    await fixture.leaf("second").view.setState(state, { history: false });
    expect(second.getOptions()).toMatchObject({
      "zotlit-color-citation-links": true,
      "zotlit-citation-popover": true,
    });
    await fixture.leaf("second").view.setState(
      {
        options: {
          "zotlit-color-citation-links": false,
          "zotlit-citation-popover": false,
        },
      },
      { history: false },
    );
    expect(second.getOptions()).toMatchObject({
      "zotlit-color-citation-links": false,
      "zotlit-citation-popover": false,
    });
    expect(first.getOptions()).toMatchObject({
      "zotlit-color-citation-links": true,
      "zotlit-citation-popover": true,
    });
  });

  it("keeps ordinary graphs native until presentation controls are enabled", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const graph = fixture.addLeaf("graph");
    fixture.layoutReady();
    expect(graph.getOptions()).toMatchObject({
      "zotlit-color-citation-links": false,
      "zotlit-citation-popover": false,
    });
    graph.renderer.onNodeHover(
      new MouseEvent("mouseover"),
      "Literature/Doe 2024.md",
      "",
    );
    expect(fixture.citationPopover.showWork).not.toHaveBeenCalled();
    graph.setOptions({ "zotlit-citation-popover": true });
    graph.renderer.onNodeHover(
      new MouseEvent("mouseover"),
      "Literature/Doe 2024.md",
      "",
    );
    expect(fixture.citationPopover.showWork).toHaveBeenCalled();
  });

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
    const fixture = makePresentationFixture();
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
    const fixture = makePresentationFixture();
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

  it.each([false, true])(
    "replaces the hover target when a Literature Note is created and deleted (pointer in popover: %s)",
    async (inPopover) => {
      vi.useFakeTimers();
      const notes: Record<string, { path: string }[]> = {};
      const fixture = makePresentationFixture({ notes });
      await using service = fixture.service;
      await service.ready;
      const engine = fixture.addLeaf("graph");
      fixture.layoutReady();
      const { renderer } = engine;
      renderer.nodeLookup["@doe2024"] = { x: 2, y: 3 };
      renderer.onNodeHover(
        new MouseEvent("mouseover"),
        "@doe2024",
        "unresolved",
      );
      const initial = fixture.citationPopover.showWork.mock.lastCall![0];
      expect(initial.work).toEqual({ kind: "citekey", citekey: "doe2024" });
      const old = fakePopover(initial.targetEl);
      const hide = vi.fn();
      old.hide = hide;
      engine.hoverPopover = old;
      if (inPopover) renderer.onNodeUnhover();
      engine.renderer.onNodeClick(
        new MouseEvent("click"),
        "@doe2024",
        "unresolved",
      );
      expect(fixture.openCitekey).toHaveBeenCalledExactlyOnceWith(
        "doe2024",
        false,
      );

      notes.DEE23456 = [{ path: "Literature/Doe 2024.md" }];
      delete renderer.nodeLookup["@doe2024"];
      fixture.noteIndex.emit("changed");
      await vi.advanceTimersByTimeAsync(400);
      expect(hide).toHaveBeenCalledOnce();
      renderer.onNodeHover(
        new MouseEvent("mouseover"),
        "Literature/Doe 2024.md",
        "",
      );
      const created = fixture.citationPopover.showWork.mock.lastCall![0];
      expect(created.work).toEqual({ kind: "item", indexedKey: "DEE23456" });
      created.open("DEE23456", "tab");
      expect(fixture.openIndexedKey).toHaveBeenCalledExactlyOnceWith(
        "DEE23456",
        "tab",
      );
      const notePopover = fakePopover(created.targetEl);
      const hideNote = vi.fn();
      notePopover.hide = hideNote;
      engine.hoverPopover = notePopover;
      if (inPopover) renderer.onNodeUnhover();

      delete notes.DEE23456;
      delete renderer.nodeLookup["Literature/Doe 2024.md"];
      renderer.nodeLookup["@doe2024"] = { x: 2, y: 3 };
      fixture.noteIndex.emit("changed");
      await vi.advanceTimersByTimeAsync(400);
      expect(hideNote).toHaveBeenCalledOnce();
      renderer.onNodeHover(
        new MouseEvent("mouseover"),
        "@doe2024",
        "unresolved",
      );
      expect(fixture.citationPopover.showWork.mock.lastCall![0].work).toEqual({
        kind: "citekey",
        citekey: "doe2024",
      });
    },
  );

  it("calls through for every other node", async () => {
    const fixture = makePresentationFixture();
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

describe("GraphCitations hovers", () => {
  it("closes citation details when this view's popover control is turned off", async () => {
    const fixture = makePresentationFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    engine.nodes = () => ({ "Literature/Doe 2024.md": graphNode("") });
    fixture.layoutReady();
    engine.renderer.onNodeHover(
      new MouseEvent("mouseover"),
      "Literature/Doe 2024.md",
      "",
    );
    const target = fixture.citationPopover.showWork.mock.calls[0]![0].targetEl;
    const popover = Object.assign(fakePopover(target), { hide: vi.fn() });
    engine.hoverPopover = popover;
    engine.setOptions({ "zotlit-citation-popover": false });
    expect(popover.hide).toHaveBeenCalledOnce();
  });

  it("requires the platform modifier for graph popovers only when enabled", async () => {
    const fixture = makePresentationFixture({
      settings: { "citation.hover-require-mod-graph": true },
    });
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();
    vi.spyOn(Keymap, "isModifier").mockImplementation((event) => event.metaKey);

    hoverEach(engine);
    expect(fixture.citationPopover.showWork).not.toHaveBeenCalled();
    expect(engine.nativeHovers).toEqual([]);
    expect(
      engine.renderer.containerEl.querySelector(".zt-graph-hover-anchor"),
    ).toBeNull();

    engine.renderer.onNodeHover(
      new MouseEvent("mouseover", { metaKey: true }),
      "Literature/Doe 2024.md",
      "",
    );
    expect(fixture.citationPopover.showWork).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        work: { kind: "item", indexedKey: "DEE23456" },
      }),
    );
    engine.renderer.onNodeHover(
      new MouseEvent("mouseover", { metaKey: true }),
      "@typo2024",
      "unresolved",
    );
    expect(fixture.citationPopover.showWork).toHaveBeenCalledTimes(2);

    fixture.citationPopover.showWork.mockClear();
    fixture.settings.update({ "citation.hover-require-mod-graph": false });
    hoverEach(engine);
    expect(fixture.citationPopover.showWork).toHaveBeenCalledTimes(2);
  });

  it("shows the Citation Popover of a Cited Work Node, anchored at the node", async () => {
    const fixture = makePresentationFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    engine.renderer.onNodeHover(
      new MouseEvent("mouseover"),
      "@typo2024",
      "unresolved",
    );

    expect(fixture.citationPopover.showWork).toHaveBeenCalledOnce();
    const request = fixture.citationPopover.showWork.mock.calls[0]![0];
    expect(request).toMatchObject({
      hoverParent: engine,
      work: { kind: "citekey", citekey: "typo2024" },
    });
    expect(request).not.toHaveProperty("sourcePath");
    // The node sits at world (10, 20), drawn at scale 2 with pan (4, 6).
    const anchor = request.targetEl as HTMLElement;
    expect(anchor.parentElement).toBe(engine.renderer.containerEl);
    expect([anchor.style.left, anchor.style.top]).toEqual(["24px", "46px"]);
    expect(engine.nativeHovers).toEqual([]);
  });

  it("shows the Citation Popover of the Item a Literature Note carries", async () => {
    const fixture = makePresentationFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("localgraph");
    fixture.layoutReady();

    engine.renderer.onNodeHover(
      new MouseEvent("mouseover"),
      "Literature/Doe 2024.md",
      "",
    );

    expect(fixture.citationPopover.showWork).toHaveBeenCalledOnce();
    const request = fixture.citationPopover.showWork.mock.calls[0]![0];
    expect(request).toMatchObject({
      work: { kind: "item", indexedKey: "DEE23456" },
    });
    // The node sits at world (-5, 5), drawn at scale 2 with pan (4, 6).
    const anchor = request.targetEl as HTMLElement;
    expect([anchor.style.left, anchor.style.top]).toEqual(["-6px", "16px"]);
    expect(engine.nativeHovers).toEqual([]);
  });

  it("keeps the native hover on every node while the Hover Action is off", async () => {
    const fixture = makePresentationFixture({
      settings: {
        "citation.hover-action": "off",
        "citation.hover-require-mod-graph": true,
      },
    });
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    hoverEach(engine);

    expect(fixture.citationPopover.showWork).not.toHaveBeenCalled();
    expect(engine.nativeHovers).toEqual([
      ["@typo2024", "unresolved"],
      ["Literature/Doe 2024.md", ""],
    ]);
  });

  it("asks for a Literature Note's page preview under the shared citekey source, and shows nothing for a Cited Work Node", async () => {
    const fixture = makePresentationFixture({
      settings: {
        "citation.hover-action": "page-preview",
        "citation.hover-require-mod-graph": true,
      },
    });
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    hoverEach(engine);

    expect(fixture.citationPopover.showWork).not.toHaveBeenCalled();
    // Both node kinds are answered here, so neither reaches the graph's own
    // hover — and with it the graph's row of Obsidian's Page preview settings.
    expect(engine.nativeHovers).toEqual([]);
    expect(fixture.trigger).toHaveBeenCalledExactlyOnceWith(
      "hover-link",
      expect.objectContaining({
        source: CITEKEY_HOVER_SOURCE,
        hoverParent: engine,
        linktext: "Literature/Doe 2024.md",
        sourcePath: "",
      }),
    );
    // The node sits at world (-5, 5), drawn at scale 2 with pan (4, 6).
    const link = fixture.trigger.mock.calls[0]![1] as { targetEl: HTMLElement };
    expect(link.targetEl.parentElement).toBe(engine.renderer.containerEl);
    expect([link.targetEl.style.left, link.targetEl.style.top]).toEqual([
      "-6px",
      "16px",
    ]);
  });

  it("shows the Citation Popover of a Literature Note only a wikilink Citation cites", async () => {
    const fixture = makePresentationFixture({
      wikilinkCitations: true,
      notes: {
        DEE23456: [{ path: "Literature/Doe 2024.md" }],
        LEE56789: [{ path: "Literature/Lee 2019.md" }],
      },
    });
    // Wiki cites Lee by wikilink alone, which adds no edge of its own.
    fixture.citationIndex.wikilinks.set("Notes/Wiki.md", [
      occurrence("Literature/Lee 2019", "wikilink"),
    ]);
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    engine.renderer.onNodeHover(
      new MouseEvent("mouseover"),
      "Literature/Lee 2019.md",
      "",
    );

    expect(fixture.citationPopover.showWork).toHaveBeenCalledOnce();
    expect(fixture.citationPopover.showWork.mock.calls[0]![0]).toMatchObject({
      work: { kind: "item", indexedKey: "LEE56789" },
    });
    expect(engine.nativeHovers).toEqual([]);
  });

  it("shows a source-less popover on a Literature Note no document cites", async () => {
    const fixture = makePresentationFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    engine.renderer.onNodeHover(
      new MouseEvent("mouseover"),
      "Literature/Kay 2020.md",
      "",
    );

    expect(fixture.citationPopover.showWork).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        work: { kind: "item", indexedKey: "KAY23456" },
      }),
    );
    expect(engine.nativeHovers).toEqual([]);
  });

  it("calls through for every other node", async () => {
    const fixture = makePresentationFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    engine.renderer.onNodeHover(new MouseEvent("mouseover"), "Other.md", "");
    engine.renderer.onNodeHover(
      new MouseEvent("mouseover"),
      "missing",
      "unresolved",
    );

    expect(fixture.citationPopover.showWork).not.toHaveBeenCalled();
    expect(engine.nativeHovers).toEqual([
      ["Other.md", ""],
      ["missing", "unresolved"],
    ]);
  });

  it("retires the anchor on the unhover no popover outlives, and keeps it for one that does", async () => {
    const fixture = makePresentationFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    const { containerEl } = engine.renderer;
    fixture.layoutReady();

    engine.renderer.onNodeHover(
      new MouseEvent("mouseover"),
      "@typo2024",
      "unresolved",
    );
    expect(containerEl.children).toHaveLength(1);

    engine.hoverPopover = fakePopover(containerEl.children[0] as HTMLElement);
    engine.renderer.onNodeUnhover();
    expect(containerEl.children).toHaveLength(1);
    expect(engine.nativeUnhovers).toBe(1);

    engine.hoverPopover = null;
    engine.renderer.onNodeUnhover();
    expect(containerEl.children).toHaveLength(0);
    expect(engine.nativeUnhovers).toBe(2);
  });

  it("gives a second hovered node an anchor of its own, so its preview is not read as the first one again", async () => {
    const fixture = makePresentationFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    const { containerEl } = engine.renderer;
    fixture.layoutReady();
    engine.renderer.onNodeHover(
      new MouseEvent("mouseover"),
      "@typo2024",
      "unresolved",
    );
    const first = containerEl.children[0] as HTMLElement;
    // The first popover is still on its way out, so its anchor stays.
    engine.hoverPopover = fakePopover(first);
    engine.renderer.onNodeUnhover();

    engine.renderer.onNodeHover(
      new MouseEvent("mouseover"),
      "Literature/Doe 2024.md",
      "",
    );

    const shown = fixture.citationPopover.showWork.mock.lastCall![0];
    expect(shown.targetEl).not.toBe(first);
    expect(containerEl.children).toHaveLength(2);
  });

  it("lets go of a hold when the hovered graph closes", async () => {
    vi.useFakeTimers();
    const fixture = makePresentationFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph", "hovered");
    const { containerEl } = engine.renderer;
    fixture.layoutReady();
    engine.renderer.onNodeHover(
      new MouseEvent("mouseover"),
      "@typo2024",
      "unresolved",
    );
    const popover = fakePopover();
    engine.hoverPopover = popover;
    vi.advanceTimersByTime(200);
    expect(popover.transition).toHaveBeenCalledOnce();

    // Closing by keyboard leaves the pointer where it was, so nothing
    // unhovers the node on the way out.
    fixture.closeLeaf("hovered");

    popover.onTarget = false;
    vi.advanceTimersByTime(600);
    expect(popover.onTarget).toBe(false);
    expect(popover.transition).toHaveBeenCalledOnce();
    expect(containerEl.children).toHaveLength(0);
    expect(rowNames(engine)).toEqual([]);
  });

  it("lets go of a hold on the window that armed it, after the graph moved to a pop-out", async () => {
    vi.useFakeTimers();
    const fixture = makePresentationFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph", "hovered");
    const { containerEl } = engine.renderer;
    fixture.layoutReady();
    engine.renderer.onNodeHover(
      new MouseEvent("mouseover"),
      "@typo2024",
      "unresolved",
    );
    const popover = fakePopover();
    engine.hoverPopover = popover;
    vi.advanceTimersByTime(200);
    expect(popover.transition).toHaveBeenCalledOnce();

    // The reader moves the graph to a pop-out window: its container answers
    // that window now, and the hold is the main window's still.
    const popout = { clearInterval: vi.fn() };
    Object.defineProperty(containerEl, "win", {
      configurable: true,
      value: popout,
    });
    fixture.closeLeaf("hovered");

    popover.onTarget = false;
    vi.advanceTimersByTime(600);
    expect(popover.onTarget).toBe(false);
    expect(popover.transition).toHaveBeenCalledOnce();
    expect(popout.clearInterval).not.toHaveBeenCalled();
  });

  it("states the popover's target again after Obsidian's sweep drops it, until the pointer leaves", async () => {
    vi.useFakeTimers();
    const fixture = makePresentationFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    engine.renderer.onNodeHover(
      new MouseEvent("mouseover"),
      "@typo2024",
      "unresolved",
    );
    const popover = fakePopover();
    engine.hoverPopover = popover;
    // What Obsidian's own sweep does to a popover it finds no pointer on.
    popover.onTarget = false;
    vi.advanceTimersByTime(200);

    expect(popover.onTarget).toBe(true);
    expect(popover.transition).toHaveBeenCalledOnce();

    popover.onTarget = false;
    engine.renderer.onNodeUnhover();
    vi.advanceTimersByTime(600);

    expect(popover.onTarget).toBe(false);
    expect(popover.transition).toHaveBeenCalledOnce();
  });

  it("stops holding a popover that has hidden, with no unhover of its own", async () => {
    vi.useFakeTimers();
    const fixture = makePresentationFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    engine.renderer.onNodeHover(
      new MouseEvent("mouseover"),
      "@typo2024",
      "unresolved",
    );
    const popover = fakePopover();
    engine.hoverPopover = popover;
    vi.advanceTimersByTime(200);
    expect(popover.transition).toHaveBeenCalledOnce();

    // What Obsidian's own transition leaves behind once the popover is gone.
    Object.assign(popover, { state: PopoverState.Hidden });
    vi.advanceTimersByTime(200);

    // The hold released itself, so a popover shown again is no longer held.
    Object.assign(popover, { state: PopoverState.Shown, onTarget: false });
    vi.advanceTimersByTime(600);

    expect(popover.onTarget).toBe(false);
    expect(popover.transition).toHaveBeenCalledOnce();
  });

  it("waits for a page preview that opens on Obsidian's own delay, then holds it", async () => {
    vi.useFakeTimers();
    const fixture = makePresentationFixture({
      settings: {
        "citation.hover-action": "page-preview",
        "citation.hover-require-mod-graph": true,
      },
    });
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    engine.renderer.onNodeHover(
      new MouseEvent("mouseover"),
      "Literature/Doe 2024.md",
      "",
    );
    // Obsidian's page preview opens well after the hover that asked for it,
    // so the engine carries no popover for the first few beats of the hold.
    vi.advanceTimersByTime(400);
    const popover = fakePopover();
    popover.onTarget = false;
    engine.hoverPopover = popover;
    vi.advanceTimersByTime(200);

    expect(popover.onTarget).toBe(true);
    expect(popover.transition).toHaveBeenCalledOnce();
  });

  it("gives up on a hover no popover ever answers", async () => {
    vi.useFakeTimers();
    const fixture = makePresentationFixture({
      settings: {
        "citation.hover-action": "page-preview",
        "citation.hover-require-mod-graph": true,
      },
    });
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    engine.renderer.onNodeHover(
      new MouseEvent("mouseover"),
      "Literature/Doe 2024.md",
      "",
    );
    // Page preview waits for a held Mod, so a hover without one is answered
    // by nothing at all and the hold has no popover to wait for.
    vi.advanceTimersByTime(2200);
    const popover = fakePopover();
    popover.onTarget = false;
    engine.hoverPopover = popover;
    vi.advanceTimersByTime(600);

    expect(popover.onTarget).toBe(false);
    expect(popover.transition).not.toHaveBeenCalled();
  });

  it("keeps the native hover on a node the renderer holds no place for", async () => {
    const fixture = makePresentationFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();
    delete engine.renderer.nodeLookup["Literature/Doe 2024.md"];

    engine.renderer.onNodeHover(
      new MouseEvent("mouseover"),
      "Literature/Doe 2024.md",
      "",
    );

    expect(fixture.citationPopover.showWork).not.toHaveBeenCalled();
    expect(engine.nativeHovers).toEqual([["Literature/Doe 2024.md", ""]]);
  });

  it("restores both hover members and takes the anchor away on teardown", async () => {
    const fixture = makePresentationFixture();
    const service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    const nativeHover = engine.renderer.onNodeHover;
    const nativeUnhover = engine.renderer.onNodeUnhover;
    fixture.layoutReady();
    engine.renderer.onNodeHover(
      new MouseEvent("mouseover"),
      "@typo2024",
      "unresolved",
    );

    await service[Symbol.asyncDispose]();

    expect(engine.renderer.onNodeHover).toBe(nativeHover);
    expect(engine.renderer.onNodeUnhover).toBe(nativeUnhover);
    expect(engine.renderer.containerEl.children).toHaveLength(0);
  });
});

/** A popover already shown, as the engine holds the one its nodes stand on. */
function fakePopover(targetEl: HTMLElement | null = null): HoverPopover & {
  onTarget: boolean;
  transition: ReturnType<typeof vi.fn>;
} {
  return {
    state: PopoverState.Shown,
    onTarget: true,
    targetEl,
    transition: vi.fn(),
    hide: vi.fn(),
  } as unknown as HoverPopover & {
    onTarget: boolean;
    transition: ReturnType<typeof vi.fn>;
  };
}

/** One hover over a Cited Work Node and one over a Literature Note. */
function hoverEach(engine: FakeEngine): void {
  engine.renderer.onNodeHover(
    new MouseEvent("mouseover"),
    "@typo2024",
    "unresolved",
  );
  engine.renderer.onNodeHover(
    new MouseEvent("mouseover"),
    "Literature/Doe 2024.md",
    "",
  );
}

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

describe("GraphCitations node colours", () => {
  /** Doe's note, two Cited Work Nodes, and a plain note. */
  const nodes = () => ({
    "Literature/Doe 2024.md": graphNode(""),
    "@typo2024": graphNode("unresolved"),
    "@roe2025": graphNode("unresolved"),
    "Draft.md": graphNode(""),
  });
  /**
   * The same set with Doe's note in a user colour group. A colour group can
   * only ever match a node with a file behind it, so the group sits on the
   * Literature Note, never on a Cited Work Node.
   */
  const GROUP = { a: 1, rgb: 0x00ff00 };
  const grouped = () => ({
    ...nodes(),
    "Literature/Doe 2024.md": graphNode("", GROUP),
  });

  it("colors only Cited Work Nodes without a group", async () => {
    themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)");
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    engine.nodes = nodes;

    fixture.layoutReady();

    expect(colorsOf(engine.handedOff)).toEqual({
      "Literature/Doe 2024.md": undefined,
      "@typo2024": { a: 1, rgb: 0x888888 },
      "@roe2025": { a: 1, rgb: 0x888888 },
      "Draft.md": undefined,
    });
  });

  it("leaves a Literature Note the user's colour group matched as the group coloured it", async () => {
    themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)");
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    engine.nodes = grouped;

    fixture.layoutReady();

    expect(colorsOf(engine.handedOff)).toEqual({
      "Literature/Doe 2024.md": GROUP,
      "@typo2024": { a: 1, rgb: 0x888888 },
      "@roe2025": { a: 1, rgb: 0x888888 },
      "Draft.md": undefined,
    });
  });

  it("keeps a Literature Note native while the Pandoc citations row is off", async () => {
    themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)");
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    engine.nodes = nodes;
    fixture.layoutReady();

    rowToggle(engine, m.graph_option_pandoc_citations_name()).toggle(false);

    // The row takes every citekey edge away, and with it every Cited Work
    // Node; a Literature Note is one whatever the rows say.
    expect(colorsOf(engine.handedOff)).toEqual({
      "Literature/Doe 2024.md": undefined,
      "@typo2024": undefined,
      "@roe2025": undefined,
      "Draft.md": undefined,
    });
  });

  it("keeps native colors on a Literature Note only a Wikilink Citation reaches", async () => {
    themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)");
    const fixture = makeFixture({
      wikilinkCitations: true,
      // Reading cites Roe's note by `[[Roe 2025]]` and no citekey reaches it:
      // `roe2025` is ambiguous, so it draws a Cited Work Node of its own.
      notes: {
        DEE23456: [{ path: "Literature/Doe 2024.md" }],
        REE34567: [{ path: "Literature/Roe 2025.md" }],
      },
      links: {
        "Draft.md": { "Other.md": 1 },
        "Reading.md": { "Literature/Roe 2025.md": 1 },
      },
    });
    fixture.citationIndex.wikilinks.set("Reading.md", [
      occurrence("Roe 2025", "wikilink"),
    ]);
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    engine.nodes = () => ({
      ...nodes(),
      "Literature/Roe 2025.md": graphNode(""),
    });

    fixture.layoutReady();

    expect(colorsOf(engine.handedOff)).toEqual({
      "Literature/Doe 2024.md": undefined,
      "Literature/Roe 2025.md": undefined,
      "@typo2024": { a: 1, rgb: 0x888888 },
      "@roe2025": { a: 1, rgb: 0x888888 },
      "Draft.md": undefined,
    });
  });

  it("reads the theme again on a css change and colours the next render from it", async () => {
    vi.useFakeTimers();
    themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)");
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    engine.nodes = nodes;
    fixture.layoutReady();

    document.body.style.setProperty(
      themeProperty.graphLiteratureNote,
      "rgb(0, 0, 255)",
    );
    fixture.fire("css-change");
    vi.runAllTimers();

    expect(engine.renders).toHaveLength(2);
    expect(colorsOf(engine.handedOff)).toEqual({
      "Literature/Doe 2024.md": undefined,
      "@typo2024": { a: 1, rgb: 0x888888 },
      "@roe2025": { a: 1, rgb: 0x888888 },
      "Draft.md": undefined,
    });
  });

  it("hands off the native node set once the feature is off", async () => {
    themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)");
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    engine.nodes = grouped;
    fixture.layoutReady();

    fixture.settings.update({ "citation.graph-citations": false });

    expect(colorsOf(engine.handedOff)).toEqual({
      "Literature/Doe 2024.md": GROUP,
      "@typo2024": undefined,
      "@roe2025": undefined,
      "Draft.md": undefined,
    });
  });
});

function colorsOf(
  nodes: GraphData["nodes"],
): Record<string, GraphColor | null | undefined> {
  return Object.fromEntries(
    Object.entries(nodes).map(([id, node]) => [id, node.color]),
  );
}

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

  it("keeps another plugin's render wrapper when ZotLit is disabled", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();
    const otherPlugin = vi.fn();
    using patches = new DisposableStack();
    patches.defer(
      around(engine, {
        render: (native) =>
          function (this: FakeEngine) {
            otherPlugin();
            return native.call(this);
          },
      }),
    );

    fixture.settings.update({ "citation.graph-citations": false });
    engine.render();

    expect(otherPlugin).toHaveBeenCalledTimes(2);
    expect(engine.renders.at(-1)?.facaded).toBe(false);
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

  it("lets go of what the view holds for its unload once the installation ends", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph", "hovered");
    fixture.layoutReady();
    // What the view would run on its own unload, from the installation the
    // feature going off is about to end.
    const [stale] = fixture.viewCallbacks("hovered");
    fixture.settings.update({ "citation.graph-citations": false });
    fixture.settings.update({ "citation.graph-citations": true });

    stale!();

    // The installation the re-enable made is the service's still, so the next
    // feature-off restores its leaf.
    fixture.settings.update({ "citation.graph-citations": false });
    expect(rowNames(engine)).toEqual([]);
    expect(Object.hasOwn(engine, "render")).toBe(false);
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

/** The rows one section of the panel shows, in the order the user reads them. */
function rowNames(
  engine: FakeEngine,
  section: FakeControlSection = engine.filterOptions,
): string[] {
  return settingsOf(section.childrenEl).map((row) => row.name);
}

function rowToggle(
  engine: FakeEngine,
  name: string,
  section: FakeControlSection = engine.filterOptions,
): ToggleComponent {
  const row = settingsOf(section.childrenEl).find(
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
      m.graph_option_pandoc_citations_name(),
      m.graph_option_citation_connected_only_name(),
    ]);
    expect(engine.getOptions()).toEqual({
      "zotlit-pandoc-citations": true,
      "zotlit-citation-connected-only": false,
      "zotlit-color-citation-links": false,
      "zotlit-citation-popover": false,
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
      m.graph_option_pandoc_citations_name(),
      m.graph_option_wikilink_citations_name(),
      m.graph_option_citation_connected_only_name(),
    ]);

    fixture.settings.update({ "citation.wikilink-citations": false });

    expect(rowNames(engine)).toEqual([
      m.graph_option_pandoc_citations_name(),
      m.graph_option_citation_connected_only_name(),
    ]);
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

    expect(
      rowToggle(
        engine,
        m.graph_option_citation_connected_only_name(),
      ).getValue(),
    ).toBe(true);
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

    expect(
      rowToggle(engine, m.graph_option_pandoc_citations_name()).getValue(),
    ).toBe(false);
    expect(engine.renders.at(-1)).toEqual({
      facaded: true,
      resolved: VAULT_LINKS,
      unresolved: {},
    });
  });

  it("returns the rows to their defaults when the panel restores default settings", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();
    rowToggle(engine, m.graph_option_pandoc_citations_name()).toggle(false);
    rowToggle(engine, m.graph_option_citation_connected_only_name()).toggle(
      true,
    );

    engine.filterOptions.setDefaultOptions();

    expect(engine.getOptions()).toEqual({
      "zotlit-pandoc-citations": true,
      "zotlit-citation-connected-only": false,
      "zotlit-color-citation-links": false,
      "zotlit-citation-popover": false,
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

    rowToggle(engine, m.graph_option_pandoc_citations_name()).toggle(false);

    expect(engine.renders.at(-1)).toEqual({
      facaded: true,
      resolved: VAULT_LINKS,
      unresolved: {},
    });
  });

  it("takes a citing note's own links to narrowed-away targets away with them", async () => {
    const fixture = makeFixture({
      links: { "Draft.md": { "Other.md": 1 } },
      unresolved: { "Draft.md": { todo: 1 } },
    });
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    rowToggle(engine, m.graph_option_citation_connected_only_name()).toggle(
      true,
    );

    // Draft cites, so it survives; Other and todo have no citation of their
    // own, and each would draw a node where Draft's link stands.
    expect(engine.renders.at(-1)!.resolved).toEqual({
      "Draft.md": { "Literature/Doe 2024.md": 1 },
    });
    expect(engine.renders.at(-1)!.unresolved).toEqual({
      "Draft.md": EXPECTED_UNRESOLVED["Draft.md"],
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

    rowToggle(engine, m.graph_option_wikilink_citations_name()).toggle(false);

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

    rowToggle(engine, m.graph_option_citation_connected_only_name()).toggle(
      true,
    );

    expect(fixture.leafState("local-1")).toEqual({
      options: {
        "zotlit-pandoc-citations": true,
        "zotlit-citation-connected-only": true,
        "zotlit-color-citation-links": false,
        "zotlit-citation-popover": false,
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
      m.graph_option_pandoc_citations_name(),
      m.graph_option_wikilink_citations_name(),
      m.graph_option_citation_connected_only_name(),
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

/** Every button the Groups section carries, in the order the panel shows them. */
function groupsButtons(engine: FakeEngine): string[] {
  return [
    ...engine.colorGroupOptions.childrenEl.querySelectorAll("button"),
  ].map((button) => button.textContent ?? "");
}

/** ZotLit's own Groups button. */
function groupsButton(engine: FakeEngine): HTMLButtonElement {
  const buttons = [
    ...engine.colorGroupOptions.childrenEl.querySelectorAll("button"),
  ];
  return buttons.find(
    (button) =>
      button.textContent === m.graph_citations_add_literature_notes_group(),
  )!;
}

describe("GraphCitations Groups button", () => {
  it("adds one literature notes group, keeps the groups the user has, and saves", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();
    const mine = { query: "tag:#paper", color: { a: 1, rgb: 0x00ff00 } };
    engine.colorGroupOptions.setColorQueries([mine]);

    groupsButton(engine).click();

    expect(engine.colorGroupOptions.getColoredQueries()).toEqual([
      mine,
      { query: '["zotero-key"]', color: DEFAULT_COLOR },
    ]);
    expect(engine.onOptionsChange).toHaveBeenCalledOnce();
  });

  it("takes the button away when the feature turns off, and brings it back on", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    fixture.settings.update({ "citation.graph-citations": false });

    expect(groupsButtons(engine)).toEqual(["New group"]);
    expect(Object.hasOwn(engine.colorGroupOptions, "setColorQueries")).toBe(
      false,
    );

    fixture.settings.update({ "citation.graph-citations": true });

    expect(groupsButtons(engine)).toEqual([
      "New group",
      m.graph_citations_add_literature_notes_group(),
    ]);
  });
});

describe("GraphCitations Display row", () => {
  it("prepends controls so native last-row CSS still targets the Animate row", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    const section = engine.displayOptions.childrenEl;
    const arrows = section.createDiv("setting-item");
    const animate = section.createDiv("setting-item");
    fixture.layoutReady();
    expect(section.lastElementChild).toBe(animate);
    expect([...section.children].indexOf(arrows)).toBe(2);
    expect(rowNames(engine, engine.displayOptions)).toEqual([
      m.graph_option_color_citation_links_name(),
      m.graph_option_citation_popover_name(),
    ]);
  });

  it("starts a global graph from its own defaults", async () => {
    const fixture = makeFixture({
      savedGlobal: { "zotlit-color-citation-links": false },
    });
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");

    fixture.layoutReady();

    expect(
      rowToggle(
        engine,
        m.graph_option_color_citation_links_name(),
        engine.displayOptions,
      ).getValue(),
    ).toBe(false);
  });

  it("round-trips through the engine's set options", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    engine.setOptions({ "zotlit-color-citation-links": false });

    expect(engine.getOptions()["zotlit-color-citation-links"]).toBe(false);
    expect(
      rowToggle(
        engine,
        m.graph_option_color_citation_links_name(),
        engine.displayOptions,
      ).getValue(),
    ).toBe(false);
  });

  it("returns to its default when the panel restores default settings", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();
    rowToggle(
      engine,
      m.graph_option_color_citation_links_name(),
      engine.displayOptions,
    ).toggle(true);

    engine.displayOptions.setDefaultOptions();

    expect(engine.getOptions()["zotlit-color-citation-links"]).toBe(false);
    expect(engine.displayOptions.natives).toBe(1);
  });

  it("stays as the user left it while the Filters rows are rebuilt", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();
    rowToggle(
      engine,
      m.graph_option_color_citation_links_name(),
      engine.displayOptions,
    ).toggle(true);

    fixture.settings.update({ "citation.wikilink-citations": true });

    expect(rowNames(engine, engine.displayOptions)).toEqual([
      m.graph_option_color_citation_links_name(),
      m.graph_option_citation_popover_name(),
    ]);
    expect(engine.getOptions()["zotlit-color-citation-links"]).toBe(true);
  });

  it("leaves the Display section as found when the feature turns off", async () => {
    const fixture = makeFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    fixture.layoutReady();

    fixture.settings.update({ "citation.graph-citations": false });

    expect(rowNames(engine, engine.displayOptions)).toEqual([]);
    expect(engine.displayOptions.optionListeners).toEqual({});
    expect(Object.hasOwn(engine.displayOptions, "setDefaultOptions")).toBe(
      false,
    );
  });
});

describe("GraphCitations citation edge colour", () => {
  /** Draft's own link to Other, and two of the edges its citations draw. */
  const EDGES = [
    ["Draft.md", "Other.md"],
    ["Draft.md", "Literature/Doe 2024.md"],
    ["Draft.md", "@typo2024"],
  ] as const;

  /** A graph whose edges are drawn and whose theme states a citation colour. */
  async function drawn(options: FixtureOptions = {}) {
    themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)", "rgb(0, 0, 255)");
    const fixture = makePresentationFixture(options);
    const service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    engine.renderer.drawEdges(EDGES);
    fixture.layoutReady();
    return { fixture, service, engine };
  }

  it("draws the edges a citation named in its own colour and every other edge natively", async () => {
    const { service, engine } = await drawn();
    await using _service = service;

    expect(paint(engine.renderer)).toEqual({
      "Draft.md -> Other.md": NATIVE_LINE,
      "Draft.md -> Literature/Doe 2024.md": CITATION_LINK,
      "Draft.md -> @typo2024": CITATION_LINK,
    });
  });

  it("draws the one line a reciprocal pair shows in the citation colour", async () => {
    themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)", "rgb(0, 0, 255)");
    const fixture = makePresentationFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    // Doe links back to Draft, so Obsidian keeps both edges and draws one:
    // the citation Draft → Doe is the line it hides, and Doe → Draft is the
    // one the reader sees.
    engine.renderer.drawEdges([
      ["Draft.md", "Literature/Doe 2024.md"],
      ["Literature/Doe 2024.md", "Draft.md"],
    ]);
    fixture.layoutReady();

    expect(paint(engine.renderer)).toEqual({
      "Draft.md -> Literature/Doe 2024.md": CITATION_LINK,
      "Literature/Doe 2024.md -> Draft.md": CITATION_LINK,
    });
  });

  it("draws an ordinary edge natively while the citation the other way is out of the render", async () => {
    themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)", "rgb(0, 0, 255)");
    const fixture = makePresentationFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("localgraph");
    // Doe's local graph, showing outgoing links alone: Draft's citation of
    // Doe is no edge of this render, and the link Doe carries back to Draft
    // is the one line there is — an ordinary one.
    engine.renderer.drawEdges([["Literature/Doe 2024.md", "Draft.md"]]);
    fixture.layoutReady();

    expect(paint(engine.renderer)).toEqual({
      "Literature/Doe 2024.md -> Draft.md": NATIVE_LINE,
    });
  });

  it("asks for the frame that draws an edge natively once the citation that drew it is gone", async () => {
    themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)", "rgb(0, 0, 255)");
    const fixture = makePresentationFixture({
      // Draft links Doe the ordinary way too, so the edge outlives the
      // citation the row takes away.
      links: { "Draft.md": { "Literature/Doe 2024.md": 1 } },
    });
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    engine.renderer.drawEdges([["Draft.md", "Literature/Doe 2024.md"]]);
    fixture.layoutReady();
    // The frame the install asked for, so what follows stands on an idle graph.
    expect(paint(engine.renderer)).toEqual({
      "Draft.md -> Literature/Doe 2024.md": CITATION_LINK,
    });

    rowToggle(engine, m.graph_option_pandoc_citations_name()).toggle(false);

    expect(paint(engine.renderer)).toEqual({
      "Draft.md -> Literature/Doe 2024.md": NATIVE_LINE,
    });
  });

  it("asks for the frame that draws an edge in the citation colour once a citation names it", async () => {
    vi.useFakeTimers();
    themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)", "rgb(0, 0, 255)");
    const fixture = makePresentationFixture({
      wikilinkCitations: true,
      links: { "Reading.md": { "Literature/Doe 2024.md": 1 } },
    });
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    engine.renderer.drawEdges([["Reading.md", "Literature/Doe 2024.md"]]);
    fixture.layoutReady();
    expect(paint(engine.renderer)).toEqual({
      "Reading.md -> Literature/Doe 2024.md": NATIVE_LINE,
    });

    // The reader writes the link Reading already carried as a Citation: the
    // edge is the one that was there, drawn in another colour.
    fixture.citationIndex.wikilinks.set("Reading.md", [
      occurrence("Doe 2024", "wikilink"),
    ]);
    fixture.citationIndex.emit("changed");
    vi.advanceTimersByTime(200);

    expect(paint(engine.renderer)).toEqual({
      "Reading.md -> Literature/Doe 2024.md": CITATION_LINK,
    });
  });

  it("leaves a coloured edge answering the one sprite the renderer built", async () => {
    const { service, engine } = await drawn();
    await using _service = service;
    const cited = engine.renderer.links[1]!;

    expect(cited.line).toBe(cited.sprite);
  });

  it("yields to the native highlight on the edges of the node under the pointer", async () => {
    const { service, engine } = await drawn();
    await using _service = service;

    engine.renderer.highlightNode = engine.renderer.node(
      "Literature/Doe 2024.md",
    );

    expect(paint(engine.renderer)).toEqual({
      "Draft.md -> Other.md": NATIVE_LINE,
      "Draft.md -> Literature/Doe 2024.md": NATIVE_HIGHLIGHT,
      "Draft.md -> @typo2024": CITATION_LINK,
    });
  });

  it("draws an edge whose sprite is built after the hand-off, and again after it is destroyed", async () => {
    themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)", "rgb(0, 0, 255)");
    const fixture = makePresentationFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    engine.renderer.drawEdges(EDGES, false);
    fixture.layoutReady();
    const cited = engine.renderer.links[1]!;

    cited.initGraphics();

    expect(paint(engine.renderer)["Draft.md -> Literature/Doe 2024.md"]).toBe(
      CITATION_LINK,
    );

    cited.clearGraphics();
    expect(cited.line).toBeNull();
    cited.initGraphics();

    expect(paint(engine.renderer)["Draft.md -> Literature/Doe 2024.md"]).toBe(
      CITATION_LINK,
    );
  });

  it("draws every edge natively while the row is off", async () => {
    const { service, engine } = await drawn();
    await using _service = service;

    rowToggle(
      engine,
      m.graph_option_color_citation_links_name(),
      engine.displayOptions,
    ).toggle(false);

    expect(paint(engine.renderer)).toEqual({
      "Draft.md -> Other.md": NATIVE_LINE,
      "Draft.md -> Literature/Doe 2024.md": NATIVE_LINE,
      "Draft.md -> @typo2024": NATIVE_LINE,
    });
  });

  it("draws natively the edges the Pandoc citations row took away", async () => {
    const { service, engine } = await drawn();
    await using _service = service;

    rowToggle(engine, m.graph_option_pandoc_citations_name()).toggle(false);

    expect(paint(engine.renderer)).toEqual({
      "Draft.md -> Other.md": NATIVE_LINE,
      "Draft.md -> Literature/Doe 2024.md": NATIVE_LINE,
      "Draft.md -> @typo2024": NATIVE_LINE,
    });
  });

  it("draws a Wikilink Citation the vault already carried in the citation colour", async () => {
    themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)", "rgb(0, 0, 255)");
    const fixture = makePresentationFixture({
      wikilinkCitations: true,
      links: {
        "Reading.md": { "Literature/Doe 2024.md": 1 },
        "Alias.md": { "Literature/Doe 2024.md": 1 },
      },
    });
    fixture.citationIndex.wikilinks.set("Reading.md", [
      occurrence("Doe 2024", "wikilink"),
    ]);
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    engine.renderer.drawEdges([
      ["Reading.md", "Literature/Doe 2024.md"],
      ["Alias.md", "Literature/Doe 2024.md"],
    ]);

    fixture.layoutReady();

    expect(paint(engine.renderer)).toEqual({
      "Reading.md -> Literature/Doe 2024.md": CITATION_LINK,
      "Alias.md -> Literature/Doe 2024.md": NATIVE_LINE,
    });

    fixture.settings.update({ "citation.graph-citations": false });

    expect(paint(engine.renderer)).toEqual({
      "Reading.md -> Literature/Doe 2024.md": NATIVE_LINE,
      "Alias.md -> Literature/Doe 2024.md": NATIVE_LINE,
    });
  });

  it("leaves every edge holding its own sprite on teardown", async () => {
    const { service, engine } = await drawn();
    const cited = engine.renderer.links[1]!;

    await service[Symbol.asyncDispose]();

    expect(cited.line).toBe(cited.sprite);
    expect(paint(engine.renderer)).toEqual({
      "Draft.md -> Other.md": NATIVE_LINE,
      "Draft.md -> Literature/Doe 2024.md": NATIVE_LINE,
      "Draft.md -> @typo2024": NATIVE_LINE,
    });
  });

  it("leaves the edges native when a build moved a renderer member, and says so once", async () => {
    themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)", "rgb(0, 0, 255)");
    const fixture = makePresentationFixture();
    await using service = fixture.service;
    await service.ready;
    const engine = fixture.addLeaf("graph");
    engine.renderer.drawEdges(EDGES);
    // The member is inherited, as the renderer's own is; the build this
    // stands for declares none at all.
    Object.defineProperty(engine.renderer, "getHighlightNode", {
      value: undefined,
      configurable: true,
    });

    fixture.layoutReady();

    const cited = engine.renderer.links[2]!;
    cited.line!.tint = NATIVE_LINE;

    expect(cited.sprite.tint).toBe(NATIVE_LINE);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![1]).toMatchObject({
      missing: ["renderer.getHighlightNode"],
    });
  });
});

/**
 * Seeds the engine's native options and registers the native rows the preset
 * names, the way Obsidian registers them: one option listener per key,
 * reading and writing the engine's options. The row's own re-render and save
 * hang off the toggle's change callback, which the values these tests read do
 * not rest on.
 *
 * The orphans row is the global graph's alone — Obsidian's local Filters
 * section builds none, while its engine defaults still carry `showOrphans`
 * (`app.js` 1.14.1) — so a local graph answers no listener for the key and
 * keeps whatever it started at.
 */
function addNativeRows(
  engine: FakeEngine,
  viewType: "graph" | "localgraph",
): void {
  // Obsidian's own engine defaults, which every graph starts from.
  Object.assign(engine.options, {
    showTags: false,
    showAttachments: false,
    hideUnresolved: false,
    showOrphans: true,
    showArrow: false,
  });
  const rows: [FakeControlSection, string][] = [
    [engine.filterOptions, "showTags"],
    [engine.filterOptions, "showAttachments"],
    [engine.filterOptions, "hideUnresolved"],
    [engine.displayOptions, "showArrow"],
  ];
  if (viewType === "graph") rows.push([engine.filterOptions, "showOrphans"]);
  for (const [section, key] of rows) {
    section.optionListeners[key] = (value?: boolean) => {
      if (value !== undefined) engine.options[key] = value;
      return engine.options[key];
    };
  }
}

/** A graph leaf carrying the native rows, ready for the preset. */
function presetFixture(
  options: FixtureOptions & { viewType?: "graph" | "localgraph" } = {},
) {
  const fixture = makePresentationFixture(options);
  const viewType = options.viewType ?? "graph";
  const engine = fixture.addLeaf(viewType, "preset-leaf");
  addNativeRows(engine, viewType);
  return {
    ...fixture,
    engine,
    leaf: fixture.leaf("preset-leaf"),
    apply: () => fixture.service.applyPreset(fixture.leaf("preset-leaf")),
  };
}

/** What the preset leaves a graph's options at, beside the native keys. */
const PRESET_ROWS = {
  "zotlit-pandoc-citations": true,
  "zotlit-citation-connected-only": true,
  "zotlit-color-citation-links": true,
  "zotlit-citation-popover": true,
};

describe("GraphCitations Citation Graph preset", () => {
  it("presets the global graph, and adds the literature notes group", async () => {
    const fixture = presetFixture();
    await using service = fixture.service;
    await service.ready;
    fixture.layoutReady();

    fixture.apply();

    expect(fixture.engine.options).toMatchObject({
      ...PRESET_ROWS,
      showTags: false,
      showAttachments: false,
      hideUnresolved: false,
      showOrphans: false,
      showArrow: true,
    });
    expect(
      rowToggle(
        fixture.engine,
        m.graph_option_citation_connected_only_name(),
      ).getValue(),
    ).toBe(true);
    expect(fixture.engine.colorGroupOptions.getColoredQueries()).toEqual([
      { query: '["zotero-key"]', color: DEFAULT_COLOR },
    ]);
  });

  it("names the Wikilink citations key only where its row stands", async () => {
    const off = presetFixture();
    await using offService = off.service;
    await offService.ready;
    off.layoutReady();
    off.apply();

    expect(off.engine.options["zotlit-wikilink-citations"]).toBeUndefined();

    const on = presetFixture({ wikilinkCitations: true });
    await using onService = on.service;
    await onService.ready;
    on.layoutReady();
    on.apply();

    expect(on.engine.options["zotlit-wikilink-citations"]).toBe(true);
    expect(
      rowToggle(on.engine, m.graph_option_wikilink_citations_name()).getValue(),
    ).toBe(true);
  });

  it("preserves the user's forces when applying the preset", async () => {
    const fixture = presetFixture();
    await using service = fixture.service;
    await service.ready;
    fixture.layoutReady();
    fixture.engine.options.centerStrength = 0.42;

    fixture.apply();

    expect(fixture.engine.options.centerStrength).toBe(0.42);
  });

  it("leaves the local graph's orphans alone, which its panel has no row for", async () => {
    const fixture = presetFixture({ viewType: "localgraph" });
    await using service = fixture.service;
    await service.ready;
    fixture.layoutReady();

    fixture.apply();

    expect(fixture.engine.options).toMatchObject({
      ...PRESET_ROWS,
      showTags: false,
      showArrow: true,
      // No row answers the key, so the graph keeps Obsidian's own default.
      showOrphans: true,
    });
  });

  it("installs the leaf first, so a graph opened by the command hears ZotLit's keys", async () => {
    const fixture = presetFixture();
    await using service = fixture.service;
    await service.ready;
    // No layout event has reached the service, which is where a command that
    // just opened a leaf stands: Obsidian fires `layout-change` a frame later.
    expect(rowNames(fixture.engine)).toEqual([]);

    fixture.apply();

    expect(rowNames(fixture.engine)).toEqual([
      m.graph_option_pandoc_citations_name(),
      m.graph_option_citation_connected_only_name(),
    ]);
    expect(fixture.engine.options).toMatchObject(PRESET_ROWS);
  });

  it("adds no second literature notes group on a second run", async () => {
    const fixture = presetFixture();
    await using service = fixture.service;
    await service.ready;
    fixture.layoutReady();
    fixture.apply();

    fixture.apply();

    expect(fixture.engine.colorGroupOptions.getColoredQueries()).toEqual([
      { query: '["zotero-key"]', color: DEFAULT_COLOR },
    ]);
  });

  it("leaves a graph whose set-options path moved as Obsidian opened it", async () => {
    const fixture = presetFixture();
    await using service = fixture.service;
    await service.ready;
    fixture.layoutReady();
    warn.mockClear();
    Object.defineProperty(fixture.engine, "setOptions", {
      value: undefined,
      configurable: true,
    });

    fixture.apply();

    expect(fixture.engine.options["zotlit-citation-connected-only"]).toBe(
      false,
    );
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![1]).toMatchObject({
      missing: ["engine.setOptions"],
    });
  });
});
