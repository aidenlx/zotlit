import { it } from "@effect/vitest";
import { settingsOf } from "@mock/obsidian";
import type { ToggleComponent } from "@mock/obsidian";
// @vitest-environment happy-dom
import { Keymap, Menu } from "@mock/obsidian";
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Logger,
  References,
  Scope,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { around } from "monkey-around";
import { PopoverState, TFile, debounce } from "obsidian";
import type {
  App,
  EventRef,
  GraphColor,
  GraphData,
  GraphDrawnNode,
  GraphLinkSprite,
  GraphOptions,
  GraphTextStyle,
  GraphTextContainer,
  GraphTextDisplay,
  HoverPopover,
  Plugin,
  WorkspaceLeaf,
} from "obsidian";
import { afterEach, describe, expect, vi } from "vitest";
import type { Mock } from "vitest";

import { testEvent } from "@/lib/__fixtures__/event-stream";
import { layerTestObsidianEnv } from "@/lib/__fixtures__/obsidian-env";
import { stubService } from "@/lib/__fixtures__/service-stub";
import type { CliHost } from "@/lib/cli-command";
import * as m from "@/lib/i18n/generated/messages";
import { layerMetadataCacheFrom } from "@/lib/obsidian-metadata-cache";
import { layerWorkspaceFrom } from "@/lib/obsidian-workspace";
import { makePluginHost, PluginHost } from "@/lib/plugin-host";
import { themeProperty } from "@/lib/theme-hooks";
import { CitationLookupStub } from "@/services/citation-index/__fixtures__/citation-lookup";
import { lookupAnswerFor } from "@/services/citation-index/__fixtures__/lookup";
import type { CitationLookupAnswer } from "@/services/citation-index/lookup";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import type { CitationOccurrence } from "@/services/citation-index/scan";
import { CitationIndex } from "@/services/citation-index/service";
import type {
  CitationIndexEvent,
  CitekeyResolution,
} from "@/services/citation-index/service";
import { CitationPopover } from "@/services/citation-popover/service";
import { CitekeyEditor } from "@/services/citekey-editor/service";
import { CITEKEY_HOVER_SOURCE } from "@/services/citekey-navigation";
import type { NavigationPane } from "@/services/citekey-navigation";
import { LibraryScope } from "@/services/library-scope/service";
import {
  cache,
  createNoteHost,
  noteIndexOver,
} from "@/services/note-index/__fixtures__";
import { NoteIndex } from "@/services/note-index/service";
import { settingsFeed } from "@/services/settings/__fixtures__";
import type { Settings } from "@/services/settings/schema";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import type { WorkLabelSource } from "@/services/zotero-reads/rpc";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsEvent } from "@/services/zotero-reads/service";

import type { LinkMap } from "./adapter";
import { GRAPH_CORE_PLUGIN_ID } from "./install";
import { GraphCitations, layerGraphCitations } from "./service";
import { FakeColorGroupSection, FakeControlSection } from "./test-double";
import { graphNode, themeStates, themeStatesNothing } from "./test-stub";

const DEFAULT_COLOR = { a: 1, rgb: 0xe8622c };

const warn = vi.hoisted(() => vi.fn());
// The real Note Index logs through the root logger; keep it.
vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  getLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn }),
}));

/** The keys of each `WorkLabels` read, answered with the rows it returns. */
const labelReads = vi.fn();

/** A row `labelReads` answers: one work's label inputs. */
interface LabelRow {
  key: string;
  primaryCreatorType: string | null;
  creators: WorkLabelSource["creators"];
  fields: { title?: string; shortTitle?: string; date?: string };
}

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
  rendered = Promise.withResolvers<void>();
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
    this.rendered.resolve();
    this.rendered = Promise.withResolvers<void>();
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

/**
 * The interval timers of the window a graph's container answers, which a case
 * advances by hand: the hover hold beats on them, outside Effect's clock.
 */
class FakeWindowTimers {
  readonly devicePixelRatio = window.devicePixelRatio;
  #now = 0;
  #nextId = 1;
  readonly #intervals = new Map<
    number,
    { callback: () => void; every: number; due: number }
  >();

  setInterval(callback: () => void, every: number): number {
    const id = this.#nextId++;
    this.#intervals.set(id, { callback, every, due: this.#now + every });
    return id;
  }

  clearInterval(id: number | undefined): void {
    if (id !== undefined) this.#intervals.delete(id);
  }

  /** Runs each interval due within the next `millis`, in time order. */
  advance(millis: number): void {
    const end = this.#now + millis;
    for (;;) {
      const next = [...this.#intervals.values()].sort(
        (left, right) => left.due - right.due,
      )[0];
      if (!next || next.due > end) break;
      this.#now = next.due;
      next.due += next.every;
      next.callback();
    }
    this.#now = end;
  }
}

/** A container whose `win` is `timers`, as Obsidian's `Node.win` answers its window. */
function containerOn(timers: FakeWindowTimers): HTMLElement {
  const containerEl = document.createElement("div");
  Object.defineProperty(containerEl, "win", {
    configurable: true,
    value: timers,
  });
  return containerEl;
}

class FakeRenderer {
  onNodeClick!: (evt: MouseEvent, id: string, type: string) => void;
  onNodeRightClick!: (evt: MouseEvent, id: string, type: string) => void;
  onNodeHover!: (evt: MouseEvent, id: string, type: string) => void;
  onNodeUnhover!: () => void;
  /** The timers of the window the container answers. */
  readonly timers = new FakeWindowTimers();
  containerEl = containerOn(this.timers);
  /** Copied, so a test that takes a node out leaves the fixture as it found it. */
  nodeLookup: Record<string, { x: number; y: number } | undefined> = {
    ...NODE_POSITIONS,
  };
  scale = 2;
  fTextShowMult: number | undefined = 0;
  panX = 4;
  panY = 6;
  nodes: FakeLabelNode[] = [];
  setData = vi.fn((data: GraphData) => {
    this.nodes = Object.keys(data.nodes).map(
      (id) =>
        this.nodes.find((node) => node.id === id) ?? new FakeLabelNode(id),
    );
  });
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
  const view = stubService<
    import("obsidian").View & {
      dataEngine?: FakeEngine;
      engine?: FakeEngine;
    }
  >(
    "View",
    viewType === "graph"
      ? { ...shared, dataEngine: engine }
      : {
          ...shared,
          engine,
          // `LocalGraphView.getState` reports the engine's options, which is
          // how a local graph's rows reach the workspace file.
          getState: () => ({ options: engine.getOptions() }),
        },
  );
  type MutableLeaf = {
    -readonly [K in keyof WorkspaceLeaf]: WorkspaceLeaf[K];
  } & { isDeferred: boolean };
  const leaf = stubService<MutableLeaf>("WorkspaceLeaf", {
    view,
    isDeferred: false,
  });
  return {
    leaf,
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

/** The Citation Index events the stub publishes; any other name it emits only to the lookup. */
const INDEX_EVENTS = new Set<string>([
  "changed",
  "membership-changed",
  "cited-by-invalidated",
]);

class CitationIndexStub {
  readonly #events = testEvent<CitationIndexEvent>();
  /** The index's events: `changed`, `membership-changed` and `cited-by-invalidated`. */
  readonly events = this.#events.stream;
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
  readonly lookupRequests: string[][] = [];
  #revision = 0;
  readonly lookup = new CitationLookupStub(({ citekeys = [] }) => {
    this.lookupRequests.push([...citekeys]);
    return this.#answer(citekeys);
  });

  emit(event: string): void {
    if (event === "resolution-changed") {
      this.#revision += 1;
      this.lookup.refresh();
    }
    if (event === "changed")
      this.#events.emit({ type: "changed", path: "Draft.md" });
    else if (INDEX_EVENTS.has(event))
      this.#events.emit({
        type: event as "membership-changed" | "cited-by-invalidated",
      });
  }

  get lookupCount(): number {
    return this.lookup.activeObservations;
  }

  #answer(citekeys: readonly string[]): CitationLookupAnswer | null {
    if (this.cold) return null;
    return lookupAnswerFor(citekeys, RESOLUTIONS, `test-${this.#revision}`);
  }
}

interface FixtureOptions {
  presentation?: boolean;
  labelDatabase?: boolean;
  labelLibraryScope?: number[];
  graphEnabled?: boolean;
  /** What the Graph core plugin saved, which the global graph starts from. */
  savedGlobal?: GraphOptions;
  /** Whether the vault-wide Wikilink Citations setting admits the syntax. */
  wikilinkCitations?: boolean;
  /** The vault's own resolved links. */
  links?: LinkMap;
  /** The vault's own unresolved links: the `[[wikilink]]`s that reach no file. */
  unresolved?: LinkMap;
  /** Each Literature Note's path and the Item key it carries; Doe's one note by default. */
  notes?: Record<string, string>;
  /** The serialized layout Obsidian restored this session's leaves from. */
  savedLayout?: unknown;
  /** The workspace file read rejects with this error instead. */
  workspaceFileError?: Error;
  /** What the vault-wide settings say beyond the Wikilink Citations choice. */
  settings?: Partial<Settings>;
  /** What the lookup's `observe` waits for before it answers; nothing by default. */
  observeGate?: Effect.Effect<void>;
}

/** How long the service lets a burst of events settle before it draws again. */
const SETTLE = "150 millis";

/** What a FixtureOptions-built fixture logs at warning level, into `warn`. */
const warnings = Logger.make(({ logLevel, message, fiber }) => {
  if (logLevel !== "Warn") return;
  const [text] = Array.isArray(message) ? message : [message];
  warn(String(text), fiber.getRef(References.CurrentLogAnnotations));
});

/**
 * Graph Citations over fakes of everything it reads, built as the plugin
 * layer builds it on a Scope of the case's own: `unload` closes it, which is
 * the plugin's unload.
 */
