import "@mock/dom-parser";
import { TestClock } from "effect/testing";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect } from "vitest";

import type { CslItemData } from "@zotlit/db";

import { Context, Effect, Fiber, Layer, Queue, Stream } from "@/lib/effect";
import { acquireAsyncDisposable } from "@/lib/effect-scope";
import { it } from "@/lib/effect-vitest";
import { profileRuntimeOf } from "@/services/profile/__fixtures__";
import type { ProfileFixtureSettings as Settings } from "@/services/profile/__fixtures__/reader";
import type { ResolvedLiteratureNoteProfileBindings } from "@/services/profile/bindings";
import type { Held } from "@/services/query-client/service";
import { layerQueryClients } from "@/services/query-client/service";
import { defaults } from "@/services/settings/schema";
import { createTemplateHost } from "@/services/template/__fixtures__";
import { zoteroPrefFixture } from "@/services/zotero-pref/__fixtures__";
import type { ZoteroPrefEvents } from "@/services/zotero-pref/plain";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsEvents } from "@/services/zotero-reads/service";

import type { Inlines } from "./ast";
import type {
  BibliographyEntry,
  BibliographyRequest,
  CitationEngine,
  CitationRequest,
  PrepareRequest,
  PreparedDocument,
  RenderedCitation,
  RenderRequest,
} from "./engine";
import { BibliographyRender, layerBibliographyRender } from "./render-cache";
import type { CitationRenderOutcome } from "./render-cache";
import { bibliographyRenderFixture } from "./render-cache/__fixtures__";
import type { BibliographyRenderFixtureOptions } from "./render-cache/__fixtures__";
import type { PandocEngineStatus } from "./service";
import { PandocEngine } from "./service";

const APA = "http://www.zotero.org/styles/apa";
const IEEE = "http://www.zotero.org/styles/ieee";

it.effect.each(["Profile", "preference override"] as const)(
  "#1705: two immediate %s changes each invalidate through the native stream",
  (dependency) =>
    Effect.gen(function* () {
      const profile = yield* profileRuntimeOf(createTemplateHost());
      const { pref } = yield* zoteroPrefFixture();
      const dependencies = yield* profile.runtime.contextEffect;
      // Settle the dependency graph before acquiring the cache under test.
      yield* TestClock.adjust(0);
      const cache = Context.get(
        yield* Layer.build(
          layerBibliographyRender.pipe(
            Layer.provide(Layer.succeedContext(dependencies)),
            Layer.provide(Layer.succeed(ZoteroPref, pref)),
            Layer.provide(layerQueryClients),
            Layer.provide(
              Layer.succeed(ZoteroReads, {
                events: Stream.never,
              } as unknown as ZoteroReads["Service"]),
            ),
            Layer.provide(
              Layer.succeed(PandocEngine, {
                getStatus: () => Effect.succeed({ kind: "absent" }),
                changes: Stream.never,
              } as unknown as PandocEngine["Service"]),
            ),
          ),
        ),
        BibliographyRender,
      );
      const invalidated: unknown[] = [];
      yield* Stream.runForEach(cache.events, (event) =>
        Effect.sync(() => invalidated.push(event._tag)),
      ).pipe(Effect.forkScoped({ startImmediately: true }));
      if (dependency === "Profile") {
        profile.settings.updateDefaultLiteratureNoteProfileBindings({
          "note.literature-folder": "First",
        });
        profile.settings.updateDefaultLiteratureNoteProfileBindings({
          "note.literature-folder": "Second",
        });
      } else {
        yield* pref.setDataDir("/other-data");
        yield* pref.setDataDir(null);
      }
      yield* TestClock.adjust(0);
      expect(invalidated).toEqual(["invalidated", "invalidated"]);
    }),
);

it.effect(
  "#1705: built cache exposes loaded settings and every immediate state change",
  () =>
    Effect.gen(function* () {
      const harness = yield* harnessOf({ "citation.locale": "en-US" });
      expect(harness.cache.vaultPresentation.locale).toBe("en-US");
      const locales: (string | null)[] = [];
      const stop = harness.cache.subscribe((state) =>
        locales.push(state.vaultPresentation.locale),
      );
      harness.settings.update({ "citation.locale": "fr-FR" });
      harness.settings.update({ "citation.locale": "de-DE" });
      yield* TestClock.adjust(0);
      expect(locales).toEqual(["en-US", "fr-FR", "de-DE"]);
      stop();
    }),
);

