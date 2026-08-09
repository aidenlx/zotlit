// @vitest-environment happy-dom
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { CslItemData } from "@zotlit/db";

import type { DatabaseEvents } from "@/services/database/service";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import type { ZoteroPrefEvents } from "@/services/zotero-pref/service";

import type {
  BibliographyEntry,
  BibliographyRequest,
  CitationEngine,
  CitationRequest,
  DocumentRequest,
} from "./engine";
import { BibliographyRenderCache } from "./render-cache";
import type { PandocEngineStatus } from "./service";

const APA = "http://www.zotero.org/styles/apa";
const IEEE = "http://www.zotero.org/styles/ieee";

function item(id: string): CslItemData {
  return { id, type: "article-journal" };
}

/** One engine, counting the renders it was asked for. */
class EngineStub implements CitationEngine {
  readonly requests: BibliographyRequest[] = [];
  readonly citationRequests: CitationRequest[] = [];
  /** Set to make the next render fail, as an engine that refuses one does. */
  fails = false;

  renderBibliography(
    request: BibliographyRequest,
  ): Promise<BibliographyEntry[]> {
    this.requests.push(request);
    if (this.fails) return Promise.reject(new Error("no"));
    return Promise.resolve(
      request.items.map(({ id }, index) => ({
        id,
        marker: String(index + 1),
        content: fragment(`entry for ${id}`),
      })),
    );
  }

  renderCitations(request: CitationRequest): Promise<DocumentFragment[]> {
    this.citationRequests.push(request);
    if (this.fails) return Promise.reject(new Error("no"));
    return Promise.resolve(
      request.citations.map((source) => fragment(`cite for ${source}`)),
    );
  }

  renderDocument(_request: DocumentRequest): Promise<Uint8Array> {
    throw new Error("not used");
  }

  [Symbol.asyncDispose](): Promise<void> {
    return Promise.resolve();
  }
}

function fragment(text: string): DocumentFragment {
  const content = document.createDocumentFragment();
  content.append(text);
  return content;
}

class PandocEngineStub {
  readonly engine = new EngineStub();
  #status: PandocEngineStatus = { kind: "installed", version: "3.10" };
  readonly #listeners = new Set<() => void>();

  getStatus(): PandocEngineStatus {
    return this.#status;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getEngine(): Promise<CitationEngine> {
    return Promise.resolve(this.engine);
  }

  /** An install, an uninstall, or a restart: every one wakes the subscribers. */
  setStatus(status: PandocEngineStatus): void {
    this.#status = status;
    for (const listener of this.#listeners) listener();
  }
}

/** The one database event the cache listens for: a new working client. */
class DatabaseStub {
  readonly #listeners = new Set<() => void>();