const makeFixture = Effect.fnUntraced(function* (options: FixtureOptions = {}) {
  const listeners = new Map<string, Set<(...data: unknown[]) => unknown>>();
  const leaves: WorkspaceLeaf[] = [];
  /** What unloads each leaf's view, which is what closing the leaf runs. */
  const closers = new Map<WorkspaceLeaf, () => void>();
  /** What each leaf's view holds for that unload, as a `Component` holds it. */
  const registrations = new Map<WorkspaceLeaf, readonly (() => unknown)[]>();
  let layoutReady: (() => void) | undefined;
  const trigger = vi.fn();
  const workspace = stubService<App["workspace"]>("Workspace", {
    onLayoutReady(cb: () => void) {
      layoutReady = cb;
    },
    on: ((name: string, cb: (...data: unknown[]) => unknown): EventRef => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(cb);
      return stubService<EventRef>("EventRef", { e: workspace, name, cb });
    }) as App["workspace"]["on"],
    offref(ref: EventRef) {
      const { name, cb } = ref as unknown as {
        name: string;
        cb: (...data: unknown[]) => unknown;
      };
      listeners.get(name)?.delete(cb);
    },
    getLeavesOfType: (type: string) =>
      leaves.filter((leaf) => leaf.view.getViewType() === type),
    readWorkspaceFile: () =>
      options.workspaceFileError
        ? Promise.reject(options.workspaceFileError)
        : Promise.resolve(options.savedLayout ?? {}),
    trigger,
    requestSaveLayout: debounce(() => Promise.resolve()),
  });
  /** The metadata cache's listeners; the tag registers its own, which the graph never fires. */
  const metadataListeners = new Set<EventRef>();
  const graphPlugin = { options: options.savedGlobal ?? {} };
  const app = stubService<App>("App", {
    workspace,
    viewRegistry: stubService<NonNullable<App["viewRegistry"]>>(
      "ViewRegistry",
      {
        getViewCreatorByType: (type: "graph" | "localgraph") => () => {
          const made = fakeLeaf(type, app, app);
          Object.assign(made.leaf.view, {
            onload: () => made.engine.setOptions(graphPlugin.options),
          });
          return made.leaf.view;
        },
      },
    ),
    metadataCache: stubService<App["metadataCache"]>("MetadataCache", {
      resolvedLinks: options.links ?? VAULT_LINKS,
      unresolvedLinks: options.unresolved ?? {},
      getCachedFiles: () => [...CACHED_FILES],
      getFirstLinkpathDest: (linkpath: string, _sourcePath: string) => {
        const path = LINK_TARGETS[linkpath];
        if (!path) return null;
        const file = new TFile();
        file.path = path;
        return file;
      },
      getCache: (path: string) => CACHES[path] ?? null,
      getFileCache: ({ path }: { path: string }) => CACHES[path] ?? null,
      on: (name: string) => {
        const ref = stubService<EventRef>("EventRef", { name });
        metadataListeners.add(ref);
        return ref;
      },
      offref: (ref: EventRef) => {
        metadataListeners.delete(ref);
      },
    }),
  });
  const citationIndex = new CitationIndexStub();
  const notes = createNoteHost(
    Object.fromEntries(
      Object.entries(
        options.notes ?? { "Literature/Doe 2024.md": "DEE23456" },
      ).map(([path, itemKey]) => [path, cache({ itemKey })]),
    ),
    { enabledAtRuntime: true },
  );
  const settings = settingsFeed({
    "citation.wikilink-citations": options.wikilinkCitations ?? false,
    ...options.settings,
  });
  const openCitekey = vi.fn(
    (_citekey: string, _pane: NavigationPane): Effect.Effect<void> =>
      Effect.void,
  );
  const openIndexedKey = vi.fn(
    (_indexedKey: string, _pane: NavigationPane): Effect.Effect<void> =>
      Effect.void,
  );
  const citationPopover = stubService<
    import("@/services/citation-popover/service").CitationPopover["Service"] & {
      showWork: ReturnType<typeof vi.fn>;
    }
  >("CitationPopover", {
    showWork: vi.fn(() => Effect.void),
    hide: vi.fn(() => Effect.void),
  });
  const readsEvents = testEvent<ZoteroReadsEvent>();
  /** One work's label inputs, as the database answers them for a row. */
  const labelSource = (row: LabelRow): [string, WorkLabelSource] => [
    row.key,
    {
      libraryID: 1,
      creators: row.creators,
      primaryCreatorType: row.primaryCreatorType,
      title: row.fields.title ?? null,
      shortTitle: row.fields.shortTitle ?? null,
      date: row.fields.date ?? null,
    },
  ];
  /** The rows `labelReads` answers: at once, or when the promise a case hands it settles. */
  const labelRows = (keys: readonly string[]) =>
    Effect.suspend(() => {
      const rows = labelReads([...keys]) as LabelRow[] | Promise<LabelRow[]>;
      return rows instanceof Promise
        ? Effect.promise(() => rows)
        : Effect.succeed(rows);
    }).pipe(Effect.map((rows) => new Map(rows.map(labelSource))));
  const reads = stubService<ZoteroReads["Service"]["reads"]>("ZoteroReadsApi", {
    WorkLabels: (({
      indexedKeys,
    }: {
      readonly indexedKeys: readonly string[];
    }) =>
      options.labelDatabase
        ? labelRows(indexedKeys)
        : Effect.fail(
            new DbUnavailable({ message: "disconnected" }),
          )) as ZoteroReads["Service"]["reads"]["WorkLabels"],
  });
  const scope = yield* Scope.fork(yield* Effect.scope);
  const context = yield* Layer.buildWithScope(
    layerGraphCitations.pipe(
      Layer.provideMerge(noteIndexOver(notes)),
      Layer.provide(
        Layer.mergeAll(
          layerWorkspaceFrom(workspace),
          layerMetadataCacheFrom(app.metadataCache),
          layerTestObsidianEnv({
            corePlugins: new Set(
              (options.graphEnabled ?? true) ? [GRAPH_CORE_PLUGIN_ID] : [],
            ),
          }),
          Layer.succeed(
            PluginHost,
            makePluginHost(stubService<Plugin & CliHost>("Plugin", { app })),
          ),
          Layer.mock(ZoteroReads, { reads, events: readsEvents.stream }),
          Layer.mock(LibraryScope, {
            current: Effect.succeed({
              mode: "all" as const,
              invalid: false,
              available: (options.labelLibraryScope ?? [1]).map(
                (libraryID) => ({
                  libraryID,
                  name: "Library",
                  selector: { type: "personal" as const },
                }),
              ),
              unavailable: [],
            }),
          }),
          Layer.mock(CitationIndex, {
            events: citationIndex.events,
            changes: Stream.empty,
            citationsByPath: (syntaxes) =>
              Effect.sync(() => citationIndex.citationsByPath(syntaxes)),
          }),
          Layer.mock(CitationLookup, {
            observe: (changed) =>
              (options.observeGate ?? Effect.void).pipe(
                Effect.andThen(
                  Effect.sync(() => citationIndex.lookup.observe(changed)),
                ),
              ),
          }),
          Layer.mock(CitekeyEditor, { openCitekey, openIndexedKey }),
          Layer.mock(CitationPopover, citationPopover),
          settings.layer,
          Logger.layer([warnings]),
        ),
      ),
    ),
    scope,
  );
  const service = Context.get(context, GraphCitations);
  const noteIndex = Context.get(context, NoteIndex);
  yield* noteIndex.whenIndexed;
  const engines: FakeEngine[] = [];
  /** Lets every runnable fiber the case started go on, then lets a burst of events settle. */
  const advance = (millis: number) =>
    Effect.gen(function* () {
      yield* TestClock.adjust(millis);
      for (const engine of engines) engine.renderer.timers.advance(millis);
    });
  /** The first answered frame: the lookup delivers, and the render it asks for draws. */
  const settleLookup = Effect.gen(function* () {
    if (!citationIndex.lookup.pending) return;
    const installed = engines.filter((engine) =>
      Object.hasOwn(engine, "render"),
    );
    // General graph tests start from its first answered frame. The lookup
    // suite tests the pending frame and request-change placeholder directly.
    for (const engine of installed) {
      engine.renders.length = 0;
      engine.cachedFiles.length = 0;
    }
    yield* Effect.promise(() => citationIndex.lookup.settle());
    yield* TestClock.adjust(SETTLE);
  });
  return {
    app,
    service,
    /** Closes the layer, which is the plugin's unload. */
    unload: Scope.close(scope, Exit.void),
    advance,
    settleLookup,
    citationIndex,
    citationLookup: citationIndex.lookup,
    /**
     * The note at `path`, created when the vault holds none, now carries
     * `itemKey`, or no key; completes once the Note Index has read the edit.
     */
    writeNote: (path: string, itemKey: string | undefined) =>
      Effect.gen(function* () {
        const file = notes.vault.files.get(path) ?? notes.vault.addFile(path);
        notes.metadataCache.change(file, cache({ itemKey }));
        yield* noteIndex.whenSettled;
      }),
    settings,
    /** The database's events: `emit("changed")` is a database change. */
    reads: {
      emit: (tag: "changed") => readsEvents.emit({ _tag: tag }),
    },
    openCitekey,
    openIndexedKey,
    citationPopover,
    /** What a page preview goes out through: `workspace.trigger("hover-link", …)`. */
    trigger,
    addLeaf(viewType: "graph" | "localgraph", id = `leaf-${leaves.length}`) {
      const made = fakeLeaf(viewType, app, app);
      engines.push(made.engine);
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
      engines.push(made.engine);
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
    /** The layout is ready, and the first answered frame drawn. */
    layoutReady: Effect.gen(function* () {
      layoutReady?.();
      yield* settleLookup;
    }),
    fire: (name: string) => {
      for (const cb of listeners.get(name) ?? []) cb();
    },
    listenerCount: () =>
      [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
});

function makePresentationFixture(options: FixtureOptions = {}) {
  return makeFixture({ ...options, presentation: true });
}

afterEach(() => {
  warn.mockClear();
  themeStatesNothing();
});

describe("GraphCitations installation", () => {
  // Failure mode: the unload interrupts the first install while it waits for
  // the lookup, and the wrapped render outlives the plugin.
  it.effect(
    "restores the render of a leaf whose first install the unload interrupts",
    () =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const fixture = yield* makeFixture({
          observeGate: Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Effect.never),
          ),
        });
        const engine = fixture.addLeaf("graph");
        const nativeRender = engine.render;
        yield* fixture.layoutReady;
        yield* Deferred.await(entered);

        yield* fixture.unload;

        expect(engine.render).toBe(nativeRender);
      }),
  );

  it.effect(
    "keeps current view choices after the graph feature is toggled off and on",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          savedLayout: {
            id: "leaf-0",
            type: "leaf",
            state: {
              type: "graph",
              state: { options: { "zotlit-citation-popover": false } },
            },
          },
        });
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;
        engine.setOptions({ "zotlit-citation-popover": true });
        fixture.settings.update({ "citation.graph-citations": false });
        fixture.settings.update({ "citation.graph-citations": true });
        expect(engine.getOptions()["zotlit-citation-popover"]).toBe(true);
      }),
  );

  it.effect(
    "installs before a new view loads and ignores shared presentation choices",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          savedGlobal: {
            "zotlit-color-citation-links": true,
            "zotlit-citation-popover": true,
          },
        });
        const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", { id: "new" });
        const create = fixture.app.viewRegistry!.getViewCreatorByType("graph")!;
        const view = create(leaf);
        Object.assign(leaf, { view });
        view.onload();
        expect(
          (view.getState() as { options: GraphOptions }).options,
        ).toMatchObject({
          "zotlit-color-citation-links": false,
          "zotlit-citation-popover": false,
          "zotlit-author-title-labels": false,
        });
        yield* Effect.promise(() =>
          view.setState(
            { options: { "zotlit-citation-popover": true } },
            { history: false },
          ),
        );
        expect(
          (view.getState() as { options: GraphOptions }).options,
        ).toMatchObject({
          "zotlit-color-citation-links": false,
          "zotlit-citation-popover": true,
        });
      }),
  );

  it.effect("restores independent global graph view states", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const first = fixture.addLeaf("graph", "first");
      yield* fixture.layoutReady;
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
        "zotlit-author-title-labels": false,
      });
      yield* Effect.promise(() =>
        fixture.leaf("second").view.setState(state, { history: false }),
      );
      expect(second.getOptions()).toMatchObject({
        "zotlit-color-citation-links": true,
        "zotlit-citation-popover": true,
      });
      yield* Effect.promise(() =>
        fixture.leaf("second").view.setState(
          {
            options: {
              "zotlit-color-citation-links": false,
              "zotlit-citation-popover": false,
              "zotlit-author-title-labels": false,
            },
          },
          { history: false },
        ),
      );
      expect(second.getOptions()).toMatchObject({
        "zotlit-color-citation-links": false,
        "zotlit-citation-popover": false,
        "zotlit-author-title-labels": false,
      });
      expect(first.getOptions()).toMatchObject({
        "zotlit-color-citation-links": true,
        "zotlit-citation-popover": true,
      });
    }),
  );

  it.effect(
    "keeps ordinary graphs native until presentation controls are enabled",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const graph = fixture.addLeaf("graph");
        yield* fixture.layoutReady;
        expect(graph.getOptions()).toMatchObject({
          "zotlit-color-citation-links": false,
          "zotlit-citation-popover": false,
          "zotlit-author-title-labels": false,
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
      }),
  );

  it.effect(
    "installs once per renderer across repeated layout events and draws the additions",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const global = fixture.addLeaf("graph");
        const local = fixture.addLeaf("localgraph");

        yield* fixture.layoutReady;
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
      }),
  );

  it.effect(
    "installs a graph opened after layout ready on the next layout change",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        yield* fixture.layoutReady;

        const engine = fixture.addLeaf("graph");
        expect(engine.renders).toEqual([]);
        fixture.fire("layout-change");

        expect(engine.renders).toHaveLength(1);
        expect(engine.renders[0]!.facaded).toBe(true);
      }),
  );

  it.effect("restores the real app when the native render throws", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const engine = fixture.addLeaf("graph");
      yield* fixture.layoutReady;

      engine.throwNext = true;
      fixture.citationIndex.emit("backfilled");
      fixture.citationIndex.emit("changed");
      yield* fixture.advance(150);

      expect(engine.app).toBe(fixture.app);
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        "Graph render failed",
        expect.objectContaining({ viewType: "graph" }),
      );
    }),
  );

  it.effect(
    "leaves a leaf with a missing member native and reports it once",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const engine = fixture.addLeaf("graph");
        delete (engine.renderer as { onNodeClick?: unknown }).onNodeClick;
        yield* fixture.layoutReady;
        fixture.fire("layout-change");
        fixture.fire("active-leaf-change");

        expect(engine.renders).toEqual([]);
        expect(Object.hasOwn(engine, "render")).toBe(false);
        expect(warn).toHaveBeenCalledExactlyOnceWith(
          "Graph leaf is missing an internal member; left native",
          { viewType: "graph", missing: ["renderer.onNodeClick"] },
        );
      }),
  );

  it.effect("installs nothing while the Graph core plugin is disabled", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture({ graphEnabled: false });
      const engine = fixture.addLeaf("graph");
      yield* fixture.layoutReady;

      expect(engine.renders).toEqual([]);
      expect(Object.hasOwn(engine, "render")).toBe(false);
    }),
  );

  it.effect(
    "waits for a deferred leaf without a report, then installs on the layout change its load fires",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const { engine, load } = fixture.addDeferredLeaf("localgraph");
        yield* fixture.layoutReady;
        fixture.fire("layout-change");
        fixture.fire("active-leaf-change");

        expect(engine.renders).toEqual([]);
        expect(warn).not.toHaveBeenCalled();

        load();
        fixture.fire("layout-change");
        yield* fixture.settleLookup;

        expect(engine.renders).toEqual([
          {
            facaded: true,
            resolved: EXPECTED_RESOLVED,
            unresolved: EXPECTED_UNRESOLVED,
          },
        ]);
        expect(warn).not.toHaveBeenCalled();
      }),
  );
});

