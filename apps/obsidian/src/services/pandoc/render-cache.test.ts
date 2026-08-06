// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import { type CslItemData } from "@zotlit/db";

import { type DatabaseEvents } from "@/services/database/service";
import { defaults, type Settings } from "@/services/settings/schema";
import { type ZoteroPrefEvents } from "@/services/zotero-pref/service";

import {
  type BibliographyEntry,
  type BibliographyRequest,
  type CitationEngine,
  type DocumentRequest,
} from "./engine";
import { BibliographyRenderCache } from "./render-cache";
import { type PandocEngineStatus } from "./service";

const APA = "http://www.zotero.org/styles/apa";
const IEEE = "http://www.zotero.org/styles/ieee";

function item(id: string): CslItemData {
  return { id, type: "article-journal" };
}

/** One engine, counting the renders it was asked for. */
class EngineStub implements CitationEngine {
  readonly requests: BibliographyRequest[] = [];
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
  /** No styles are installed there, so every render uses the embedded style. */
  readonly dataDir = "/nowhere/zotlit-render-cache";
  readonly #listeners = new Set<() => void>();

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
}

const caches: BibliographyRenderCache[] = [];

afterEach(async () => {
  for (const cache of caches.splice(0)) await cache[Symbol.asyncDispose]();
});

async function makeHarness(
  overrides: Partial<Settings> = {},
): Promise<Harness> {
  const db = new DatabaseStub();
  const pandocEngine = new PandocEngineStub();
  const zoteroPref = new ZoteroPrefStub();
  const settings = new SettingsStub({
    "citation.references-style": APA,
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

  return {
    cache,
    engine: pandocEngine.engine,
    pandocEngine,
    db,
    zoteroPref,
    settings,
    invalidations,
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
    expect(first).toBe(second);
    expect(first).toBe(third);
    expect(first?.map((entry) => entry.id)).toEqual(["alpha", "zebra"]);
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

  it("drops every render when the References Style changes", async () => {
    const { cache, engine, settings, invalidations } = await makeHarness();
    const items = [item("alpha")];

    await cache.render(items);
    settings.update({ "citation.references-style": IEEE });
    await cache.render(items);
    // The same style again is no change at all.
    settings.update({ "citation.references-style": IEEE });

    expect(invalidations).toHaveLength(1);
    expect(engine.requests).toHaveLength(2);
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
    const { cache, engine, pandocEngine } = await makeHarness();
    pandocEngine.setStatus({ kind: "absent" });

    await expect(cache.render([item("alpha")])).resolves.toBeNull();
    expect(engine.requests).toHaveLength(0);
  });

  it("formats nothing for a document that cites nothing", async () => {
    const { cache, engine } = await makeHarness();

    await expect(cache.render([])).resolves.toEqual([]);
    expect(engine.requests).toHaveLength(0);
  });

  it("asks again after a render the engine refused", async () => {
    const { cache, engine } = await makeHarness();
    const items = [item("alpha")];

    engine.fails = true;
    await expect(cache.render(items)).resolves.toBeNull();
    engine.fails = false;
    await expect(cache.render(items)).resolves.not.toBeNull();

    expect(engine.requests).toHaveLength(2);
  });
});
