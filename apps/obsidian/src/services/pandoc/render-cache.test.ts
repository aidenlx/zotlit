import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { CslItemData } from "@zotlit/db";

import type { ProfileId } from "@/lib/profile-stamp";
import type { DatabaseEvents } from "@/services/database/service";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import type { ResolvedLiteratureNoteProfileBindings } from "@/services/settings/service";
import type { ZoteroPrefEvents } from "@/services/zotero-pref/service";

import type { Inlines } from "./ast";
import type {
  BibliographyEntry,
  BibliographyRequest,
  CitationEngine,
  CitationRequest,
  DocumentRequest,
  RenderedCitation,
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
  ): Promise<readonly BibliographyEntry[]> {
    this.requests.push(request);
    if (this.fails) return Promise.reject(new Error("no"));
    return Promise.resolve(
      request.items.map(({ id }, index) => ({
        id,
        marker: inlines(String(index + 1)),
        content: inlines(`entry for ${id}`),
      })),
    );
  }

  renderCitations(
    request: CitationRequest,
  ): Promise<readonly RenderedCitation[]> {
    this.citationRequests.push(request);
    if (this.fails) return Promise.reject(new Error("no"));
    return Promise.resolve(
      request.citations.map((source) => ({
        content: inlines(`cite for ${source}`),
        citations: [],
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

function inlines(text: string): Inlines {
  return [{ t: "Str", c: text }];
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

  constructor(overrides: SettingsOverrides = {}) {
    this.current = applySettingsOverrides(defaults, overrides);
  }

  subscribe(
    listener: (settings: Readonly<Settings> | null) => void,
  ): () => void {
    this.#listeners.add(listener);
    listener(this.current);
    return () => this.#listeners.delete(listener);
  }

  update(overrides: SettingsOverrides): void {
    this.current = applySettingsOverrides(this.current, overrides);
    for (const listener of this.#listeners) listener(this.current);
  }
}

type SettingsOverrides = Partial<Settings> &
  Pick<
    Partial<ResolvedLiteratureNoteProfileBindings>,
    "citation.references-style"
  >;

function applySettingsOverrides(
  current: Readonly<Settings>,
  overrides: SettingsOverrides,
): Settings {
  const { ["citation.references-style"]: referencesStyle, ...persisted } =
    overrides;
  return {
    ...current,
    ...persisted,
    "note.default-profile": {
      ...current["note.default-profile"],
      ...persisted["note.default-profile"],
      bindings: {
        ...current["note.default-profile"].bindings,
        ...persisted["note.default-profile"]?.bindings,
        ...(referencesStyle === undefined
          ? {}
          : { "citation.references-style": referencesStyle }),
      },
    },
  };
}

/** One render cache and the stubs it reads, torn down with the test that holds it. */
interface Harness extends AsyncDisposable {
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

async function makeHarness(
  overrides: SettingsOverrides = {},
  dataDir?: string,
): Promise<Harness> {
  await using stack = new AsyncDisposableStack();
  const db = new DatabaseStub();
  const pandocEngine = new PandocEngineStub();
  const zoteroPref = new ZoteroPrefStub(dataDir);
  const settings = new SettingsStub({
    "citation.references-style": null,
    ...overrides,
  });
  const cache = stack.use(
    new BibliographyRenderCache({
      db,
      pandocEngine,
      zoteroPref,
      settings,
    }),
  );
  await cache.ready;

  const invalidations: number[] = [];
  cache.on("invalidated", () => invalidations.push(invalidations.length + 1));
  const missingStyles: string[] = [];
  cache.onStyleMissing((styleId) => missingStyles.push(styleId));

  const held = stack.move();
  return {
    cache,
    engine: pandocEngine.engine,
    pandocEngine,
    db,
    zoteroPref,
    settings,
    invalidations,
    missingStyles,
    [Symbol.asyncDispose]: () => held[Symbol.asyncDispose](),
  };
}

function independentXml(styleId: string, title = "Selected"): string {
  return [
    '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">',
    `<info><title>${title}</title><id>${styleId}</id></info>`,
    "<bibliography><layout /></bibliography>",
    "</style>",
  ].join("\n");
}

async function installStyle(...styleIds: readonly string[]): Promise<
  AsyncDisposable & {
    dataDir: string;
    /** Rewrite one installed style, as an edit in Zotero leaves it. */
    edit(index: number, xml: string): Promise<void>;
  }
> {
  await using stack = new AsyncDisposableStack();
  const dataDir = stack.adopt(
    await mkdtemp(join(tmpdir(), "zotlit-render-style-")),
    (dir) => rm(dir, { recursive: true, force: true }),
  );
  const stylesDir = join(dataDir, "styles");
  await mkdir(stylesDir, { recursive: true });
  for (const [index, styleId] of styleIds.entries()) {
    await writeFile(
      join(stylesDir, `selected-${index}.csl`),
      independentXml(styleId),
    );
  }
  /** A whole-second timestamp, which every filesystem stores exactly. */
  let written = 1_700_000_000;
  const edit = async (index: number, xml: string): Promise<void> => {
    const path = join(stylesDir, `selected-${index}.csl`);
    await writeFile(path, xml);
    written += 1;
    await utimes(path, written, written);
  };
  const held = stack.move();
  return {
    dataDir,
    edit,
    [Symbol.asyncDispose]: () => held[Symbol.asyncDispose](),
  };
}

const DEPENDENT = "http://www.zotero.org/styles/dependent";

/**
 * One dependent style beside both independent parents it can name, so pointing
 * it at the other parent is a single file write. Each write moves the file's
 * timestamp on, which is what tells the resolver to read the file again.
 */
async function installDependent(parentId: string): Promise<
  AsyncDisposable & {
    dataDir: string;
    pointAt(parentId: string): Promise<void>;
  }
> {
  await using stack = new AsyncDisposableStack();
  const dataDir = stack.adopt(
    await mkdtemp(join(tmpdir(), "zotlit-render-parent-")),
    (dir) => rm(dir, { recursive: true, force: true }),
  );
  const stylesDir = join(dataDir, "styles");
  await mkdir(join(stylesDir, "hidden"), { recursive: true });
  for (const [index, id] of [APA, IEEE].entries()) {
    await writeFile(
      join(stylesDir, "hidden", `parent-${index}.csl`),
      independentXml(id),
    );
  }
  const path = join(stylesDir, "dependent.csl");
  /** A whole-second timestamp, which every filesystem stores exactly. */
  let written = 1_700_000_000;
  const pointAt = async (id: string): Promise<void> => {
    await writeFile(
      path,
      [
        '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">',
        `<info><title>Dependent</title><id>${DEPENDENT}</id>`,
        `<link href="${id}" rel="independent-parent"/></info>`,
        "</style>",
      ].join("\n"),
    );
    written += 1;
    await utimes(path, written, written);
  };
  await pointAt(parentId);
  const held = stack.move();
  return {
    dataDir,
    pointAt,
    [Symbol.asyncDispose]: () => held[Symbol.asyncDispose](),
  };
}

describe("BibliographyRenderCache", () => {
  it("hands two consumers of the same ordered cited set one render", async () => {
    await using harness = await makeHarness();
    const { cache, engine } = harness;
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
    await using harness = await makeHarness();
    const { cache, engine } = harness;

    await cache.render([item("alpha"), item("zebra")]);
    await cache.render([item("zebra"), item("alpha")]);
    await cache.render([item("alpha")]);

    expect(engine.requests).toHaveLength(3);
  });

  it("drops every render when the Zotero database changes", async () => {
    await using harness = await makeHarness();
    const { cache, engine, db, invalidations } = harness;
    const items = [item("alpha")];

    await cache.render(items);
    db.changed();
    await cache.render(items);

    expect(invalidations).toHaveLength(1);
    expect(engine.requests).toHaveLength(2);
  });

  it("drops every render when the Zotero data directory moves", async () => {
    await using harness = await makeHarness();
    const { cache, engine, zoteroPref, invalidations } = harness;
    const items = [item("alpha")];

    await cache.render(items);
    zoteroPref.resolvedChanged();
    await cache.render(items);

    expect(invalidations).toHaveLength(1);
    expect(engine.requests).toHaveLength(2);
  });

  it("drops every render when the Citation and References Style changes", async () => {
    await using harness = await makeHarness();
    const { cache, engine, settings, invalidations } = harness;
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

  it("drops every render when a named Profile citation style changes", async () => {
    await using harness = await makeHarness();
    const { cache, settings, invalidations } = harness;

    await cache.render([item("alpha")]);
    settings.update({
      "note.profiles": [
        {
          id: "Bk3Qn7XvT2Lp" as ProfileId,
          label: "Research",
          bindings: { "citation.references-style": IEEE },
        },
      ],
    });

    expect(invalidations).toHaveLength(1);
  });

  it("drops every render when the engine comes or goes", async () => {
    await using harness = await makeHarness();
    const { cache, engine, pandocEngine, invalidations } = harness;
    const items = [item("alpha")];

    await cache.render(items);
    pandocEngine.setStatus({ kind: "installed", version: "3.11" });
    await cache.render(items);

    expect(invalidations).toHaveLength(1);
    expect(engine.requests).toHaveLength(2);
  });

  it("formats nothing while no engine is installed", async () => {
    await using harness = await makeHarness({
      "citation.references-style": APA,
    });
    const { cache, engine, pandocEngine, missingStyles } = harness;
    pandocEngine.setStatus({ kind: "absent" });

    await expect(cache.render([item("alpha")])).resolves.toEqual({
      kind: "unavailable",
      reason: "engine-absent",
    });
    expect(engine.requests).toHaveLength(0);
    expect(missingStyles).toEqual([]);
  });

  it("formats nothing for a document that cites nothing", async () => {
    await using harness = await makeHarness();
    const { cache, engine } = harness;

    await expect(cache.render([])).resolves.toEqual({
      kind: "rendered",
      entries: [],
      hasEntryMarkers: false,
    });
    expect(engine.requests).toHaveLength(0);
  });

  it("stops a document that cites nothing under a style it cannot reach", async () => {
    await using installed = await installStyle(APA);
    await using harness = await makeHarness(
      { "citation.references-style": APA },
      installed.dataDir,
    );
    const { cache, missingStyles } = harness;

    await expect(cache.render([], { styleId: IEEE })).resolves.toEqual({
      kind: "unavailable",
      reason: "style-missing",
    });
    expect(missingStyles).toEqual([]);
  });

  it("asks again after a render the engine refused", async () => {
    await using harness = await makeHarness();
    const { cache, engine } = harness;
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
    await using harness = await makeHarness({
      "citation.references-style": APA,
    });
    const { cache, engine, missingStyles } = harness;

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
    await using harness = await makeHarness(
      { "citation.references-style": APA },
      installed.dataDir,
    );
    const { cache, engine } = harness;

    await cache.render([item("alpha")]);
    await cache.renderCitations(["[@alpha]"], [item("alpha")]);

    expect(engine.requests[0]?.styleXml).toContain(`<id>${APA}</id>`);
    expect(engine.citationRequests[0]?.styleXml).toContain(`<id>${APA}</id>`);
  });

  it("renders the style and Citation Locale a request names of its own", async () => {
    await using installed = await installStyle(APA, IEEE);
    await using harness = await makeHarness(
      { "citation.references-style": APA },
      installed.dataDir,
    );
    const { cache, engine } = harness;

    await cache.render([item("alpha")], { styleId: IEEE });
    await cache.renderCitations(["[@alpha]"], [item("alpha")], {
      styleId: IEEE,
      locale: "de-DE",
    });

    expect(engine.requests[0]?.styleXml).toContain(`<id>${IEEE}</id>`);
    expect(engine.citationRequests[0]?.styleXml).toContain(
      'default-locale="de-DE"',
    );
  });

  it("renders every surface in the vault Citation Locale", async () => {
    await using installed = await installStyle(APA);
    await using harness = await makeHarness(
      { "citation.references-style": APA, "citation.locale": "de-DE" },
      installed.dataDir,
    );
    const { cache, engine } = harness;

    await cache.render([item("alpha")]);
    await cache.renderCitations(["[@alpha]"], [item("alpha")]);

    expect(engine.requests[0]?.styleXml).toContain('default-locale="de-DE"');
    expect(engine.citationRequests[0]?.styleXml).toContain(
      'default-locale="de-DE"',
    );
  });

  it("renders the embedded default style in the vault Citation Locale", async () => {
    await using harness = await makeHarness({ "citation.locale": "de-DE" });
    const { cache, engine } = harness;

    await cache.render([item("alpha")]);

    expect(engine.requests[0]?.styleXml).toBeUndefined();
    expect(engine.requests[0]?.locale).toBe("de-DE");
  });

  it("leaves an empty vault Citation Locale to the style", async () => {
    await using harness = await makeHarness({ "citation.locale": "" });
    const { cache, engine } = harness;

    await cache.render([item("alpha")]);

    expect(engine.requests[0]?.locale).toBeUndefined();
  });

  it("drops every render when the vault Citation Locale changes", async () => {
    await using harness = await makeHarness();
    const { cache, engine, settings, invalidations } = harness;
    const items = [item("alpha")];

    await cache.render(items);
    await cache.renderCitations(["[@alpha]"], items);
    settings.update({ "citation.locale": "de-DE" });
    await cache.render(items);
    await cache.renderCitations(["[@alpha]"], items);
    // The same locale again is no change at all.
    settings.update({ "citation.locale": "de-DE" });

    expect(invalidations).toHaveLength(1);
    expect(engine.requests).toHaveLength(2);
    expect(engine.citationRequests).toHaveLength(2);
    expect(engine.requests[1]?.locale).toBe("de-DE");
    expect(engine.citationRequests[1]?.locale).toBe("de-DE");
  });

  it("renders the embedded default style for a request that names Default", async () => {
    await using installed = await installStyle(APA);
    await using harness = await makeHarness(
      { "citation.references-style": APA },
      installed.dataDir,
    );
    const { cache, engine } = harness;

    await cache.render([item("alpha")], { styleId: null });

    expect(engine.requests[0]?.styleXml).toBeUndefined();
  });

  it("renders the embedded default style in the Citation Locale a request names", async () => {
    await using harness = await makeHarness();
    const { cache, engine } = harness;

    await cache.render([item("alpha")], { styleId: null, locale: "de-DE" });

    expect(engine.requests[0]?.styleXml).toBeUndefined();
    expect(engine.requests[0]?.locale).toBe("de-DE");
  });

  it("renders again when a dependent style names another parent", async () => {
    await using installed = await installDependent(APA);
    await using harness = await makeHarness(
      { "citation.references-style": DEPENDENT },
      installed.dataDir,
    );
    const { cache, engine } = harness;
    const items = [item("alpha")];

    await cache.render(items);
    await installed.pointAt(IEEE);
    await cache.render(items);

    expect(engine.requests).toHaveLength(2);
    expect(engine.requests[0]?.styleXml).toContain(`<id>${APA}</id>`);
    expect(engine.requests[1]?.styleXml).toContain(`<id>${IEEE}</id>`);
  });

  it("renders again when the selected style's own content changes", async () => {
    await using installed = await installStyle(APA);
    await using harness = await makeHarness(
      { "citation.references-style": APA },
      installed.dataDir,
    );
    const { cache, engine } = harness;
    const items = [item("alpha")];

    await cache.render(items);
    await installed.edit(0, independentXml(APA, "Edited in Zotero"));
    await cache.render(items);

    expect(engine.requests).toHaveLength(2);
    expect(engine.requests[1]?.styleXml).toContain(
      "<title>Edited in Zotero</title>",
    );
  });

  it("holds one render per Citation Presentation", async () => {
    await using installed = await installStyle(APA);
    await using harness = await makeHarness(
      { "citation.references-style": APA },
      installed.dataDir,
    );
    const { cache, engine } = harness;
    const items = [item("alpha")];

    await cache.render(items);
    await cache.render(items, { locale: "de-DE" });
    await cache.render(items, { locale: "de-DE" });

    expect(engine.requests).toHaveLength(2);
    expect(engine.requests[0]?.styleXml).not.toContain("default-locale");
    expect(engine.requests[1]?.styleXml).toContain('default-locale="de-DE"');
  });

  it("blames the vault for its own selection alone", async () => {
    await using installed = await installStyle(APA);
    await using harness = await makeHarness(
      { "citation.references-style": APA },
      installed.dataDir,
    );
    const { cache, missingStyles } = harness;

    await expect(
      cache.render([item("alpha")], { styleId: IEEE }),
    ).resolves.toEqual({ kind: "unavailable", reason: "style-missing" });

    expect(missingStyles).toEqual([]);
  });
});

describe("BibliographyRenderCache citations", () => {
  const items = [item("alpha")];

  it("hands two consumers of the same document one render", async () => {
    await using harness = await makeHarness();
    const { cache, engine } = harness;

    const [first, second] = await Promise.all([
      cache.renderCitations(["[@alpha]", "@alpha"], items),
      cache.renderCitations(["[@alpha]", "@alpha"], items),
    ]);

    expect(engine.citationRequests).toHaveLength(1);
    expect(first).toBe(second);
    expect(first?.map((citation) => citation.content)).toEqual([
      inlines("cite for [@alpha]"),
      inlines("cite for @alpha"),
    ]);
  });

  it("renders again for other citations of the same cited set", async () => {
    await using harness = await makeHarness();
    const { cache, engine } = harness;

    await cache.renderCitations(["[@alpha]"], items);
    await cache.renderCitations(["@alpha"], items);

    expect(engine.citationRequests).toHaveLength(2);
  });

  it("drops citation renders with the bibliography renders", async () => {
    await using harness = await makeHarness();
    const { cache, engine, settings } = harness;

    await cache.renderCitations(["[@alpha]"], items);
    settings.update({ "citation.references-style": IEEE });
    const changed = await cache.renderCitations(["[@alpha]"], items);

    expect(changed).toBeNull();
    expect(engine.citationRequests).toHaveLength(1);
  });

  it("formats nothing while no engine is installed", async () => {
    await using harness = await makeHarness();
    const { cache, engine, pandocEngine } = harness;
    pandocEngine.setStatus({ kind: "absent" });

    await expect(
      cache.renderCitations(["[@alpha]"], items),
    ).resolves.toBeNull();
    expect(engine.citationRequests).toHaveLength(0);
  });

  it("formats nothing for a document that cites nothing", async () => {
    await using harness = await makeHarness();
    const { cache, engine } = harness;

    await expect(cache.renderCitations([], [])).resolves.toEqual([]);
    expect(engine.citationRequests).toHaveLength(0);
  });

  it("asks again after a render the engine refused", async () => {
    await using harness = await makeHarness();
    const { cache, engine } = harness;

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