describe("GraphCitations clicks", () => {
  it.effect("interrupts a pending open when the plugin unloads", () =>
    Effect.gen(function* () {
      const fixture = yield* makePresentationFixture();
      let interrupted = false;
      fixture.openCitekey.mockImplementation(() =>
        Effect.never.pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted = true;
            }),
          ),
        ),
      );
      const engine = fixture.addLeaf("graph");
      yield* fixture.layoutReady;

      engine.renderer.onNodeClick(
        new MouseEvent("click"),
        "@typo2024",
        "unresolved",
      );
      expect(fixture.openCitekey).toHaveBeenCalledOnce();
      yield* fixture.unload;

      expect(interrupted).toBe(true);
    }),
  );

  it.effect(
    "opens a Cited Work Node through the citekey action and never natively",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makePresentationFixture();
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;

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
      }),
  );

  it.effect(
    "opens an ambiguous Cited Work Node through the citekey action, which offers the candidates",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makePresentationFixture();
        const engine = fixture.addLeaf("localgraph");
        yield* fixture.layoutReady;

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
      }),
  );

  it.effect.each([false, true])(
    "replaces the hover target when a Literature Note is created and deleted (pointer in popover: %s)",
    (inPopover) =>
      Effect.gen(function* () {
        const fixture = yield* makePresentationFixture({ notes: {} });
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;
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

        delete renderer.nodeLookup["@doe2024"];
        yield* fixture.writeNote("Literature/Doe 2024.md", "DEE23456");
        yield* fixture.advance(400);
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

        delete renderer.nodeLookup["Literature/Doe 2024.md"];
        renderer.nodeLookup["@doe2024"] = { x: 2, y: 3 };
        yield* fixture.writeNote("Literature/Doe 2024.md", undefined);
        yield* fixture.advance(400);
        expect(hideNote).toHaveBeenCalledOnce();
        renderer.onNodeHover(
          new MouseEvent("mouseover"),
          "@doe2024",
          "unresolved",
        );
        expect(fixture.citationPopover.showWork.mock.lastCall![0].work).toEqual(
          {
            kind: "citekey",
            citekey: "doe2024",
          },
        );
      }),
  );

  it.effect("calls through for every other node", () =>
    Effect.gen(function* () {
      const fixture = yield* makePresentationFixture();
      const engine = fixture.addLeaf("graph");
      yield* fixture.layoutReady;

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
    }),
  );
});

describe("GraphCitations right-clicks", () => {
  it.effect(
    "offers every action for a Cited Work Node whose key names one item",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;

        const menu = rightClick(engine, "@pine2023");

        expect(menu?.items.map((item) => item.title)).toEqual([
          m.graph_citations_menu_create_note(),
          m.references_open_in_zotero(),
          m.graph_citations_menu_copy_citekey(),
        ]);
        expect(engine.nativeRightClicks).toEqual([]);
        expect(fixture.trigger).toHaveBeenCalledWith(
          "zotlit:graph-cited-work-menu",
          menu,
          expect.objectContaining({ citekey: "pine2023" }),
        );

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
      }),
  );

  it.effect(
    "leaves out Open in Zotero for an ambiguous key, which names no single item",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const engine = fixture.addLeaf("localgraph");
        yield* fixture.layoutReady;

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
      }),
  );

  it.effect("offers the citation key alone for a key that names no item", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const engine = fixture.addLeaf("graph");
      yield* fixture.layoutReady;

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
    }),
  );

  it.effect(
    "offers the create action while the resolution snapshot is cold",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        fixture.citationIndex.cold = true;
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;

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
      }),
  );

  it.effect(
    "calls through for every node while the additions carry no Cited Work Node",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        fixture.citationIndex.citationsByPath.mockReturnValue(
          new Map<string, readonly CitationOccurrence[]>(),
        );
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;

        engine.renderer.onNodeClick(
          new MouseEvent("click"),
          "@pine2023",
          "unresolved",
        );

        expect(rightClick(engine, "@pine2023")).toBeNull();
        expect(engine.nativeClicks).toEqual([["@pine2023", "unresolved"]]);
        expect(engine.nativeRightClicks).toEqual([["@pine2023", "unresolved"]]);
        expect(fixture.openCitekey).not.toHaveBeenCalled();
      }),
  );

  it.effect("calls through to the native menu for every other node", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const engine = fixture.addLeaf("graph");
      yield* fixture.layoutReady;

      expect(rightClick(engine, "Literature/Doe 2024.md", "")).toBeNull();
      expect(rightClick(engine, "missing", "unresolved")).toBeNull();

      expect(engine.nativeRightClicks).toEqual([
        ["Literature/Doe 2024.md", ""],
        ["missing", "unresolved"],
      ]);
      expect(fixture.openCitekey).not.toHaveBeenCalled();
    }),
  );
});