  on<K extends keyof DatabaseEvents>(
    event: K,
    cb: DatabaseEvents[K],
  ): () => void {
    const listener = cb as () => void;
    if (event === "changed") this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  changed(): void {
    for (const listener of this.#listeners) listener();
  }
}

class ZoteroPrefStub {
  readonly #listeners = new Set<() => void>();

  constructor(
    /** Zotero data directory whose installed styles are available to renders. */
    readonly dataDir = "/nowhere/zotlit-render-cache",
  ) {}

  on<K extends keyof ZoteroPrefEvents>(
    event: K,
    cb: ZoteroPrefEvents[K],
  ): () => void {
    const listener = cb as () => void;
    if (event === "resolved-changed") this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Another Zotero data directory: another library, and other styles. */
  resolvedChanged(): void {
    for (const listener of this.#listeners) listener();
  }
}

class SettingsStub {
  current: Readonly<Settings>;
  readonly ready = Promise.resolve();
  readonly #listeners = new Set<
    (settings: Readonly<Settings> | null) => void
  >();

  constructor(overrides: Partial<Settings> = {}) {
    this.current = { ...defaults, ...overrides };
  }

  subscribe(
    listener: (settings: Readonly<Settings> | null) => void,
  ): () => void {
    this.#listeners.add(listener);
    listener(this.current);
    return () => this.#listeners.delete(listener);
  }

  update(overrides: Partial<Settings>): void {
    this.current = { ...this.current, ...overrides };
    for (const listener of this.#listeners) listener(this.current);
  }
}

interface Harness {
  cache: BibliographyRenderCache;
  engine: EngineStub;
  pandocEngine: PandocEngineStub;
  db: DatabaseStub;
  zoteroPref: ZoteroPrefStub;
  settings: SettingsStub;
  /** Every `invalidated` the cache announced. */
  invalidations: number[];
  /** Unavailable selected styles announced during this plugin lifecycle. */
  missingStyles: string[];
}

const caches: BibliographyRenderCache[] = [];

afterEach(async () => {
  for (const cache of caches.splice(0)) await cache[Symbol.asyncDispose]();
});

async function makeHarness(
  overrides: Partial<Settings> = {},
  dataDir?: string,
): Promise<Harness> {
  const db = new DatabaseStub();
  const pandocEngine = new PandocEngineStub();
  const zoteroPref = new ZoteroPrefStub(dataDir);
  const settings = new SettingsStub({
    "citation.references-style": null,
    ...overrides,
  });
  const cache = new BibliographyRenderCache({
    db,
    pandocEngine,
    zoteroPref,
    settings,
  });
  caches.push(cache);
  await cache.ready;

  const invalidations: number[] = [];
  cache.on("invalidated", () => invalidations.push(invalidations.length + 1));
  const missingStyles: string[] = [];
  cache.onStyleMissing((styleId) => missingStyles.push(styleId));

  return {
    cache,
    engine: pandocEngine.engine,
    pandocEngine,
    db,
    zoteroPref,
    settings,
    invalidations,
    missingStyles,
  };
}

async function installStyle(styleId: string): Promise<
  AsyncDisposable & {
    dataDir: string;
  }
> {
  const dataDir = await mkdtemp(join(tmpdir(), "zotlit-render-style-"));
  const stylesDir = join(dataDir, "styles");
  await mkdir(stylesDir, { recursive: true });
  await writeFile(
    join(stylesDir, "selected.csl"),
    [
      '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">',
      `<info><title>Selected</title><id>${styleId}</id></info>`,
      "<bibliography><layout /></bibliography>",
      "</style>",
    ].join("\n"),
  );
  return {
    dataDir,
    async [Symbol.asyncDispose]() {
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

describe("BibliographyRenderCache", () => {
  it("hands two consumers of the same ordered cited set one render", async () => {
    const { cache, engine } = await makeHarness();
    const items = [item("alpha"), item("zebra")];

    const [first, second] = await Promise.all([
      cache.render(items),
      cache.render([item("alpha"), item("zebra")]),
    ]);
    const third = await cache.render([item("alpha"), item("zebra")]);

    expect(engine.requests).toHaveLength(1);
    expect(first).toMatchObject({
      kind: "rendered",
      entries: [{ id: "alpha" }, { id: "zebra" }],
      hasEntryMarkers: true,
    });
    if (
      first.kind !== "rendered" ||
      second.kind !== "rendered" ||
      third.kind !== "rendered"
    ) {
      throw new Error("bibliography render missing");
    }
    expect(first.entries).toBe(second.entries);
    expect(first.entries).toBe(third.entries);
  });

  it("renders again for a different cited set, order included", async () => {
    const { cache, engine } = await makeHarness();

    await cache.render([item("alpha"), item("zebra")]);
    await cache.render([item("zebra"), item("alpha")]);
    await cache.render([item("alpha")]);

    expect(engine.requests).toHaveLength(3);
  });

  it("drops every render when the Zotero database changes", async () => {
    const { cache, engine, db, invalidations } = await makeHarness();
    const items = [item("alpha")];

    await cache.render(items);
    db.changed();
    await cache.render(items);

    expect(invalidations).toHaveLength(1);
    expect(engine.requests).toHaveLength(2);
  });

  it("drops every render when the Zotero data directory moves", async () => {
    const { cache, engine, zoteroPref, invalidations } = await makeHarness();
    const items = [item("alpha")];

    await cache.render(items);
    zoteroPref.resolvedChanged();
    await cache.render(items);

    expect(invalidations).toHaveLength(1);
    expect(engine.requests).toHaveLength(2);
  });

  it("drops every render when the Citation and References Style changes", async () => {
    const { cache, engine, settings, invalidations } = await makeHarness();
    const items = [item("alpha")];

    await cache.render(items);
    settings.update({ "citation.references-style": IEEE });
    const changed = await cache.render(items);
    // The same style again is no change at all.
    settings.update({ "citation.references-style": IEEE });

    expect(invalidations).toHaveLength(1);
    expect(changed).toEqual({
      kind: "unavailable",
      reason: "style-missing",
    });
    expect(engine.requests).toHaveLength(1);
  });

  it("drops every render when the engine comes or goes", async () => {
    const { cache, engine, pandocEngine, invalidations } = await makeHarness();
    const items = [item("alpha")];

    await cache.render(items);
    pandocEngine.setStatus({ kind: "installed", version: "3.11" });
    await cache.render(items);

    expect(invalidations).toHaveLength(1);
    expect(engine.requests).toHaveLength(2);
  });

  it("formats nothing while no engine is installed", async () => {
    const { cache, engine, pandocEngine, missingStyles } = await makeHarness({
      "citation.references-style": APA,
    });
    pandocEngine.setStatus({ kind: "absent" });

    await expect(cache.render([item("alpha")])).resolves.toEqual({
      kind: "unavailable",
      reason: "engine-absent",
    });
    expect(engine.requests).toHaveLength(0);
    expect(missingStyles).toEqual([]);
  });

  it("formats nothing for a document that cites nothing", async () => {
    const { cache, engine } = await makeHarness();

    await expect(cache.render([])).resolves.toEqual({
      kind: "rendered",
      entries: [],
      hasEntryMarkers: false,
    });
    expect(engine.requests).toHaveLength(0);
  });

  it("asks again after a render the engine refused", async () => {
    const { cache, engine } = await makeHarness();
    const items = [item("alpha")];

    engine.fails = true;
    await expect(cache.render(items)).resolves.toEqual({ kind: "failed" });
    engine.fails = false;
    await expect(cache.render(items)).resolves.toMatchObject({
      kind: "rendered",
    });

    expect(engine.requests).toHaveLength(2);
  });

  it("keeps an unavailable selected style out of every formatting surface", async () => {
    const { cache, engine, missingStyles } = await makeHarness({
      "citation.references-style": APA,
    });

    await expect(cache.render([item("alpha")])).resolves.toEqual({
      kind: "unavailable",
      reason: "style-missing",
    });
    await expect(
      cache.renderCitations(["[@alpha]"], [item("alpha")]),
    ).resolves.toBeNull();
    await cache.render([item("alpha")]);

    expect(engine.requests).toHaveLength(0);
    expect(engine.citationRequests).toHaveLength(0);
    expect(missingStyles).toEqual([APA]);

    const lateMissingStyles: string[] = [];
    cache.onStyleMissing((styleId) => lateMissingStyles.push(styleId));
    expect(lateMissingStyles).toEqual([APA]);
  });

  it("uses the selected installed style for bibliography and in-text formatting", async () => {
    await using installed = await installStyle(APA);
    const { cache, engine } = await makeHarness(
      { "citation.references-style": APA },
      installed.dataDir,
    );

    await cache.render([item("alpha")]);
    await cache.renderCitations(["[@alpha]"], [item("alpha")]);

    expect(engine.requests[0]?.styleXml).toContain(`<id>${APA}</id>`);
    expect(engine.citationRequests[0]?.styleXml).toContain(`<id>${APA}</id>`);
  });
});

describe("BibliographyRenderCache citations", () => {
  const items = [item("alpha")];

  it("hands two consumers of the same document one render", async () => {
    const { cache, engine } = await makeHarness();

    const [first, second] = await Promise.all([
      cache.renderCitations(["[@alpha]", "@alpha"], items),
      cache.renderCitations(["[@alpha]", "@alpha"], items),
    ]);

    expect(engine.citationRequests).toHaveLength(1);
    expect(first).toBe(second);
    expect(first?.map((citation) => citation.textContent)).toEqual([
      "cite for [@alpha]",
      "cite for @alpha",
    ]);
  });

  it("renders again for other citations of the same cited set", async () => {
    const { cache, engine } = await makeHarness();

    await cache.renderCitations(["[@alpha]"], items);
    await cache.renderCitations(["@alpha"], items);

    expect(engine.citationRequests).toHaveLength(2);
  });

  it("drops citation renders with the bibliography renders", async () => {
    const { cache, engine, settings } = await makeHarness();

    await cache.renderCitations(["[@alpha]"], items);
    settings.update({ "citation.references-style": IEEE });
    const changed = await cache.renderCitations(["[@alpha]"], items);

    expect(changed).toBeNull();
    expect(engine.citationRequests).toHaveLength(1);
  });

  it("formats nothing while no engine is installed", async () => {
    const { cache, engine, pandocEngine } = await makeHarness();
    pandocEngine.setStatus({ kind: "absent" });

    await expect(
      cache.renderCitations(["[@alpha]"], items),
    ).resolves.toBeNull();
    expect(engine.citationRequests).toHaveLength(0);
  });

  it("formats nothing for a document that cites nothing", async () => {
    const { cache, engine } = await makeHarness();

    await expect(cache.renderCitations([], [])).resolves.toEqual([]);
    expect(engine.citationRequests).toHaveLength(0);
  });

  it("asks again after a render the engine refused", async () => {
    const { cache, engine } = await makeHarness();

    engine.fails = true;
    await expect(
      cache.renderCitations(["[@alpha]"], items),
    ).resolves.toBeNull();
    engine.fails = false;
    await expect(
      cache.renderCitations(["[@alpha]"], items),
    ).resolves.not.toBeNull();

    expect(engine.citationRequests).toHaveLength(2);
  });
});