it.effect.each(["share", "import"] as const)(
  "#1705: preparing a Profile %s with unchanged templates keeps held renders",
  (operation) =>
    Effect.gen(function* () {
      const { profile } = yield* profileRuntimeOf(createTemplateHost());
      const harness = yield* harnessOf({}, undefined, profile);
      const changes: unknown[] = [];
      profile.on("changed", () => changes.push(profile.state));
      const items = [item("alpha")];
      const before = yield* Effect.promise(() =>
        harness.cache.readBibliography(items),
      );
      yield* Effect.promise(async () => {
        if (operation === "share") await profile.prepareShare("default");
        else
          await profile.prepareImport(
            profile
              .getBuiltInSource()
              .replace("id: default", "id: Bk3Qn7XvT2Lp"),
          );
      });
      yield* TestClock.adjust(0);
      expect(changes).toEqual([]);
      expect(harness.invalidations).toEqual([]);
      expect(
        yield* Effect.promise(() => harness.cache.readBibliography(items)),
      ).toBe(before);
      expect(harness.engine.requests).toHaveLength(1);
    }),
);

it.effect(
  "#1705: a late native subscriber sees the unavailable selected style",
  () =>
    Effect.gen(function* () {
      const h = yield* harnessOf({ "citation.references-style": APA });
      yield* Effect.promise(() => h.cache.render([item("alpha")]));
      const service = yield* Effect.promise(() =>
        h.cache.runtime.runPromise(BibliographyRender),
      );
      const values = yield* Stream.runCollect(Stream.take(service.changes, 1));
      expect(values).toEqual([
        {
          vaultPresentation: { styleId: APA, locale: null },
          missingStyle: APA,
        },
      ]);
    }),
);

it.effect.each(["engine-absent", "style-missing"] as const)(
  "#1705: released reads retain the %s outcome",
  (reason) =>
    Effect.gen(function* () {
      const h = yield* harnessOf(
        reason === "style-missing" ? { "citation.references-style": APA } : {},
      );
      if (reason === "engine-absent")
        h.pandocEngine.setStatus({ kind: "absent" });
      yield* Effect.promise(() => h.cache.runtime.dispose());
      yield* Effect.promise(() =>
        expect(h.cache.render([item("alpha")])).resolves.toEqual({
          kind: "unavailable",
          reason,
        }),
      );
      yield* Effect.promise(() =>
        expect(h.cache.readBibliography([item("alpha")])).resolves.toBeNull(),
      );
    }),
);

it.effect(
  "#1705: runtime disposal ends state delivery and releases composing reads",
  () =>
    Effect.gen(function* () {
      const h = yield* harnessOf();
      const service = yield* Effect.promise(() =>
        h.cache.runtime.runPromise(BibliographyRender),
      );
      const subscribed = yield* Queue.unbounded<void>();
      const stream = yield* Stream.runForEach(service.changes, () =>
        Queue.offer(subscribed, undefined),
      ).pipe(Effect.forkScoped());
      yield* Queue.take(subscribed);
      const seen: unknown[] = [];
      h.cache.subscribe((state) => seen.push(state));
      const last = h.cache.state;
      const gate = Promise.withResolvers<void>();
      const started = Promise.withResolvers<void>();
      h.engine.gate = gate;
      h.engine.stamp = () => {
        started.resolve();
        return "";
      };
      const pending = expect(
        h.cache.readBibliography([item("alpha")]),
      ).rejects.toMatchObject({ name: "AbortError" });
      yield* Effect.promise(() => started.promise);
      yield* Effect.promise(() => h.cache.runtime.dispose());
      yield* Fiber.join(stream);
      yield* Effect.promise(() => pending);
      h.settings.update({ "citation.locale": "fr-FR" });
      h.db.changed();
      h.profileEvents.emit("changed");
      h.zoteroPref.resolvedChanged();
      yield* TestClock.adjust(0);
      expect(seen).toEqual([last]);
      expect(h.cache.state).toBe(last);
      expect(h.cache.vaultPresentation).toEqual(last.vaultPresentation);
      yield* Effect.promise(() =>
        expect(h.cache.render([])).resolves.toEqual({
          kind: "unavailable",
          reason: "failed",
        }),
      );
      yield* Effect.promise(() =>
        expect(h.cache.readCitations([], [])).rejects.toMatchObject({
          name: "AbortError",
        }),
      );
      expect(() =>
        h.cache.onStyleMissing(() => {
          throw new Error("closed listener");
        })(),
      ).not.toThrow();
      gate.resolve();
    }),
);