describe("GraphCitations hovers", () => {
  it.effect(
    "closes citation details when this view's popover control is turned off",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makePresentationFixture();
        const engine = fixture.addLeaf("graph");
        engine.nodes = () => ({ "Literature/Doe 2024.md": graphNode("") });
        yield* fixture.layoutReady;
        engine.renderer.onNodeHover(
          new MouseEvent("mouseover"),
          "Literature/Doe 2024.md",
          "",
        );
        const target =
          fixture.citationPopover.showWork.mock.calls[0]![0].targetEl;
        const popover = Object.assign(fakePopover(target), { hide: vi.fn() });
        engine.hoverPopover = popover;
        engine.setOptions({ "zotlit-citation-popover": false });
        expect(popover.hide).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    "requires the platform modifier for graph popovers only when enabled",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makePresentationFixture({
          settings: { "citation.hover-require-mod-graph": true },
        });
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;
        vi.spyOn(Keymap, "isModifier").mockImplementation(
          (event) => event.metaKey,
        );

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
        expect(
          fixture.citationPopover.showWork,
        ).toHaveBeenCalledExactlyOnceWith(
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
      }),
  );

  it.effect(
    "shows the Citation Popover of a Cited Work Node, anchored at the node",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makePresentationFixture();
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;

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
      }),
  );

  it.effect("interrupts a pending popover when the plugin unloads", () =>
    Effect.gen(function* () {
      const fixture = yield* makePresentationFixture();
      let interrupted = false;
      fixture.citationPopover.showWork.mockImplementation(() =>
        Effect.never.pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted = true;
            }),
          ),
        ),
      );
      const engine = fixture.addLeaf("graph");
      yield* fixture.layoutReady;

      engine.renderer.onNodeHover(
        new MouseEvent("mouseover"),
        "@typo2024",
        "unresolved",
      );
      expect(fixture.citationPopover.showWork).toHaveBeenCalledOnce();
      yield* fixture.unload;

      expect(interrupted).toBe(true);
    }),
  );

  it.effect(
    "shows the Citation Popover of the Item a Literature Note carries",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makePresentationFixture();
        const engine = fixture.addLeaf("localgraph");
        yield* fixture.layoutReady;

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
      }),
  );

  it.effect(
    "keeps the native hover on every node while the Hover Action is off",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makePresentationFixture({
          settings: {
            "citation.hover-action": "off",
            "citation.hover-require-mod-graph": true,
          },
        });
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;

        hoverEach(engine);

        expect(fixture.citationPopover.showWork).not.toHaveBeenCalled();
        expect(engine.nativeHovers).toEqual([
          ["@typo2024", "unresolved"],
          ["Literature/Doe 2024.md", ""],
        ]);
      }),
  );

  it.effect(
    "asks for a Literature Note's page preview under the shared citekey source, and shows nothing for a Cited Work Node",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makePresentationFixture({
          settings: {
            "citation.hover-action": "page-preview",
            "citation.hover-require-mod-graph": true,
          },
        });
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;

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
        const link = fixture.trigger.mock.calls[0]![1] as {
          targetEl: HTMLElement;
        };
        expect(link.targetEl.parentElement).toBe(engine.renderer.containerEl);
        expect([link.targetEl.style.left, link.targetEl.style.top]).toEqual([
          "-6px",
          "16px",
        ]);
      }),
  );

  it.effect(
    "shows the Citation Popover of a Literature Note only a wikilink Citation cites",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makePresentationFixture({
          wikilinkCitations: true,
          notes: {
            "Literature/Doe 2024.md": "DEE23456",
            "Literature/Lee 2019.md": "LEE56789",
          },
        });
        // Wiki cites Lee by wikilink alone, which adds no edge of its own.
        fixture.citationIndex.wikilinks.set("Notes/Wiki.md", [
          occurrence("Literature/Lee 2019", "wikilink"),
        ]);
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;

        engine.renderer.onNodeHover(
          new MouseEvent("mouseover"),
          "Literature/Lee 2019.md",
          "",
        );

        expect(fixture.citationPopover.showWork).toHaveBeenCalledOnce();
        expect(
          fixture.citationPopover.showWork.mock.calls[0]![0],
        ).toMatchObject({
          work: { kind: "item", indexedKey: "LEE56789" },
        });
        expect(engine.nativeHovers).toEqual([]);
      }),
  );

  it.effect(
    "shows a source-less popover on a Literature Note no document cites",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makePresentationFixture();
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;

        engine.renderer.onNodeHover(
          new MouseEvent("mouseover"),
          "Literature/Kay 2020.md",
          "",
        );

        expect(
          fixture.citationPopover.showWork,
        ).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            work: { kind: "item", indexedKey: "KAY23456" },
          }),
        );
        expect(engine.nativeHovers).toEqual([]);
      }),
  );

  it.effect("calls through for every other node", () =>
    Effect.gen(function* () {
      const fixture = yield* makePresentationFixture();
      const engine = fixture.addLeaf("graph");
      yield* fixture.layoutReady;

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
    }),
  );

  it.effect(
    "retires the anchor on the unhover no popover outlives, and keeps it for one that does",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makePresentationFixture();
        const engine = fixture.addLeaf("graph");
        const { containerEl } = engine.renderer;
        yield* fixture.layoutReady;

        engine.renderer.onNodeHover(
          new MouseEvent("mouseover"),
          "@typo2024",
          "unresolved",
        );
        expect(containerEl.children).toHaveLength(1);

        engine.hoverPopover = fakePopover(
          containerEl.children[0] as HTMLElement,
        );
        engine.renderer.onNodeUnhover();
        expect(containerEl.children).toHaveLength(1);
        expect(engine.nativeUnhovers).toBe(1);

        engine.hoverPopover = null;
        engine.renderer.onNodeUnhover();
        expect(containerEl.children).toHaveLength(0);
        expect(engine.nativeUnhovers).toBe(2);
      }),
  );

  it.effect(
    "gives a second hovered node an anchor of its own, so its preview is not read as the first one again",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makePresentationFixture();
        const engine = fixture.addLeaf("graph");
        const { containerEl } = engine.renderer;
        yield* fixture.layoutReady;
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
      }),
  );

  it.effect("lets go of a hold when the hovered graph closes", () =>
    Effect.gen(function* () {
      const fixture = yield* makePresentationFixture();
      const engine = fixture.addLeaf("graph", "hovered");
      const other = fixture.addLeaf("localgraph", "remaining");
      const { containerEl } = engine.renderer;
      yield* fixture.layoutReady;
      engine.renderer.onNodeHover(
        new MouseEvent("mouseover"),
        "@typo2024",
        "unresolved",
      );
      const popover = fakePopover();
      engine.hoverPopover = popover;
      yield* fixture.advance(200);
      expect(popover.transition).toHaveBeenCalledOnce();

      // Closing by keyboard leaves the pointer where it was, so nothing
      // unhovers the node on the way out.
      fixture.closeLeaf("hovered");
      expect(fixture.citationIndex.lookupCount).toBe(1);
      expect(rowNames(other).length).toBeGreaterThan(0);

      popover.onTarget = false;
      yield* fixture.advance(600);
      expect(popover.onTarget).toBe(false);
      expect(popover.transition).toHaveBeenCalledOnce();
      expect(containerEl.children).toHaveLength(0);
      expect(rowNames(engine)).toEqual([]);
      fixture.closeLeaf("remaining");
      expect(fixture.citationIndex.lookupCount).toBe(0);
    }),
  );

  it.effect(
    "lets go of a hold on the window that armed it, after the graph moved to a pop-out",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makePresentationFixture();
        const engine = fixture.addLeaf("graph", "hovered");
        const { containerEl } = engine.renderer;
        yield* fixture.layoutReady;
        engine.renderer.onNodeHover(
          new MouseEvent("mouseover"),
          "@typo2024",
          "unresolved",
        );
        const popover = fakePopover();
        engine.hoverPopover = popover;
        yield* fixture.advance(200);
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
        yield* fixture.advance(600);
        expect(popover.onTarget).toBe(false);
        expect(popover.transition).toHaveBeenCalledOnce();
        expect(popout.clearInterval).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    "states the popover's target again after Obsidian's sweep drops it, until the pointer leaves",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makePresentationFixture();
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;

        engine.renderer.onNodeHover(
          new MouseEvent("mouseover"),
          "@typo2024",
          "unresolved",
        );
        const popover = fakePopover();
        engine.hoverPopover = popover;
        // What Obsidian's own sweep does to a popover it finds no pointer on.
        popover.onTarget = false;
        yield* fixture.advance(200);

        expect(popover.onTarget).toBe(true);
        expect(popover.transition).toHaveBeenCalledOnce();

        popover.onTarget = false;
        engine.renderer.onNodeUnhover();
        yield* fixture.advance(600);

        expect(popover.onTarget).toBe(false);
        expect(popover.transition).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    "stops holding a popover that has hidden, with no unhover of its own",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makePresentationFixture();
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;

        engine.renderer.onNodeHover(
          new MouseEvent("mouseover"),
          "@typo2024",
          "unresolved",
        );
        const popover = fakePopover();
        engine.hoverPopover = popover;
        yield* fixture.advance(200);
        expect(popover.transition).toHaveBeenCalledOnce();

        // What Obsidian's own transition leaves behind once the popover is gone.
        Object.assign(popover, { state: PopoverState.Hidden });
        yield* fixture.advance(200);

        // The hold released itself, so a popover shown again is no longer held.
        Object.assign(popover, { state: PopoverState.Shown, onTarget: false });
        yield* fixture.advance(600);

        expect(popover.onTarget).toBe(false);
        expect(popover.transition).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    "waits for a page preview that opens on Obsidian's own delay, then holds it",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makePresentationFixture({
          settings: {
            "citation.hover-action": "page-preview",
            "citation.hover-require-mod-graph": true,
          },
        });
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;

        engine.renderer.onNodeHover(
          new MouseEvent("mouseover"),
          "Literature/Doe 2024.md",
          "",
        );
        // Obsidian's page preview opens well after the hover that asked for it,
        // so the engine carries no popover for the first few beats of the hold.
        yield* fixture.advance(400);
        const popover = fakePopover();
        popover.onTarget = false;
        engine.hoverPopover = popover;
        yield* fixture.advance(200);

        expect(popover.onTarget).toBe(true);
        expect(popover.transition).toHaveBeenCalledOnce();
      }),
  );

  it.effect("gives up on a hover no popover ever answers", () =>
    Effect.gen(function* () {
      const fixture = yield* makePresentationFixture({
        settings: {
          "citation.hover-action": "page-preview",
          "citation.hover-require-mod-graph": true,
        },
      });
      const engine = fixture.addLeaf("graph");
      yield* fixture.layoutReady;

      engine.renderer.onNodeHover(
        new MouseEvent("mouseover"),
        "Literature/Doe 2024.md",
        "",
      );
      // Page preview waits for a held Mod, so a hover without one is answered
      // by nothing at all and the hold has no popover to wait for.
      yield* fixture.advance(2200);
      const popover = fakePopover();
      popover.onTarget = false;
      engine.hoverPopover = popover;
      yield* fixture.advance(600);

      expect(popover.onTarget).toBe(false);
      expect(popover.transition).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    "keeps the native hover on a node the renderer holds no place for",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makePresentationFixture();
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;
        delete engine.renderer.nodeLookup["Literature/Doe 2024.md"];

        engine.renderer.onNodeHover(
          new MouseEvent("mouseover"),
          "Literature/Doe 2024.md",
          "",
        );

        expect(fixture.citationPopover.showWork).not.toHaveBeenCalled();
        expect(engine.nativeHovers).toEqual([["Literature/Doe 2024.md", ""]]);
      }),
  );

  it.effect(
    "restores both hover members and takes the anchor away on teardown",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makePresentationFixture();
        const engine = fixture.addLeaf("graph");
        const nativeHover = engine.renderer.onNodeHover;
        const nativeUnhover = engine.renderer.onNodeUnhover;
        yield* fixture.layoutReady;
        engine.renderer.onNodeHover(
          new MouseEvent("mouseover"),
          "@typo2024",
          "unresolved",
        );

        yield* fixture.unload;

        expect(engine.renderer.onNodeHover).toBe(nativeHover);
        expect(engine.renderer.onNodeUnhover).toBe(nativeUnhover);
        expect(engine.renderer.containerEl.children).toHaveLength(0);
      }),
  );
});

/** A popover already shown, as the engine holds the one its nodes stand on. */
function fakePopover(targetEl: HTMLElement | null = null): HoverPopover & {
  onTarget: boolean;
  transition: Mock<(...args: unknown[]) => void>;
} {
  const transition: Mock<(...args: unknown[]) => void> = vi.fn(
    (..._args: unknown[]) => undefined,
  );
  return stubService<
    HoverPopover & {
      onTarget: boolean;
      transition: typeof transition;
    }
  >("HoverPopover", {
    state: PopoverState.Shown,
    onTarget: true,
    targetEl,
    transition,
    hide: vi.fn(),
  });
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
  it.effect("requests only the citekeys in the current graph facts", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      fixture.addLeaf("graph");
      yield* fixture.layoutReady;

      expect(fixture.citationIndex.lookupRequests.at(-1)).toEqual([
        "doe2024",
        "pine2023",
        "roe2025",
        "typo2024",
      ]);
    }),
  );

  it.effect(
    "re-renders every installed leaf once per burst of index events",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const global = fixture.addLeaf("graph");
        const local = fixture.addLeaf("localgraph");
        yield* fixture.layoutReady;

        fixture.citationIndex.emit("changed");
        fixture.citationIndex.emit("changed");
        fixture.citationIndex.emit("backfilled");
        yield* fixture.advance(150);
        expect(global.renders).toHaveLength(2);
        expect(local.renders).toHaveLength(2);

        for (const event of ["resolution-changed", "membership-changed"]) {
          fixture.citationIndex.emit(event);
          yield* fixture.advance(150);
        }
        yield* fixture.writeNote("Literature/Poe 2026.md", "PEE45678");
        yield* fixture.advance(150);

        expect(global.renders).toHaveLength(5);
        expect(local.renders).toHaveLength(5);
        expect(global.renders.every((render) => render.facaded)).toBe(true);
      }),
  );
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

  it.effect("colors only Cited Work Nodes without a group", () =>
    Effect.gen(function* () {
      themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)");
      const fixture = yield* makeFixture();
      const engine = fixture.addLeaf("graph");
      engine.nodes = nodes;

      yield* fixture.layoutReady;

      expect(colorsOf(engine.handedOff)).toEqual({
        "Literature/Doe 2024.md": undefined,
        "@typo2024": { a: 1, rgb: 0x888888 },
        "@roe2025": { a: 1, rgb: 0x888888 },
        "Draft.md": undefined,
      });
    }),
  );

  it.effect(
    "keeps a Literature Note native while the Pandoc citations row is off",
    () =>
      Effect.gen(function* () {
        themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)");
        const fixture = yield* makeFixture();
        const engine = fixture.addLeaf("graph");
        engine.nodes = nodes;
        yield* fixture.layoutReady;

        rowToggle(engine, m.graph_option_pandoc_citations_name()).toggle(false);

        // The row takes every citekey edge away, and with it every Cited Work
        // Node; a Literature Note is one whatever the rows say.
        expect(colorsOf(engine.handedOff)).toEqual({
          "Literature/Doe 2024.md": undefined,
          "@typo2024": undefined,
          "@roe2025": undefined,
          "Draft.md": undefined,
        });
      }),
  );

  it.effect(
    "keeps native colors on a Literature Note only a Wikilink Citation reaches",
    () =>
      Effect.gen(function* () {
        themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)");
        const fixture = yield* makeFixture({
          wikilinkCitations: true,
          // Reading cites Roe's note by `[[Roe 2025]]` and no citekey reaches it:
          // `roe2025` is ambiguous, so it draws a Cited Work Node of its own.
          notes: {
            "Literature/Doe 2024.md": "DEE23456",
            "Literature/Roe 2025.md": "REE34567",
          },
          links: {
            "Draft.md": { "Other.md": 1 },
            "Reading.md": { "Literature/Roe 2025.md": 1 },
          },
        });
        fixture.citationIndex.wikilinks.set("Reading.md", [
          occurrence("Roe 2025", "wikilink"),
        ]);
        const engine = fixture.addLeaf("graph");
        engine.nodes = () => ({
          ...nodes(),
          "Literature/Roe 2025.md": graphNode(""),
        });

        yield* fixture.layoutReady;

        expect(colorsOf(engine.handedOff)).toEqual({
          "Literature/Doe 2024.md": undefined,
          "Literature/Roe 2025.md": undefined,
          "@typo2024": { a: 1, rgb: 0x888888 },
          "@roe2025": { a: 1, rgb: 0x888888 },
          "Draft.md": undefined,
        });
      }),
  );

  it.effect(
    "reads the theme again on a css change and colours the next render from it",
    () =>
      Effect.gen(function* () {
        themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)");
        const fixture = yield* makeFixture();
        const engine = fixture.addLeaf("graph");
        engine.nodes = nodes;
        yield* fixture.layoutReady;

        document.body.style.setProperty(
          themeProperty.graphLiteratureNote,
          "rgb(0, 0, 255)",
        );
        fixture.fire("css-change");
        yield* fixture.advance(150);

        expect(engine.renders).toHaveLength(2);
        expect(colorsOf(engine.handedOff)).toEqual({
          "Literature/Doe 2024.md": undefined,
          "@typo2024": { a: 1, rgb: 0x888888 },
          "@roe2025": { a: 1, rgb: 0x888888 },
          "Draft.md": undefined,
        });
      }),
  );

  it.effect("hands off the native node set once the feature is off", () =>
    Effect.gen(function* () {
      themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)");
      const fixture = yield* makeFixture();
      const engine = fixture.addLeaf("graph");
      engine.nodes = grouped;
      yield* fixture.layoutReady;

      fixture.settings.update({ "citation.graph-citations": false });

      expect(colorsOf(engine.handedOff)).toEqual({
        "Literature/Doe 2024.md": GROUP,
        "@typo2024": undefined,
        "@roe2025": undefined,
        "Draft.md": undefined,
      });
    }),
  );
});

function colorsOf(
  nodes: GraphData["nodes"],
): Record<string, GraphColor | null | undefined> {
  return Object.fromEntries(
    Object.entries(nodes).map(([id, node]) => [id, node.color]),
  );
}

describe("GraphCitations teardown", () => {
  it.effect(
    "restores every member and draws natively once per leaf when the setting turns off",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const global = fixture.addLeaf("graph");
        const local = fixture.addLeaf("localgraph");
        const nativeClick = global.renderer.onNodeClick;
        const nativeRightClick = global.renderer.onNodeRightClick;
        yield* fixture.layoutReady;
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
      }),
  );

  it.effect(
    "keeps another plugin's render wrapper when ZotLit is disabled",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;
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
      }),
  );

  it.effect("installs again when the setting turns back on", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      expect(fixture.citationIndex.lookupCount).toBe(0);
      const engine = fixture.addLeaf("graph");
      const nativeClick = engine.renderer.onNodeClick;
      const nativeRightClick = engine.renderer.onNodeRightClick;
      yield* fixture.layoutReady;
      expect(fixture.citationIndex.lookupCount).toBe(1);
      fixture.settings.update({ "citation.graph-citations": false });
      expect(fixture.citationIndex.lookupCount).toBe(0);
      expect(engine.renderer.onNodeClick).toBe(nativeClick);
      expect(engine.renderer.onNodeRightClick).toBe(nativeRightClick);

      fixture.settings.update({ "citation.graph-citations": true });

      expect(fixture.citationIndex.lookupCount).toBe(1);
      expect(engine.renders).toHaveLength(3);
      expect(engine.renders[2]!.facaded).toBe(true);
      expect(engine.renderer.onNodeClick).not.toBe(nativeClick);
      expect(engine.renderer.onNodeRightClick).not.toBe(nativeRightClick);
    }),
  );

  it.effect(
    "lets go of what the view holds for its unload once the installation ends",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const engine = fixture.addLeaf("graph", "hovered");
        yield* fixture.layoutReady;
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
      }),
  );

  it.effect(
    "restores every member, draws natively once, and unsubscribes on dispose",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const engine = fixture.addLeaf("graph");
        const nativeClick = engine.renderer.onNodeClick;
        const nativeRightClick = engine.renderer.onNodeRightClick;
        yield* fixture.layoutReady;

        yield* fixture.unload;

        expect(Object.hasOwn(engine, "render")).toBe(false);
        expect(engine.renderer.onNodeClick).toBe(nativeClick);
        expect(engine.renderer.onNodeRightClick).toBe(nativeRightClick);
        expect(engine.renders).toHaveLength(2);
        expect(engine.renders[1]!.facaded).toBe(false);
        expect(fixture.listenerCount()).toBe(0);
        fixture.citationIndex.emit("backfilled");
        yield* fixture.writeNote("Literature/Poe 2026.md", "PEE45678");
        expect(engine.renders).toHaveLength(2);
      }),
  );
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
  it.effect(
    "builds the rows in the Filters section, without the Wikilink row while the vault-wide setting excludes the syntax",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const engine = fixture.addLeaf("graph");

        yield* fixture.layoutReady;

        expect(rowNames(engine)).toEqual([
          m.graph_option_pandoc_citations_name(),
          m.graph_option_citation_connected_only_name(),
        ]);
        expect(engine.getOptions()).toEqual({
          "zotlit-pandoc-citations": true,
          "zotlit-citation-connected-only": false,
          "zotlit-color-citation-links": false,
          "zotlit-citation-popover": false,
          "zotlit-author-title-labels": false,
        });
      }),
  );

  it.effect(
    "adds the Wikilink row while the vault-wide setting admits the syntax, and rebuilds the rows when that choice changes",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;

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
      }),
  );

  it.effect(
    "starts a local graph at what its leaf carried while deferred",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const { engine, load } = fixture.addDeferredLeaf("localgraph", {
          "zotlit-citation-connected-only": true,
        });
        yield* fixture.layoutReady;

        load();
        fixture.fire("layout-change");
        yield* fixture.settleLookup;

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
      }),
  );

  it.effect(
    "starts a local graph the layout loaded straight away from the workspace file",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
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
        const engine = fixture.addLeaf("localgraph", "local-1");

        yield* fixture.layoutReady;

        expect(
          rowToggle(engine, m.graph_option_pandoc_citations_name()).getValue(),
        ).toBe(false);
        expect(engine.renders.at(-1)).toEqual({
          facaded: true,
          resolved: VAULT_LINKS,
          unresolved: {},
        });
      }),
  );

  it.effect(
    "starts the rows fresh, and says so, when the workspace file cannot be read",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          workspaceFileError: new Error("EACCES: workspace.json"),
        });
        const engine = fixture.addLeaf("localgraph", "local-1");

        yield* fixture.layoutReady;

        expect(warn).toHaveBeenCalledWith(
          "Workspace file unreadable; local graph rows start fresh",
          expect.objectContaining({ cause: expect.anything() }),
        );
        expect(
          rowToggle(engine, m.graph_option_pandoc_citations_name()).getValue(),
        ).toBe(true);
        // The fresh Pandoc row is on, so the citations are drawn.
        expect(engine.renders.at(-1)).toMatchObject({
          facaded: true,
          unresolved: {
            "Draft.md": expect.objectContaining({ "@pine2023": 1 }),
          },
        });
      }),
  );

  it.effect(
    "returns the rows to their defaults when the panel restores default settings",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;
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
          "zotlit-author-title-labels": false,
        });
        expect(engine.filterOptions.natives).toBe(1);
        expect(engine.renders.at(-1)).toEqual({
          facaded: true,
          resolved: EXPECTED_RESOLVED,
          unresolved: EXPECTED_UNRESOLVED,
        });
      }),
  );

  it.effect("draws no citation edge while Pandoc citations is off", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const engine = fixture.addLeaf("graph");
      yield* fixture.layoutReady;

      rowToggle(engine, m.graph_option_pandoc_citations_name()).toggle(false);

      expect(engine.renders.at(-1)).toEqual({
        facaded: true,
        resolved: VAULT_LINKS,
        unresolved: {},
      });
    }),
  );

  it.effect(
    "takes a citing note's own links to narrowed-away targets away with them",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          links: { "Draft.md": { "Other.md": 1 } },
          unresolved: { "Draft.md": { todo: 1 } },
        });
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;

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
      }),
  );

  it.effect(
    "takes each note's Wikilink Citations away while that row is off, and leaves every other link to a Literature Note alone",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
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
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;

        rowToggle(engine, m.graph_option_wikilink_citations_name()).toggle(
          false,
        );

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
      }),
  );

  it.effect(
    "keeps a local graph's row in the leaf state Obsidian persists",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const engine = fixture.addLeaf("localgraph", "local-1");
        yield* fixture.layoutReady;

        rowToggle(engine, m.graph_option_citation_connected_only_name()).toggle(
          true,
        );

        expect(fixture.leafState("local-1")).toEqual({
          options: {
            "zotlit-pandoc-citations": true,
            "zotlit-citation-connected-only": true,
            "zotlit-color-citation-links": false,
            "zotlit-citation-popover": false,
            "zotlit-author-title-labels": false,
          },
        });
      }),
  );

  it.effect(
    "rebuilds the rows without drawing the graph natively in between",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;
        const drawn = engine.renders.length;

        fixture.settings.update({ "citation.wikilink-citations": true });

        expect(
          engine.renders.slice(drawn).map((render) => render.facaded),
        ).toEqual([true]);
        expect(rowNames(engine)).toEqual([
          m.graph_option_pandoc_citations_name(),
          m.graph_option_wikilink_citations_name(),
          m.graph_option_citation_connected_only_name(),
        ]);
      }),
  );

  it.effect("removes every row when the feature turns off", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture();
      const engine = fixture.addLeaf("graph");
      yield* fixture.layoutReady;

      fixture.settings.update({ "citation.graph-citations": false });

      expect(rowNames(engine)).toEqual([]);
      expect(engine.filterOptions.optionListeners).toEqual({});
      expect(Object.hasOwn(engine.filterOptions, "setDefaultOptions")).toBe(
        false,
      );
    }),
  );
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
  it.effect(
    "adds one literature notes group, keeps the groups the user has, and saves",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;
        const mine = { query: "tag:#paper", color: { a: 1, rgb: 0x00ff00 } };
        engine.colorGroupOptions.setColorQueries([mine]);

        groupsButton(engine).click();

        expect(engine.colorGroupOptions.getColoredQueries()).toEqual([
          mine,
          { query: '["zotero-key"]', color: DEFAULT_COLOR },
        ]);
        expect(engine.onOptionsChange).toHaveBeenCalledOnce();
      }),
  );

  it.effect(
    "takes the button away when the feature turns off, and brings it back on",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;

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
      }),
  );
});