it.effect(
  "#1705: Profile preparation observes changed partials and invalidates held renders",
  () =>
    Effect.gen(function* () {
      const path = "templates/zotlit-partial.summary.md";
      const host = createTemplateHost({ [path]: "Original summary" });
      const { profile } = yield* profileRuntimeOf(host);
      const harness = yield* harnessOf({}, undefined, profile);
      const items = [item("alpha")];
      yield* Effect.promise(() => harness.cache.readBibliography(items));
      host.vault.modifyFile(path, "Updated summary");
      const preparing = profile.prepareShare("default");
      yield* TestClock.adjust(500);
      const plan = yield* Effect.promise(() => preparing);
      expect(
        plan.render({
          version: "1.0.0",
          author: "",
          description: "",
          partials: ["summary"],
        }),
      ).toContain("Updated summary");
      yield* TestClock.adjust(0);
      expect(harness.invalidations).toHaveLength(1);
      yield* Effect.promise(() => harness.cache.readBibliography(items));
      expect(harness.engine.requests).toHaveLength(2);
    }),
);

it.effect(
  "releases a pending bibliography render when the runtime closes (#1705)",
  () =>
    Effect.gen(function* () {
      const harness = yield* harnessOf();
      yield* Effect.promise(async () => {
        const gate = Promise.withResolvers<void>();
        const started = Promise.withResolvers<void>();
        harness.engine.gate = gate;
        harness.engine.stamp = () => {
          started.resolve();
          return "";
        };
        const rendering = expect(
          harness.cache.render([item("alpha")]),
        ).resolves.toEqual({ kind: "unavailable", reason: "failed" });
        await started.promise;
        await harness[Symbol.asyncDispose]();
        try {
          await rendering;
        } finally {
          gate.resolve();
        }
      });
    }),
);

function item(id: string): CslItemData {
  return { id, type: "article-journal" };
}

/** One engine, counting the renders it was asked for. */
class EngineStub implements CitationEngine {
  readonly requests: BibliographyRequest[] = [];
  readonly citationRequests: CitationRequest[] = [];
  /** Set to make the next render fail, as an engine that refuses one does. */
  fails = false;
  /** Set to hold the next render until the test lets it finish. */
  gate: PromiseWithResolvers<void> | null = null;
  /** What each render writes beside its entries, which tells two renders apart. */
  stamp: () => string = () => "";

  renderBibliography(
    request: BibliographyRequest,
  ): Promise<readonly BibliographyEntry[]> {
    this.requests.push(request);
    if (this.fails) return Promise.reject(new Error("no"));
    const stamp = this.stamp();
    const entries = () =>
      request.items.map(({ id }, index) => ({
        id,
        marker: inlines(String(index + 1)),
        content: inlines(`entry for ${id}${stamp}`),
      }));
    return this.gate
      ? this.gate.promise.then(entries)
      : Promise.resolve(entries());
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

  prepareDocument(_request: PrepareRequest): Promise<PreparedDocument> {
    throw new Error("not used");
  }

  renderPrepared(_request: RenderRequest): Promise<Uint8Array> {
    throw new Error("not used");
  }

  [Symbol.asyncDispose](): Promise<void> {
    return Promise.resolve();
  }
}

function inlines(text: string): Inlines {
  return [{ t: "Str", c: text }];
}

function citationValue(outcome: CitationRenderOutcome) {
  return outcome.kind === "held" ? outcome.record.value : null;
}

class PandocEngineStub {
  readonly engine = new EngineStub();
  #status: PandocEngineStatus = {
    kind: "installed",
    version: "3.10",
    binary: { directory: "pandoc-engine", name: "pandoc.wasm" },
  };
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