describe("GraphCitations Display row", () => {
  it.effect(
    "prepends controls so native last-row CSS still targets the Animate row",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const engine = fixture.addLeaf("graph");
        const section = engine.displayOptions.childrenEl;
        const arrows = section.createDiv("setting-item");
        const animate = section.createDiv("setting-item");
        yield* fixture.layoutReady;
        expect(section.lastElementChild).toBe(animate);
        expect([...section.children].indexOf(arrows)).toBe(3);
        expect(rowNames(engine, engine.displayOptions)).toEqual([
          m.graph_option_color_citation_links_name(),
          m.graph_option_citation_popover_name(),
          m.graph_option_author_title_labels_name(),
        ]);
      }),
  );

  it.effect(
    "returns to its default when the panel restores default settings",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;
        rowToggle(
          engine,
          m.graph_option_color_citation_links_name(),
          engine.displayOptions,
        ).toggle(true);

        engine.displayOptions.setDefaultOptions();

        expect(engine.getOptions()["zotlit-color-citation-links"]).toBe(false);
        expect(engine.displayOptions.natives).toBe(1);
      }),
  );

  it.effect(
    "stays as the user left it while the Filters rows are rebuilt",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;
        rowToggle(
          engine,
          m.graph_option_color_citation_links_name(),
          engine.displayOptions,
        ).toggle(true);

        fixture.settings.update({ "citation.wikilink-citations": true });

        expect(rowNames(engine, engine.displayOptions)).toEqual([
          m.graph_option_color_citation_links_name(),
          m.graph_option_citation_popover_name(),
          m.graph_option_author_title_labels_name(),
        ]);
        expect(engine.getOptions()["zotlit-color-citation-links"]).toBe(true);
      }),
  );

  it.effect(
    "leaves the Display section as found when the feature turns off",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const engine = fixture.addLeaf("graph");
        yield* fixture.layoutReady;

        fixture.settings.update({ "citation.graph-citations": false });

        expect(rowNames(engine, engine.displayOptions)).toEqual([]);
        expect(engine.displayOptions.optionListeners).toEqual({});
        expect(Object.hasOwn(engine.displayOptions, "setDefaultOptions")).toBe(
          false,
        );
      }),
  );
});

describe("GraphCitations citation edge colour", () => {
  /** Draft's own link to Other, and two of the edges its citations draw. */
  const EDGES = [
    ["Draft.md", "Other.md"],
    ["Draft.md", "Literature/Doe 2024.md"],
    ["Draft.md", "@typo2024"],
  ] as const;

  /** A graph whose edges are drawn and whose theme states a citation colour. */
  const drawn = Effect.fnUntraced(function* (options: FixtureOptions = {}) {
    themeStates("rgb(120, 82, 238)", "rgb(136, 136, 136)", "rgb(0, 0, 255)");
    const fixture = yield* makePresentationFixture(options);
    const engine = fixture.addLeaf("graph");
    engine.renderer.drawEdges(EDGES);
    yield* fixture.layoutReady;
    return { fixture, engine };
  });

  it.effect(
    "draws the edges a citation named in its own colour and every other edge natively",
    () =>
      Effect.gen(function* () {
        const { engine } = yield* drawn();

        expect(paint(engine.renderer)).toEqual({
          "Draft.md -> Other.md": NATIVE_LINE,
          "Draft.md -> Literature/Doe 2024.md": CITATION_LINK,
          "Draft.md -> @typo2024": CITATION_LINK,
        });
      }),
  );

  it.effect(
    "draws the one line a reciprocal pair shows in the citation colour",
    () =>
      Effect.gen(function* () {
        themeStates(
          "rgb(120, 82, 238)",
          "rgb(136, 136, 136)",
          "rgb(0, 0, 255)",
        );
        const fixture = yield* makePresentationFixture();
        const engine = fixture.addLeaf("graph");
        // Doe links back to Draft, so Obsidian keeps both edges and draws one:
        // the citation Draft → Doe is the line it hides, and Doe → Draft is the
        // one the reader sees.
        engine.renderer.drawEdges([
          ["Draft.md", "Literature/Doe 2024.md"],
          ["Literature/Doe 2024.md", "Draft.md"],
        ]);
        yield* fixture.layoutReady;

        expect(paint(engine.renderer)).toEqual({
          "Draft.md -> Literature/Doe 2024.md": CITATION_LINK,
          "Literature/Doe 2024.md -> Draft.md": CITATION_LINK,
        });
      }),
  );

  it.effect(
    "draws an ordinary edge natively while the citation the other way is out of the render",
    () =>
      Effect.gen(function* () {
        themeStates(
          "rgb(120, 82, 238)",
          "rgb(136, 136, 136)",
          "rgb(0, 0, 255)",
        );
        const fixture = yield* makePresentationFixture();
        const engine = fixture.addLeaf("localgraph");
        // Doe's local graph, showing outgoing links alone: Draft's citation of
        // Doe is no edge of this render, and the link Doe carries back to Draft
        // is the one line there is — an ordinary one.
        engine.renderer.drawEdges([["Literature/Doe 2024.md", "Draft.md"]]);
        yield* fixture.layoutReady;

        expect(paint(engine.renderer)).toEqual({
          "Literature/Doe 2024.md -> Draft.md": NATIVE_LINE,
        });
      }),
  );

  it.effect(
    "asks for the frame that draws an edge natively once the citation that drew it is gone",
    () =>
      Effect.gen(function* () {
        themeStates(
          "rgb(120, 82, 238)",
          "rgb(136, 136, 136)",
          "rgb(0, 0, 255)",
        );
        const fixture = yield* makePresentationFixture({
          // Draft links Doe the ordinary way too, so the edge outlives the
          // citation the row takes away.
          links: { "Draft.md": { "Literature/Doe 2024.md": 1 } },
        });
        const engine = fixture.addLeaf("graph");
        engine.renderer.drawEdges([["Draft.md", "Literature/Doe 2024.md"]]);
        yield* fixture.layoutReady;
        // The frame the install asked for, so what follows stands on an idle graph.
        expect(paint(engine.renderer)).toEqual({
          "Draft.md -> Literature/Doe 2024.md": CITATION_LINK,
        });

        rowToggle(engine, m.graph_option_pandoc_citations_name()).toggle(false);

        expect(paint(engine.renderer)).toEqual({
          "Draft.md -> Literature/Doe 2024.md": NATIVE_LINE,
        });
      }),
  );

  it.effect(
    "asks for the frame that draws an edge in the citation colour once a citation names it",
    () =>
      Effect.gen(function* () {
        themeStates(
          "rgb(120, 82, 238)",
          "rgb(136, 136, 136)",
          "rgb(0, 0, 255)",
        );
        const fixture = yield* makePresentationFixture({
          wikilinkCitations: true,
          links: { "Reading.md": { "Literature/Doe 2024.md": 1 } },
        });
        const engine = fixture.addLeaf("graph");
        engine.renderer.drawEdges([["Reading.md", "Literature/Doe 2024.md"]]);
        yield* fixture.layoutReady;
        expect(paint(engine.renderer)).toEqual({
          "Reading.md -> Literature/Doe 2024.md": NATIVE_LINE,
        });

        // The reader writes the link Reading already carried as a Citation: the
        // edge is the one that was there, drawn in another colour.
        fixture.citationIndex.wikilinks.set("Reading.md", [
          occurrence("Doe 2024", "wikilink"),
        ]);
        fixture.citationIndex.emit("changed");
        yield* fixture.advance(200);

        expect(paint(engine.renderer)).toEqual({
          "Reading.md -> Literature/Doe 2024.md": CITATION_LINK,
        });
      }),
  );

  it.effect(
    "leaves a coloured edge answering the one sprite the renderer built",
    () =>
      Effect.gen(function* () {
        const { engine } = yield* drawn();
        const cited = engine.renderer.links[1]!;

        expect(cited.line).toBe(cited.sprite);
      }),
  );

  it.effect(
    "yields to the native highlight on the edges of the node under the pointer",
    () =>
      Effect.gen(function* () {
        const { engine } = yield* drawn();

        engine.renderer.highlightNode = engine.renderer.node(
          "Literature/Doe 2024.md",
        );

        expect(paint(engine.renderer)).toEqual({
          "Draft.md -> Other.md": NATIVE_LINE,
          "Draft.md -> Literature/Doe 2024.md": NATIVE_HIGHLIGHT,
          "Draft.md -> @typo2024": CITATION_LINK,
        });
      }),
  );

  it.effect(
    "draws an edge whose sprite is built after the hand-off, and again after it is destroyed",
    () =>
      Effect.gen(function* () {
        themeStates(
          "rgb(120, 82, 238)",
          "rgb(136, 136, 136)",
          "rgb(0, 0, 255)",
        );
        const fixture = yield* makePresentationFixture();
        const engine = fixture.addLeaf("graph");
        engine.renderer.drawEdges(EDGES, false);
        yield* fixture.layoutReady;
        const cited = engine.renderer.links[1]!;

        cited.initGraphics();

        expect(
          paint(engine.renderer)["Draft.md -> Literature/Doe 2024.md"],
        ).toBe(CITATION_LINK);

        cited.clearGraphics();
        expect(cited.line).toBeNull();
        cited.initGraphics();

        expect(
          paint(engine.renderer)["Draft.md -> Literature/Doe 2024.md"],
        ).toBe(CITATION_LINK);
      }),
  );

  it.effect("draws every edge natively while the row is off", () =>
    Effect.gen(function* () {
      const { engine } = yield* drawn();

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
    }),
  );

  it.effect("draws natively the edges the Pandoc citations row took away", () =>
    Effect.gen(function* () {
      const { engine } = yield* drawn();

      rowToggle(engine, m.graph_option_pandoc_citations_name()).toggle(false);

      expect(paint(engine.renderer)).toEqual({
        "Draft.md -> Other.md": NATIVE_LINE,
        "Draft.md -> Literature/Doe 2024.md": NATIVE_LINE,
        "Draft.md -> @typo2024": NATIVE_LINE,
      });
    }),
  );

  it.effect(
    "draws a Wikilink Citation the vault already carried in the citation colour",
    () =>
      Effect.gen(function* () {
        themeStates(
          "rgb(120, 82, 238)",
          "rgb(136, 136, 136)",
          "rgb(0, 0, 255)",
        );
        const fixture = yield* makePresentationFixture({
          wikilinkCitations: true,
          links: {
            "Reading.md": { "Literature/Doe 2024.md": 1 },
            "Alias.md": { "Literature/Doe 2024.md": 1 },
          },
        });
        fixture.citationIndex.wikilinks.set("Reading.md", [
          occurrence("Doe 2024", "wikilink"),
        ]);
        const engine = fixture.addLeaf("graph");
        engine.renderer.drawEdges([
          ["Reading.md", "Literature/Doe 2024.md"],
          ["Alias.md", "Literature/Doe 2024.md"],
        ]);

        yield* fixture.layoutReady;

        expect(paint(engine.renderer)).toEqual({
          "Reading.md -> Literature/Doe 2024.md": CITATION_LINK,
          "Alias.md -> Literature/Doe 2024.md": NATIVE_LINE,
        });

        fixture.settings.update({ "citation.graph-citations": false });

        expect(paint(engine.renderer)).toEqual({
          "Reading.md -> Literature/Doe 2024.md": NATIVE_LINE,
          "Alias.md -> Literature/Doe 2024.md": NATIVE_LINE,
        });
      }),
  );

  it.effect("leaves every edge holding its own sprite on teardown", () =>
    Effect.gen(function* () {
      const { fixture, engine } = yield* drawn();
      const cited = engine.renderer.links[1]!;

      yield* fixture.unload;

      expect(cited.line).toBe(cited.sprite);
      expect(paint(engine.renderer)).toEqual({
        "Draft.md -> Other.md": NATIVE_LINE,
        "Draft.md -> Literature/Doe 2024.md": NATIVE_LINE,
        "Draft.md -> @typo2024": NATIVE_LINE,
      });
    }),
  );

  it.effect(
    "leaves the edges native when a build moved a renderer member, and says so once",
    () =>
      Effect.gen(function* () {
        themeStates(
          "rgb(120, 82, 238)",
          "rgb(136, 136, 136)",
          "rgb(0, 0, 255)",
        );
        const fixture = yield* makePresentationFixture();
        const engine = fixture.addLeaf("graph");
        engine.renderer.drawEdges(EDGES);
        // The member is inherited, as the renderer's own is; the build this
        // stands for declares none at all.
        Object.defineProperty(engine.renderer, "getHighlightNode", {
          value: undefined,
          configurable: true,
        });

        yield* fixture.layoutReady;

        const cited = engine.renderer.links[2]!;
        cited.line!.tint = NATIVE_LINE;

        expect(cited.sprite.tint).toBe(NATIVE_LINE);
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0]![1]).toMatchObject({
          missing: ["renderer.getHighlightNode"],
        });
      }),
  );
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
const presetFixture = Effect.fnUntraced(function* (
  options: FixtureOptions & { viewType?: "graph" | "localgraph" } = {},
) {
  const fixture = yield* makePresentationFixture(options);
  const viewType = options.viewType ?? "graph";
  const engine = fixture.addLeaf(viewType, "preset-leaf");
  addNativeRows(engine, viewType);
  return {
    ...fixture,
    engine,
    leaf: fixture.leaf("preset-leaf"),
    apply: () => fixture.service.applyPreset(fixture.leaf("preset-leaf")),
  };
});

/** What the preset leaves a graph's options at, beside the native keys. */
const PRESET_ROWS = {
  "zotlit-author-title-labels": true,
  "zotlit-pandoc-citations": true,
  "zotlit-citation-connected-only": true,
  "zotlit-color-citation-links": true,
  "zotlit-citation-popover": true,
};

describe("GraphCitations Citation Graph preset", () => {
  it.effect(
    "presets the global graph, and adds the literature notes group",
    () =>
      Effect.gen(function* () {
        const fixture = yield* presetFixture();
        yield* fixture.layoutReady;

        yield* fixture.apply();

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
      }),
  );

  it.effect("names the Wikilink citations key only where its row stands", () =>
    Effect.gen(function* () {
      const off = yield* presetFixture();
      yield* off.layoutReady;
      yield* off.apply();

      expect(off.engine.options["zotlit-wikilink-citations"]).toBeUndefined();

      const on = yield* presetFixture({ wikilinkCitations: true });
      yield* on.layoutReady;
      yield* on.apply();

      expect(on.engine.options["zotlit-wikilink-citations"]).toBe(true);
      expect(
        rowToggle(
          on.engine,
          m.graph_option_wikilink_citations_name(),
        ).getValue(),
      ).toBe(true);
    }),
  );

  it.effect("preserves the user's forces when applying the preset", () =>
    Effect.gen(function* () {
      const fixture = yield* presetFixture();
      yield* fixture.layoutReady;
      fixture.engine.options.centerStrength = 0.42;
      fixture.engine.options.textFadeMultiplier = -0.5;

      yield* fixture.apply();

      expect(fixture.engine.options.centerStrength).toBe(0.42);
      expect(fixture.engine.options.textFadeMultiplier).toBe(-0.5);
    }),
  );

  it.effect(
    "leaves the local graph's orphans alone, which its panel has no row for",
    () =>
      Effect.gen(function* () {
        const fixture = yield* presetFixture({ viewType: "localgraph" });
        yield* fixture.layoutReady;

        yield* fixture.apply();

        expect(fixture.engine.options).toMatchObject({
          ...PRESET_ROWS,
          showTags: false,
          showArrow: true,
          // No row answers the key, so the graph keeps Obsidian's own default.
          showOrphans: true,
        });
      }),
  );

  it.effect(
    "installs the leaf first, so a graph opened by the command hears ZotLit's keys",
    () =>
      Effect.gen(function* () {
        const fixture = yield* presetFixture();
        // No layout event has reached the service, which is where a command that
        // just opened a leaf stands: Obsidian fires `layout-change` a frame later.
        expect(rowNames(fixture.engine)).toEqual([]);

        yield* fixture.apply();

        expect(rowNames(fixture.engine)).toEqual([
          m.graph_option_pandoc_citations_name(),
          m.graph_option_citation_connected_only_name(),
        ]);
        expect(fixture.engine.options).toMatchObject(PRESET_ROWS);
      }),
  );

  it.effect("adds no second literature notes group on a second run", () =>
    Effect.gen(function* () {
      const fixture = yield* presetFixture();
      yield* fixture.layoutReady;
      yield* fixture.apply();
      const firstOptions = structuredClone(fixture.engine.options);

      yield* fixture.apply();

      expect(fixture.engine.options).toEqual(firstOptions);
      expect(fixture.engine.colorGroupOptions.getColoredQueries()).toEqual([
        { query: '["zotero-key"]', color: DEFAULT_COLOR },
      ]);
    }),
  );

  it.effect(
    "leaves a graph whose set-options path moved as Obsidian opened it",
    () =>
      Effect.gen(function* () {
        const fixture = yield* presetFixture();
        yield* fixture.layoutReady;
        warn.mockClear();
        Object.defineProperty(fixture.engine, "setOptions", {
          value: undefined,
          configurable: true,
        });

        yield* fixture.apply();

        expect(fixture.engine.options["zotlit-citation-connected-only"]).toBe(
          false,
        );
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0]![1]).toMatchObject({
          missing: ["engine.setOptions"],
        });
      }),
  );
});

/** Native text/container lifecycle sufficient to exercise lazy node graphics. */
class FakeLabelContainer implements GraphTextContainer {
  updateTransform(): void {}
  x = 0;
  y = 0;
  alpha = 1;
  visible = true;
  zIndex = 2;
  eventMode = "none";
  parent: GraphTextContainer | null = null;
  children: GraphTextDisplay[] = [];
  destroyed = false;
  scale = {
    x: 1,
    y: 1,
    set(x: number, y = x) {
      this.x = x;
      this.y = y;
    },
  };
  addChild(child: GraphTextDisplay): void {
    this.children.push(child);
    child.parent = this;
  }
  removeChild(child: GraphTextDisplay): void {
    this.children = this.children.filter((held) => held !== child);
    child.parent = null;
  }
  destroy(options?: { children?: boolean }): void {
    if (options?.children) for (const child of this.children) child.destroy();
    this.children = [];
    this.parent?.removeChild(this);
    this.destroyed = true;
  }
}
class FakeLabelText extends FakeLabelContainer {
  anchor = {
    x: 0,
    y: 0,
    set(x: number, y: number) {
      this.x = x;
      this.y = y;
    },
  };
  resolution = 1;
  constructor(
    public text: string,
    public style: GraphTextStyle,
  ) {
    super();
  }
  get width(): number {
    return Array.from(this.text).reduce(
      (sum, character) => sum + (character.codePointAt(0)! > 255 ? 20 : 10),
      0,
    );
  }
  get height(): number {
    return this.style.fontSize;
  }
}
class FakeLabelNode implements GraphDrawnNode {
  text: GraphTextDisplay | null = null;
  hanger = new FakeLabelContainer();
  constructor(public id: string) {}
  getTextStyle(): GraphTextStyle {
    return {
      fontFamily: "Arial",
      fontSize: 16,
      fill: 0x112233,
      wordWrap: true,
    };
  }
  initGraphics(): boolean {
    if (this.text) return false;
    this.text = new FakeLabelText(this.id, this.getTextStyle());
    this.hanger.addChild(this.text);
    return true;
  }
  clearGraphics(): void {
    this.text?.destroy();
    this.text = null;
  }
}

function labelLines(node: FakeLabelNode): FakeLabelText[] {
  return (node.text as FakeLabelContainer).children as FakeLabelText[];
}
function installFakeLabelPixi(): Disposable {
  using cleanup = new DisposableStack();
  cleanup.defer(() => {
    vi.unstubAllGlobals();
    labelReads.mockReset();
  });
  vi.stubGlobal("PIXI", { Container: FakeLabelContainer, Text: FakeLabelText });
  labelReads.mockImplementation((keys: string[]) =>
    keys.map((key) => ({
      key,
      primaryCreatorType: "author",
      creators: [{ creatorType: "author", lastName: "Doe", firstName: "Jane" }],
      fields: {
        itemType: "book",
        title: "A study of graphs",
        shortTitle: "Graph study",
        date: "2024",
      },
    })),
  );
  return cleanup.move();
}