  on<K extends keyof ZoteroReadsEvents>(
    event: K,
    cb: ZoteroReadsEvents[K],
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
  get loaded() {
    return Promise.resolve(this.current);
  }
  readonly #listeners = new Set<(settings: Readonly<Settings>) => void>();

  constructor(overrides: SettingsOverrides = {}) {
    this.current = applySettingsOverrides(defaults, overrides);
  }

  subscribe(listener: (settings: Readonly<Settings>) => void): () => void {
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
  cache: Awaited<ReturnType<typeof bibliographyRenderFixture>>;
  engine: EngineStub;
  pandocEngine: PandocEngineStub;
  db: DatabaseStub;
  zoteroPref: ZoteroPrefStub;
  settings: SettingsStub;
  /** Every `invalidated` the cache announced. */
  invalidations: number[];
  profileEvents: {
    on(event: "changed", callback: () => void): () => void;
    emit(event: "changed"): void;
  };
  /** Unavailable selected styles announced during this plugin lifecycle. */
  missingStyles: string[];
}

async function openHarness(
  overrides: SettingsOverrides = {},
  dataDir?: string,
  {
    profile,
    context,
  }: {
    profile?: BibliographyRenderFixtureOptions["profile"];
    context?: Context.Context<never>;
  } = {},
): Promise<Harness> {
  await using stack = new AsyncDisposableStack();
  const db = new DatabaseStub();
  const pandocEngine = new PandocEngineStub();
  const zoteroPref = new ZoteroPrefStub(dataDir);
  const settings = new SettingsStub({
    "citation.references-style": null,
    ...overrides,
  });
  const listeners = new Set<() => void>();
  const profileEvents = {
    on: (_event: "changed", callback: () => void) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    emit: (_event: "changed") => {
      for (const callback of listeners) callback();
    },
  };
  const cache = stack.use(
    await bibliographyRenderFixture(
      {
        profile: profile ?? {
          on: (event, callback) => profileEvents.on(event, callback),
        },
        db,
        pandocEngine,
        zoteroPref,
        settings,
      },
      context,
    ),
  );

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
    profileEvents,
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
  it.effect(
    "hands two consumers of the same ordered cited set one render",
    () =>
      Effect.gen(function* () {
        const harness = yield* harnessOf();
        const { cache, engine } = harness;
        const items = [item("alpha"), item("zebra")];

        const [first, second] = yield* Effect.promise(() =>
          Promise.all([
            cache.render(items),
            cache.render([item("alpha"), item("zebra")]),
          ]),
        );
        const third = yield* Effect.promise(() =>
          cache.render([item("alpha"), item("zebra")]),
        );

        expect(engine.requests).toHaveLength(1);
        expect(first).toMatchObject({
          kind: "held",
          record: {
            value: {
              entries: [{ id: "alpha" }, { id: "zebra" }],
              hasEntryMarkers: true,
            },
            status: "fresh",
          },
        });
        if (
          first.kind !== "held" ||
          second.kind !== "held" ||
          third.kind !== "held"
        ) {
          throw new Error("bibliography render missing");
        }
        expect(first.record.value).toBe(second.record.value);
        expect(first.record.value).toBe(third.record.value);
      }),
  );

  it.effect("renders again for a different cited set, order included", () =>
    Effect.gen(function* () {
      const harness = yield* harnessOf();
      const { cache, engine } = harness;

      yield* Effect.promise(() => cache.render([item("alpha"), item("zebra")]));
      yield* Effect.promise(() => cache.render([item("zebra"), item("alpha")]));
      yield* Effect.promise(() => cache.render([item("alpha")]));

      expect(engine.requests).toHaveLength(3);
    }),
  );

  it.effect("drops every render when the Zotero database changes", () =>
    Effect.gen(function* () {
      const harness = yield* harnessOf();
      const { cache, engine, db, invalidations } = harness;
      const items = [item("alpha")];

      yield* Effect.promise(() => cache.render(items));
      db.changed();
      yield* Effect.promise(() => cache.render(items));

      expect(invalidations).toHaveLength(1);
      expect(engine.requests).toHaveLength(2);
    }),
  );

  it.effect("drops every render when the Zotero data directory moves", () =>
    Effect.gen(function* () {
      const harness = yield* harnessOf();
      const { cache, engine, zoteroPref, invalidations } = harness;
      const items = [item("alpha")];

      yield* Effect.promise(() => cache.render(items));
      zoteroPref.resolvedChanged();
      yield* Effect.promise(() => cache.render(items));

      expect(invalidations).toHaveLength(1);
      expect(engine.requests).toHaveLength(2);
    }),
  );

  it.effect(
    "drops every render when the Citation and References Style changes",
    () =>
      Effect.gen(function* () {
        const harness = yield* harnessOf();
        const { cache, engine, settings, invalidations } = harness;
        const items = [item("alpha")];

        yield* Effect.promise(() => cache.render(items));
        settings.update({ "citation.references-style": IEEE });
        const changed = yield* Effect.promise(() => cache.render(items));
        // The same style again is no change at all.
        settings.update({ "citation.references-style": IEEE });

        expect(invalidations).toHaveLength(1);
        expect(changed).toEqual({
          kind: "unavailable",
          reason: "style-missing",
        });
        expect(engine.requests).toHaveLength(1);
      }),
  );

  it.effect(
    "drops every render when a named Profile citation style changes",
    () =>
      Effect.gen(function* () {
        const harness = yield* harnessOf();
        const { cache, invalidations } = harness;

        yield* Effect.promise(() => cache.render([item("alpha")]));
        harness.profileEvents.emit("changed");

        expect(invalidations).toHaveLength(1);
      }),
  );

  it.effect("drops every render when the engine comes or goes", () =>
    Effect.gen(function* () {
      const harness = yield* harnessOf();
      const { cache, engine, pandocEngine, invalidations } = harness;
      const items = [item("alpha")];

      yield* Effect.promise(() => cache.render(items));
      pandocEngine.setStatus({
        kind: "installed",
        version: "3.11",
        binary: { directory: "pandoc-engine", name: "pandoc.wasm" },
      });
      yield* Effect.promise(() => cache.render(items));

      expect(invalidations).toHaveLength(1);
      expect(engine.requests).toHaveLength(2);
    }),
  );

  it.effect("formats nothing while no engine is installed", () =>
    Effect.gen(function* () {
      const harness = yield* harnessOf({
        "citation.references-style": APA,
      });
      const { cache, engine, pandocEngine, missingStyles } = harness;
      pandocEngine.setStatus({ kind: "absent" });

      yield* Effect.promise(() =>
        expect(cache.render([item("alpha")])).resolves.toEqual({
          kind: "unavailable",
          reason: "engine-absent",
        }),
      );
      expect(engine.requests).toHaveLength(0);
      expect(missingStyles).toEqual([]);
    }),
  );

  it.effect("formats nothing for a document that cites nothing", () =>
    Effect.gen(function* () {
      const harness = yield* harnessOf();
      const { cache, engine } = harness;

      yield* Effect.promise(() =>
        expect(cache.render([])).resolves.toEqual({
          kind: "held",
          key: expect.any(String),
          record: {
            value: { entries: [], hasEntryMarkers: false },
            status: "fresh",
            settled: expect.any(Promise),
          },
        }),
      );
      expect(engine.requests).toHaveLength(0);
    }),
  );

  it.effect(
    "stops a document that cites nothing under a style it cannot reach",
    () =>
      Effect.gen(function* () {
        const installed = yield* acquireAsyncDisposable(() =>
          installStyle(APA),
        );
        const harness = yield* harnessOf(
          { "citation.references-style": APA },
          installed.dataDir,
        );
        const { cache, missingStyles } = harness;

        yield* Effect.promise(() =>
          expect(cache.render([], { styleId: IEEE })).resolves.toEqual({
            kind: "unavailable",
            reason: "style-missing",
          }),
        );
        expect(missingStyles).toEqual([]);
      }),
  );

  it.effect("serves a refused render until an invalidation rearms it", () =>
    Effect.gen(function* () {
      const harness = yield* harnessOf();
      const { cache, engine, db } = harness;
      const items = [item("alpha")];

      engine.fails = true;
      yield* Effect.promise(() =>
        expect(cache.render(items)).resolves.toEqual({
          kind: "unavailable",
          reason: "failed",
        }),
      );
      engine.fails = false;
      // The refusal stands rather than re-running the engine on every ask.
      yield* Effect.promise(() =>
        expect(cache.render(items)).resolves.toEqual({
          kind: "unavailable",
          reason: "failed",
        }),
      );
      expect(engine.requests).toHaveLength(1);

      db.changed();
      yield* Effect.promise(() =>
        expect(cache.render(items)).resolves.toMatchObject({
          kind: "held",
        }),
      );

      expect(engine.requests).toHaveLength(2);
    }),
  );

  it.effect.each(["bibliography", "citations"] as const)(
    "uses current item data after an in-flight %s render is invalidated",
    (kind) =>
      Effect.gen(function* () {
        const h = yield* harnessOf();
        const started = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();
        const titles: string[] = [];
        const content = async (items: readonly CslItemData[]) => {
          const title = String(items[0]?.title);
          titles.push(title);
          if (titles.length === 1) {
            started.resolve();
            await gate.promise;
          }
          return inlines(title);
        };
        h.engine.renderBibliography = async ({ items }) => [
          { id: "alpha", marker: undefined, content: await content(items) },
        ];
        h.engine.renderCitations = async ({ items }) => [
          { citations: [], content: await content(items) },
        ];
        const read = (title: string) => {
          const items = [{ ...item("alpha"), title }];
          return kind === "bibliography"
            ? h.cache.readBibliography(items).then((value) => value?.entries)
            : h.cache.readCitations(["[@alpha]"], items);
        };
        const first = read("Old title");
        yield* Effect.promise(() => started.promise);
        h.db.changed();
        const updated = read("Current title");
        gate.resolve();
        yield* Effect.promise(async () => await first);

        expect(
          (yield* Effect.promise(async () => await updated))?.[0]?.content,
        ).toEqual(inlines("Current title"));
        expect(
          (yield* Effect.promise(async () => await read("Current title")))?.[0]
            ?.content,
        ).toEqual(inlines("Current title"));
      }),
  );

  it.effect.each(["bibliography", "citations"] as const)(
    "reports a failed %s read to an owner that composes it",
    (kind) =>
      Effect.gen(function* () {
        const h = yield* harnessOf();
        const read = () =>
          kind === "bibliography"
            ? h.cache.readBibliography([item("alpha")])
            : h.cache.readCitations(["[@alpha]"], [item("alpha")]);
        yield* Effect.promise(async () => await read());
        h.db.changed();
        h.engine.fails = true;

        yield* Effect.promise(() => expect(read()).rejects.toThrow("no"));
        yield* Effect.promise(() => expect(read()).rejects.toThrow("no"));
        expect(
          kind === "bibliography"
            ? h.engine.requests
            : h.engine.citationRequests,
        ).toHaveLength(2);
      }),
  );

  it.effect("hands the settled render to the surfaces that hold it", () =>
    Effect.gen(function* () {
      const harness = yield* harnessOf();
      const { cache } = harness;
      const settlements: [string, Held<unknown> | null][] = [];
      const delivered = yield* Queue.unbounded<void>();
      cache.on("settled", (key, held) => {
        settlements.push([key, held]);
        Queue.offerUnsafe(delivered, undefined);
      });

      yield* Effect.promise(() => cache.render([item("alpha")]));
      yield* Queue.take(delivered);

      expect(settlements).toEqual([
        [
          expect.any(String),
          expect.objectContaining({
            value: {
              entries: [
                {
                  id: "alpha",
                  marker: inlines("1"),
                  content: inlines("entry for alpha"),
                },
              ],
              hasEntryMarkers: true,
            },
            status: "fresh",
          }),
        ],
      ]);
    }),
  );

  it.effect("keeps a failed replacement available to display reads", () =>
    Effect.gen(function* () {
      const harness = yield* harnessOf();
      const { cache, engine, db } = harness;
      const items = [item("alpha")];
      yield* Effect.promise(() =>
        expect(cache.render(items)).resolves.toMatchObject({
          kind: "held",
        }),
      );

      engine.fails = true;
      db.changed();

      const replacing = yield* Effect.promise(() => cache.render(items));
      if (replacing.kind !== "held") throw new Error("Missing held render");
      yield* Effect.promise(() => replacing.record.settled);
      yield* Effect.promise(() =>
        expect(cache.render(items)).resolves.toMatchObject({
          kind: "held",
          record: {
            status: "failed",
            value: { entries: [{ content: inlines("entry for alpha") }] },
          },
        }),
      );
      expect(engine.requests).toHaveLength(2);
    }),
  );

  it.effect("discards a render an invalidation landed on", () =>
    Effect.gen(function* () {
      const harness = yield* harnessOf();
      const { cache, engine, db } = harness;
      const items = [item("alpha")];
      // Each render names the ordinal of the engine run behind it, so the render
      // that ends up standing is the one the entries name.
      engine.stamp = () => ` #${engine.requests.length}`;
      yield* Effect.promise(() => cache.render(items));

      const gate = Promise.withResolvers<void>();
      engine.gate = gate;
      db.changed();
      // The render that answers here is the held one; the replacement it starts
      // is the one the second drop lands on.
      yield* Effect.promise(() => cache.render(items));
      db.changed();
      gate.resolve();

      // The superseded second render never publishes: the ask its cancellation
      // armed is the third run, and that is the render that stands.
      yield* Effect.promise(() => cache.readBibliography(items));
      yield* Effect.promise(() =>
        expect(cache.render(items)).resolves.toMatchObject({
          kind: "held",
          record: {
            value: { entries: [{ content: inlines("entry for alpha #3") }] },
            status: "fresh",
          },
        }),
      );
      expect(engine.requests).toHaveLength(3);
    }),
  );

  it.effect(
    "keeps an unavailable selected style out of every formatting surface",
    () =>
      Effect.gen(function* () {
        const harness = yield* harnessOf({
          "citation.references-style": APA,
        });
        const { cache, engine, missingStyles } = harness;

        yield* Effect.promise(() =>
          expect(cache.render([item("alpha")])).resolves.toEqual({
            kind: "unavailable",
            reason: "style-missing",
          }),
        );
        yield* Effect.promise(() =>
          expect(
            cache.renderCitations(["[@alpha]"], [item("alpha")]),
          ).resolves.toEqual({ kind: "unavailable", reason: "style-missing" }),
        );
        yield* Effect.promise(() => cache.render([item("alpha")]));

        expect(engine.requests).toHaveLength(0);
        expect(engine.citationRequests).toHaveLength(0);
        expect(missingStyles).toEqual([APA]);

        const lateMissingStyles: string[] = [];
        cache.onStyleMissing((styleId) => lateMissingStyles.push(styleId));
        expect(lateMissingStyles).toEqual([APA]);

        const newMissingStyles: string[] = [];
        cache.on("style-missing", (styleId) => newMissingStyles.push(styleId));
        harness.settings.update({ "citation.locale": "fr-FR" });
        yield* TestClock.adjust(0);
        expect(newMissingStyles).toEqual([]);
      }),
  );

  it.effect("drops every render when the vault Citation Locale changes", () =>
    Effect.gen(function* () {
      const harness = yield* harnessOf();
      const { cache, engine, settings, invalidations } = harness;
      const items = [item("alpha")];

      yield* Effect.promise(() => cache.render(items));
      yield* Effect.promise(() => cache.renderCitations(["[@alpha]"], items));
      settings.update({ "citation.locale": "de-DE" });
      yield* Effect.promise(() => cache.render(items));
      yield* Effect.promise(() => cache.renderCitations(["[@alpha]"], items));
      // The same locale again is no change at all.
      settings.update({ "citation.locale": "de-DE" });

      expect(invalidations).toHaveLength(1);
      expect(engine.requests).toHaveLength(2);
      expect(engine.citationRequests).toHaveLength(2);
      expect(engine.requests[1]?.locale).toBe("de-DE");
      expect(engine.citationRequests[1]?.locale).toBe("de-DE");
    }),
  );

  it.effect(
    "renders the embedded default style for a request that names Default",
    () =>
      Effect.gen(function* () {
        const installed = yield* acquireAsyncDisposable(() =>
          installStyle(APA),
        );
        const harness = yield* harnessOf(
          { "citation.references-style": APA },
          installed.dataDir,
        );
        const { cache, engine } = harness;

        yield* Effect.promise(() =>
          cache.render([item("alpha")], { styleId: null }),
        );

        expect(engine.requests[0]?.styleXml).toBeUndefined();
      }),
  );

  it.effect("renders again when a dependent style names another parent", () =>
    Effect.gen(function* () {
      const installed = yield* acquireAsyncDisposable(() =>
        installDependent(APA),
      );
      const harness = yield* harnessOf(
        { "citation.references-style": DEPENDENT },
        installed.dataDir,
      );
      const { cache, engine } = harness;
      const items = [item("alpha")];

      yield* Effect.promise(() => cache.render(items));
      yield* Effect.promise(() => installed.pointAt(IEEE));
      yield* Effect.promise(() => cache.render(items));

      expect(engine.requests).toHaveLength(2);
      expect(engine.requests[0]?.styleXml).toContain(`<id>${APA}</id>`);
      expect(engine.requests[1]?.styleXml).toContain(`<id>${IEEE}</id>`);
    }),
  );

  it.effect("renders again when the selected style's own content changes", () =>
    Effect.gen(function* () {
      const installed = yield* acquireAsyncDisposable(() => installStyle(APA));
      const harness = yield* harnessOf(
        { "citation.references-style": APA },
        installed.dataDir,
      );
      const { cache, engine } = harness;
      const items = [item("alpha")];

      yield* Effect.promise(() => cache.render(items));
      yield* Effect.promise(() =>
        installed.edit(0, independentXml(APA, "Edited in Zotero")),
      );
      yield* Effect.promise(() => cache.render(items));

      expect(engine.requests).toHaveLength(2);
      expect(engine.requests[1]?.styleXml).toContain(
        "<title>Edited in Zotero</title>",
      );
    }),
  );

  it.effect("holds one render per Citation Presentation", () =>
    Effect.gen(function* () {
      const installed = yield* acquireAsyncDisposable(() => installStyle(APA));
      const harness = yield* harnessOf(
        { "citation.references-style": APA },
        installed.dataDir,
      );
      const { cache, engine } = harness;
      const items = [item("alpha")];

      yield* Effect.promise(() => cache.render(items));
      yield* Effect.promise(() => cache.render(items, { locale: "de-DE" }));
      yield* Effect.promise(() => cache.render(items, { locale: "de-DE" }));

      expect(engine.requests).toHaveLength(2);
      expect(engine.requests[0]?.styleXml).not.toContain("default-locale");
      expect(engine.requests[1]?.styleXml).toContain('default-locale="de-DE"');
    }),
  );

  it.effect("blames the vault for its own selection alone", () =>
    Effect.gen(function* () {
      const installed = yield* acquireAsyncDisposable(() => installStyle(APA));
      const harness = yield* harnessOf(
        { "citation.references-style": APA },
        installed.dataDir,
      );
      const { cache, missingStyles } = harness;

      yield* Effect.promise(() =>
        expect(
          cache.render([item("alpha")], { styleId: IEEE }),
        ).resolves.toEqual({ kind: "unavailable", reason: "style-missing" }),
      );

      expect(missingStyles).toEqual([]);
    }),
  );
});

describe("BibliographyRenderCache citations", () => {
  const items = [item("alpha")];

  it.effect("hands two consumers of the same document one render", () =>
    Effect.gen(function* () {
      const harness = yield* harnessOf();
      const { cache, engine } = harness;

      const [first, second] = yield* Effect.promise(() =>
        Promise.all([
          cache.renderCitations(["[@alpha]", "@alpha"], items),
          cache.renderCitations(["[@alpha]", "@alpha"], items),
        ]),
      );

      expect(engine.citationRequests).toHaveLength(1);
      expect(first.kind).toBe("held");
      expect(second.kind).toBe("held");
      if (first.kind !== "held" || second.kind !== "held") {
        throw new Error("citation render missing");
      }
      expect(first.record.value).toBe(second.record.value);
      expect(first.record.value.map((citation) => citation.content)).toEqual([
        inlines("cite for [@alpha]"),
        inlines("cite for @alpha"),
      ]);
    }),
  );

  it.effect("renders again for other citations of the same cited set", () =>
    Effect.gen(function* () {
      const harness = yield* harnessOf();
      const { cache, engine } = harness;

      yield* Effect.promise(() => cache.renderCitations(["[@alpha]"], items));
      yield* Effect.promise(() => cache.renderCitations(["@alpha"], items));

      expect(engine.citationRequests).toHaveLength(2);
    }),
  );

  it.effect("drops citation renders with the bibliography renders", () =>
    Effect.gen(function* () {
      const harness = yield* harnessOf();
      const { cache, engine, settings } = harness;

      yield* Effect.promise(() => cache.renderCitations(["[@alpha]"], items));
      settings.update({ "citation.references-style": IEEE });
      const changed = yield* Effect.promise(() =>
        cache.renderCitations(["[@alpha]"], items),
      );

      expect(changed).toEqual({
        kind: "unavailable",
        reason: "style-missing",
      });
      expect(engine.citationRequests).toHaveLength(1);
    }),
  );

  it.effect("formats nothing while no engine is installed", () =>
    Effect.gen(function* () {
      const harness = yield* harnessOf();
      const { cache, engine, pandocEngine } = harness;
      pandocEngine.setStatus({ kind: "absent" });

      yield* Effect.promise(() =>
        expect(cache.renderCitations(["[@alpha]"], items)).resolves.toEqual({
          kind: "unavailable",
          reason: "engine-absent",
        }),
      );
      expect(engine.citationRequests).toHaveLength(0);
    }),
  );

  it.effect("formats nothing for a document that cites nothing", () =>
    Effect.gen(function* () {
      const harness = yield* harnessOf();
      const { cache, engine } = harness;

      expect(
        citationValue(
          yield* Effect.promise(() => cache.renderCitations([], [])),
        ),
      ).toEqual([]);
      expect(engine.citationRequests).toHaveLength(0);
    }),
  );

  it.effect("serves a refused render until an invalidation rearms it", () =>
    Effect.gen(function* () {
      const harness = yield* harnessOf();
      const { cache, engine, db } = harness;

      engine.fails = true;
      yield* Effect.promise(() =>
        expect(cache.renderCitations(["[@alpha]"], items)).resolves.toEqual({
          kind: "unavailable",
          reason: "failed",
        }),
      );
      engine.fails = false;
      db.changed();
      expect(
        citationValue(
          yield* Effect.promise(() =>
            cache.renderCitations(["[@alpha]"], items),
          ),
        ),
      ).not.toBeNull();

      expect(engine.citationRequests).toHaveLength(2);
    }),
  );
});

const harnessOf = Effect.fnUntraced(function* (
  overrides: SettingsOverrides = {},
  dataDir?: string,
  profile?: BibliographyRenderFixtureOptions["profile"],
) {
  const context = yield* Effect.context<never>();
  return yield* acquireAsyncDisposable(() =>
    openHarness(overrides, dataDir, { profile, context }),
  );
});