describe("Graph Work Labels", () => {
  it.effect("persists the Display row and restores its default", () =>
    Effect.gen(function* () {
      const fixture = yield* makePresentationFixture();
      const engine = fixture.addLeaf("graph");
      engine.nodes = () => ({
        "Literature/Doe 2024.md": graphNode(""),
        "@pine2023": graphNode("unresolved"),
        "@roe2025": graphNode("unresolved"),
        "@typo2024": graphNode("unresolved"),
        "Other.md": graphNode(""),
      });
      yield* fixture.layoutReady;
      expect(rowNames(engine, engine.displayOptions)).toContain(
        m.graph_option_author_title_labels_name(),
      );
      expect(engine.getOptions()["zotlit-author-title-labels"]).toBe(false);
      engine.setOptions({ "zotlit-author-title-labels": true });
      expect(engine.getOptions()["zotlit-author-title-labels"]).toBe(true);
      engine.displayOptions.setDefaultOptions();
      expect(engine.getOptions()["zotlit-author-title-labels"]).toBe(false);
    }),
  );

  it.effect(
    "fills only drawn works outside render and covers lazy rebuild, width, refresh, and native restoration",
    () =>
      Effect.gen(function* () {
        using _pixi = installFakeLabelPixi();
        const fixture = yield* makePresentationFixture({ labelDatabase: true });
        const engine = fixture.addLeaf("graph");
        engine.nodes = () => ({
          "Literature/Doe 2024.md": graphNode(""),
          "@pine2023": graphNode("unresolved"),
          "@roe2025": graphNode("unresolved"),
          "@typo2024": graphNode("unresolved"),
          "Other.md": graphNode(""),
        });
        yield* fixture.layoutReady;
        engine.setOptions({ "zotlit-author-title-labels": true });
        expect(labelReads).not.toHaveBeenCalled();
        yield* fixture.advance(150);
        expect(labelReads.mock.calls.map(([keys]) => keys)).toEqual([
          ["DEE23456", "PINE2345g4"],
        ]);
        const doe = engine.renderer.nodes.find(
          (node) => node.id === "Literature/Doe 2024.md",
        )!;
        const pine = engine.renderer.nodes.find(
          (node) => node.id === "@pine2023",
        )!;
        const init = Reflect.get(doe, "initGraphics");
        doe.initGraphics();
        pine.initGraphics();
        expect(labelLines(doe).map((line) => line.text)).toEqual([
          "Doe 2024",
          "Graph study",
        ]);
        expect(labelLines(pine).map((line) => line.text)).toEqual([
          "Doe 2024",
          "Graph study",
        ]);
        expect(doe.text).not.toBe(pine.text);
        expect(labelLines(doe)[1]!.alpha).toBe(0.6);
        const labelContainer = doe.text as FakeLabelContainer;
        const titleY = labelLines(doe)[1]!.y;
        engine.renderer.scale = 0.25;
        labelContainer.updateTransform();
        expect(labelLines(doe)[1]!.alpha).toBe(0);
        expect(labelLines(doe)[1]!.y).toBe(titleY);
        engine.renderer.highlightNode = doe;
        labelContainer.updateTransform();
        expect(labelLines(doe)[1]!.alpha).toBe(0.6);
        engine.renderer.highlightNode = null;
        engine.renderer.scale = 2;
        engine.renderer.fTextShowMult = 0.5;
        labelContainer.updateTransform();
        expect(labelLines(doe)[1]!.alpha).toBe(0.3);
        engine.renderer.fTextShowMult = undefined;
        labelContainer.updateTransform();
        expect(labelLines(doe)[1]!.alpha).toBe(0.6);
        expect(labelLines(doe)[0]!.anchor.y).toBe(0);
        expect(labelLines(doe)[0]!.style.wordWrap).toBe(false);
        engine.render();
        expect(doe).toHaveProperty("initGraphics", init);
        expect(labelReads).toHaveBeenCalledOnce();
        const oldLines = labelLines(doe);
        doe.clearGraphics();
        expect(oldLines.every((line) => line.destroyed)).toBe(true);
        doe.initGraphics();
        expect(labelLines(doe)[0]!.text).toBe("Doe 2024");
        for (const id of ["@roe2025", "@typo2024", "Other.md"]) {
          const node = engine.renderer.nodes.find(
            (candidate) => candidate.id === id,
          )!;
          node.initGraphics();
          expect(node.text).toBeInstanceOf(FakeLabelText);
        }
        labelReads.mockImplementation((keys: string[]) =>
          keys.map((key) => ({
            key,
            primaryCreatorType: "author",
            creators: [
              { creatorType: "author", lastName: "Lee", firstName: "" },
            ],
            fields: {
              itemType: "book",
              shortTitle: "文献关系图谱研究文献关系图谱研究文献关系图谱研究",
              date: "2025",
            },
          })),
        );
        fixture.citationIndex.emit("resolution-changed");
        yield* fixture.advance(150);
        expect(labelLines(doe)[0]!.text).toBe("Lee 2025");
        expect(labelLines(doe)[1]!.text).toBe("文献关系图谱研究文献关…");
        expect(labelLines(doe)[1]!.width).toBeLessThanOrEqual(240);
        doe.text!.style = { fontFamily: "Arial", fontSize: 20, fill: 0xabcdef };
        expect(labelLines(doe)[0]!.style.fill).toBe(0xabcdef);
        const renders = engine.renders.length;
        engine.displayOptions.optionListeners["zotlit-author-title-labels"]!(
          false,
        );
        yield* fixture.advance(150);
        expect(engine.renders.length).toBe(renders + 1);
        expect(doe.text).toBeInstanceOf(FakeLabelText);
        expect(doe).toHaveProperty(
          "initGraphics",
          Reflect.get(FakeLabelNode.prototype, "initGraphics"),
        );
      }),
  );

  it.effect(
    "keeps the held labels on screen while a database change reads them again",
    () =>
      Effect.gen(function* () {
        using _pixi = installFakeLabelPixi();
        const fixture = yield* makePresentationFixture({ labelDatabase: true });
        const engine = fixture.addLeaf("graph");
        engine.nodes = () => ({ "Literature/Doe 2024.md": graphNode("") });
        yield* fixture.layoutReady;
        engine.setOptions({ "zotlit-author-title-labels": true });
        yield* fixture.advance(150);
        const doe = engine.renderer.nodes[0]!;
        doe.initGraphics();
        expect(labelLines(doe)[0]!.text).toBe("Doe 2024");

        const reading = Promise.withResolvers<LabelRow[]>();
        labelReads.mockReturnValue(reading.promise);
        fixture.reads.emit("changed");
        yield* fixture.advance(150);

        expect(labelReads).toHaveBeenCalledTimes(2);
        expect(labelLines(doe)[0]!.text).toBe("Doe 2024");
        reading.resolve([
          {
            key: "DEE23456",
            primaryCreatorType: "author",
            creators: [
              {
                creatorType: "author",
                lastName: "Lee",
                firstName: "",
                fieldMode: 0,
              },
            ],
            fields: { title: "Graph study", date: "2025" },
          },
        ]);
        yield* fixture.advance(0);
        expect(labelLines(doe)[0]!.text).toBe("Lee 2025");
      }),
  );

  it.effect("keeps native labels for unreadable items and missing PIXI", () =>
    Effect.gen(function* () {
      using _pixi = installFakeLabelPixi();
      const fixture = yield* makePresentationFixture({ labelDatabase: true });
      const engine = fixture.addLeaf("graph");
      engine.nodes = () => ({
        "Literature/Doe 2024.md": graphNode(""),
        "@pine2023": graphNode("unresolved"),
        "@roe2025": graphNode("unresolved"),
        "@typo2024": graphNode("unresolved"),
        "Other.md": graphNode(""),
      });
      yield* fixture.layoutReady;
      labelReads.mockReturnValue([]);
      engine.setOptions({ "zotlit-author-title-labels": true });
      yield* fixture.advance(150);
      const node = engine.renderer.nodes.find(
        (node) => node.id === "Literature/Doe 2024.md",
      )!;
      node.initGraphics();
      expect(node.text).toBeInstanceOf(FakeLabelText);
      labelReads.mockImplementation((keys: string[]) =>
        keys.map((key) => ({
          key,
          primaryCreatorType: "author",
          creators: [
            { creatorType: "author", lastName: "Doe", firstName: "Jane" },
          ],
          fields: { itemType: "book", title: "Graph study" },
        })),
      );
      vi.stubGlobal("PIXI", undefined);
      fixture.citationIndex.emit("changed");
      yield* fixture.advance(150);
      expect(node.text).toBeInstanceOf(FakeLabelText);
      expect(warn).toHaveBeenCalledWith(
        "Graph Work Label graphics failed; left native",
        expect.objectContaining({ nodeId: node.id }),
      );
    }),
  );

  it.effect("leaves excluded Library items native", () =>
    Effect.gen(function* () {
      using _pixi = installFakeLabelPixi();
      const fixture = yield* makePresentationFixture({
        labelDatabase: true,
        labelLibraryScope: [],
      });
      const first = fixture.addLeaf("graph");
      const second = fixture.addLeaf("localgraph");
      for (const engine of [first, second]) {
        engine.nodes = () => ({ "Literature/Doe 2024.md": graphNode("") });
      }
      yield* fixture.layoutReady;
      for (const engine of [first, second])
        engine.setOptions({ "zotlit-author-title-labels": true });
      yield* fixture.advance(150);
      for (const engine of [first, second]) {
        engine.renderer.nodes[0]!.initGraphics();
        expect(engine.renderer.nodes[0]!.text).toBeInstanceOf(FakeLabelText);
      }
    }),
  );

  it.effect(
    "destroys owned sprites and restores native labels once per leaf on unload",
    () =>
      Effect.gen(function* () {
        using _pixi = installFakeLabelPixi();
        const fixture = yield* makePresentationFixture({ labelDatabase: true });
        const engines = [
          fixture.addLeaf("graph"),
          fixture.addLeaf("localgraph"),
        ];
        for (const engine of engines)
          engine.nodes = () => ({ "Literature/Doe 2024.md": graphNode("") });
        yield* fixture.layoutReady;
        for (const engine of engines)
          engine.setOptions({ "zotlit-author-title-labels": true });
        yield* fixture.advance(150);
        const snapshots = engines.map((engine) => {
          const node = engine.renderer.nodes[0]!;
          node.initGraphics();
          return {
            engine,
            node,
            lines: labelLines(node),
            renders: engine.renders.length,
          };
        });
        expect(labelReads).toHaveBeenCalledOnce();
        yield* fixture.unload;
        for (const { engine, node, lines, renders } of snapshots) {
          expect(node.text).toBeInstanceOf(FakeLabelText);
          expect(lines.every((line) => line.destroyed)).toBe(true);
          expect(engine.renders.length).toBe(renders + 1);
        }
      }),
  );

  it.effect(
    "restores native text after a failed style update and requests a frame",
    () =>
      Effect.gen(function* () {
        using _pixi = installFakeLabelPixi();
        const fixture = yield* makePresentationFixture({ labelDatabase: true });
        const engine = fixture.addLeaf("graph");
        engine.nodes = () => ({ "Literature/Doe 2024.md": graphNode("") });
        yield* fixture.layoutReady;
        engine.setOptions({ "zotlit-author-title-labels": true });
        yield* fixture.advance(150);
        const node = engine.renderer.nodes[0]!;
        node.initGraphics();
        const container = node.text;
        const lines = labelLines(node);
        Object.defineProperty(lines[0], "width", {
          get: () => {
            throw new Error("font measurement failed");
          },
        });
        engine.renderer.pending = false;
        const frameRequested = Promise.withResolvers<void>();
        const changed = engine.renderer.changed.bind(engine.renderer);
        using _changed = vi
          .spyOn(engine.renderer, "changed")
          .mockImplementation(() => {
            changed();
            frameRequested.resolve();
          });
        node.text!.style = {
          fontFamily: "Arial",
          fontSize: 22,
          fill: 0xffffff,
        };
        expect(node.text).toBe(container);
        yield* Effect.promise(() => frameRequested.promise);
        expect(node.text).toBeInstanceOf(FakeLabelText);
        expect(lines.every((line) => line.destroyed)).toBe(true);
        expect(engine.renderer.pending).toBe(true);
        expect(warn).toHaveBeenCalledWith(
          "Graph Work Label style refresh failed; restoring native text",
          expect.objectContaining({ nodeId: node.id }),
        );
      }),
  );
});
