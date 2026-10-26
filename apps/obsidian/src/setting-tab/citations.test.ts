import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it } from "@effect/vitest";
import {
  DropdownComponent,
  ExtraButtonComponent,
  renderRow,
} from "@mock/obsidian";
import {
  Context,
  Deferred,
  Effect,
  FileSystem,
  Layer,
  PlatformError,
  SubscriptionRef,
} from "effect";
// @vitest-environment happy-dom
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, vi } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { referencesStyleOptions, STYLE_DEFAULT } from "@/lib/citation-style";
import * as m from "@/lib/i18n/generated/messages";
import { PandocEngine } from "@/services/pandoc/service";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import {
  PluginSettings,
  SettingsMutationError,
} from "@/services/settings/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";

import {
  profileRowServices,
  scopedSettingTab,
  testSettingTab,
} from "./__fixtures__";
import {
  citationLocaleError,
  citationsPageItems,
  referencesStyleDefinition,
  referencesStyleDescription,
} from "./citations";
import type { SettingTabContext } from "./context";

/**
 * Style folder reads a case holds in flight, the folders it refuses to list,
 * and the folders read so far, by folder path.
 */
interface StyleReads {
  readonly held: Map<string, Deferred.Deferred<void>>;
  readonly denied: Set<string>;
  readonly started: Set<string>;
}

/**
 * The Node file system, with each styles folder read going through `reads`: a
 * held read waits for its release, and a denied folder refuses to be listed.
 */
const styleFileSystem = (reads: StyleReads) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.map(FileSystem.FileSystem, (fs) =>
      FileSystem.make({
        ...fs,
        readDirectory: (path, options) =>
          Effect.gen(function* () {
            reads.started.add(path);
            const held = reads.held.get(path);
            if (held) yield* Deferred.await(held);
            if (reads.denied.has(path))
              return yield* PlatformError.systemError({
                _tag: "PermissionDenied",
                module: "FileSystem",
                method: "readDirectory",
                pathOrDescriptor: path,
              });
            return yield* fs.readDirectory(path, options);
          }),
      }),
    ),
  ).pipe(Layer.provide(NodeFileSystem.layer));

const APA = { id: "http://www.zotero.org/styles/apa", title: "APA" };
const NATURE = { id: "http://www.zotero.org/styles/nature", title: "Nature" };
const CHICAGO = {
  id: "http://www.zotero.org/styles/chicago-author-date",
  title: "Chicago",
};

beforeAll(() => {
  globalThis.createEl = ((tag: string) =>
    document.createElement(tag)) as typeof createEl;
});

/** The tab over `settings` and a Pandoc engine that is not installed. */
const pandocTab = (settings: Settings) =>
  testSettingTab(
    profileRowServices({ template: { loaded: Effect.succeed(false) } }).pipe(
      Context.add(
        PandocEngine,
        stubService<PandocEngine["Service"]>("PandocEngine", {
          getStatus: Effect.succeed({ kind: "absent" }),
        }),
      ),
      Context.add(
        PluginSettings,
        stubService<PluginSettings["Service"]>("PluginSettings", {
          current: Effect.succeed(settings),
        }),
      ),
    ),
  ).tab;

/** The Citations page context over `settings`, with the Graph plugin off. */
const citationsContext = (settings: Settings) =>
  stubService<SettingTabContext>("SettingTabContext", {
    tab: pandocTab(settings),
    app: stubService<SettingTabContext["app"]>("App", {
      internalPlugins: { getEnabledPluginById: () => null },
    }),
    manifest: stubService<SettingTabContext["manifest"]>("PluginManifest", {
      version: "test",
    }),
  });

describe("hover settings", () => {
  /** The Hover group's rows for a given saved hover action. */
  const hoverRows = (settings: Settings) => {
    const ctx = citationsContext(settings);
    const group = citationsPageItems(ctx).find(
      (item) =>
        "type" in item &&
        item.type === "group" &&
        item.heading === m.settings_citation_hover_heading(),
    );
    if (!group || !("items" in group) || !group.items)
      throw new Error("hover group missing");
    return group.items;
  };

  it("shows the Require Mod page under the Citation popover alone", () => {
    for (const action of ["popover", "off", "page-preview"] as const) {
      const page = hoverRows({
        ...defaults,
        "citation.hover-action": action,
      })[1];
      const predicate = page && "visible" in page ? page.visible : undefined;
      const visible = typeof predicate === "function" ? predicate() : predicate;
      expect(visible).toBe(action === "popover");
    }
  });
});

describe("citation source settings", () => {
  it("offers each citation syntax as a source", () => {
    const ctx = citationsContext(defaults);
    const sourceGroup = citationsPageItems(ctx).find(
      (item) =>
        "type" in item &&
        item.type === "group" &&
        item.heading === m.settings_citation_sources_heading(),
    );
    if (!sourceGroup || !("items" in sourceGroup) || !sourceGroup.items)
      throw new Error("citation source group missing");

    expect(sourceGroup.items).toMatchObject([
      { id: "settings_citation_pandoc_citations" },
      { id: "settings_citation_wikilink_citations" },
      { id: "settings_citation_annotation_citations" },
    ]);
  });
});

describe("referencesStyleOptions", () => {
  it("offers the embedded default ahead of the installed styles", () => {
    expect(referencesStyleOptions([APA, NATURE], STYLE_DEFAULT)).toEqual([
      {
        value: STYLE_DEFAULT,
        label: m.settings_citation_references_style_default(),
      },
      { value: APA.id, label: APA.title },
      { value: NATURE.id, label: NATURE.title },
    ]);
  });

  it("lists an installed selection once", () => {
    expect(referencesStyleOptions([APA], APA.id)).toEqual([
      {
        value: STYLE_DEFAULT,
        label: m.settings_citation_references_style_default(),
      },
      { value: APA.id, label: APA.title },
    ]);
  });

  it("keeps a selection Zotero no longer has", () => {
    const removed = "http://www.zotero.org/styles/removed";

    expect(referencesStyleOptions([APA], removed)).toEqual([
      {
        value: STYLE_DEFAULT,
        label: m.settings_citation_references_style_default(),
      },
      { value: APA.id, label: APA.title },
      {
        value: removed,
        label: m.settings_citation_references_style_missing({ id: removed }),
      },
    ]);
  });

  it("offers only the default when Zotero installed no styles", () => {
    expect(referencesStyleOptions([], STYLE_DEFAULT)).toEqual([
      {
        value: STYLE_DEFAULT,
        label: m.settings_citation_references_style_default(),
      },
    ]);
  });
});

/** Settings whose default Profile binds `style` as its References style. */
const withStyle = (style: string | null): Settings => ({
  ...defaults,
  "note.default-profile": {
    ...defaults["note.default-profile"],
    bindings: {
      ...defaults["note.default-profile"].bindings,
      "citation.references-style": style,
    },
  },
});

/** A CSL file shaped like the ones Zotero installs. */
const cslXml = ({ id, title }: { id: string; title: string }) =>
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">',
    `  <info><title>${title}</title><id>${id}</id></info>`,
    "</style>",
  ].join("\n");

/** A Zotero data folder of its own, removed when the case ends. */
const dataFolder = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "zotlit-styles-row-"))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
);

/** Install `style` into the data folder `dir`, as Zotero does. */
const install = (dir: string, style: { id: string; title: string }) =>
  Effect.promise(async () => {
    await mkdir(join(dir, "styles"), { recursive: true });
    await writeFile(join(dir, "styles", `${style.title}.csl`), cslXml(style));
  });

/** Wait until `assert` passes: the row reads the folder on real time. */
const eventually = (assert: () => void) =>
  Effect.promise(() => vi.waitFor(assert, { timeout: 2000, interval: 5 }));

describe("References style row", () => {
  /**
   * The rendered row over a Zotero data folder at `dataDir` and settings that
   * start as `settings`; `write` answers a choice.
   */
  const setup = Effect.fn("setup")(function* (
    dataDir: string,
    {
      settings = withStyle(null),
      write = () => Effect.void,
    }: {
      settings?: Settings;
      write?: PluginSettings["Service"]["updateDefaultLiteratureNoteProfileBindings"];
    } = {},
  ) {
    const reads: StyleReads = {
      held: new Map(),
      denied: new Set(),
      started: new Set(),
    };
    const notifier = testNotifier();
    const snapshot: ZoteroPrefSnapshot = {
      state: "ready",
      prefs: new Map(),
      resolvedProfileDir: null,
      profileDirOverride: null,
      dataDirOverride: null,
      dataDir,
      databasePath: join(dataDir, "zotero.sqlite"),
      sourceId: null,
      baseAttachmentPath: null,
      httpPort: null,
    };
    const pref = yield* SubscriptionRef.make(snapshot);
    const stored = yield* SubscriptionRef.make(settings);
    const services = yield* Layer.build(
      Layer.mergeAll(
        notifier.layer,
        styleFileSystem(reads),
        Layer.mock(PluginSettings, {
          current: SubscriptionRef.get(stored),
          changes: SubscriptionRef.changes(stored),
          updateDefaultLiteratureNoteProfileBindings: write,
        }),
        Layer.mock(ZoteroPref, {
          current: SubscriptionRef.get(pref),
          changes: SubscriptionRef.changes(pref),
        }),
      ),
    );
    const ctx = stubService<SettingTabContext>("SettingTabContext", {
      tab: (yield* scopedSettingTab(services)).tab,
    });
    const setting = renderRow(referencesStyleDefinition(ctx));
    yield* Effect.addFinalizer(() => Effect.sync(() => setting.cleanup?.()));
    const dropdown = setting.components.find(
      (control) => control instanceof DropdownComponent,
    );
    const refresh = setting.components.find(
      (control) => control instanceof ExtraButtonComponent,
    );
    if (!dropdown || !refresh) throw new Error("Expected the style controls");
    const paint = vi.spyOn(dropdown.selectEl, "replaceChildren");
    return {
      dropdown,
      refresh,
      notices: notifier.notices,
      /** The styles folder reads, which a case holds or refuses. */
      reads,
      /** The data folder the Zotero preferences resolve to. */
      moveDataFolder: (dir: string) =>
        SubscriptionRef.update(pref, (current) => ({
          ...current,
          prefs: new Map(),
          dataDir: dir,
        })),
      /** Settings as vault sync rewrites them while the tab stays open. */
      store: (next: Settings) => SubscriptionRef.set(stored, next),
      /** How many times the row has filled the dropdown so far. */
      paints: () => paint.mock.calls.length,
      /** The titles the dropdown offers after the embedded default. */
      titles: () => dropdown.options.slice(1).map(({ label }) => label),
    };
  });

  it.live("lists the styles Zotero installed and selects the saved one", () =>
    Effect.gen(function* () {
      const dir = yield* dataFolder;
      yield* install(dir, APA);
      yield* install(dir, NATURE);
      const row = yield* setup(dir, { settings: withStyle(NATURE.id) });

      yield* eventually(() => expect(row.titles()).toEqual(["APA", "Nature"]));
      expect(row.dropdown.getValue()).toBe(NATURE.id);
    }),
  );

  it.live("reads the folder again on Refresh", () =>
    Effect.gen(function* () {
      const dir = yield* dataFolder;
      yield* install(dir, APA);
      const row = yield* setup(dir);
      yield* eventually(() => expect(row.titles()).toEqual(["APA"]));

      yield* install(dir, NATURE);
      row.refresh.click();

      yield* eventually(() => expect(row.titles()).toEqual(["APA", "Nature"]));
    }),
  );

  it.live("keeps the last list when a Refresh cannot read the folder", () =>
    Effect.gen(function* () {
      const dir = yield* dataFolder;
      yield* install(dir, APA);
      const row = yield* setup(dir);
      yield* eventually(() => expect(row.titles()).toEqual(["APA"]));

      row.reads.denied.add(join(dir, "styles"));
      const painted = row.paints();
      row.refresh.click();

      // The row paints once the failed read has settled to a list.
      yield* eventually(() => expect(row.paints()).toBe(painted + 1));
      expect(row.titles()).toEqual(["APA"]);
    }),
  );

  it.live(
    "lists the newest data folder's styles when the folder moves twice",
    () =>
      Effect.gen(function* () {
        const first = yield* dataFolder;
        const second = yield* dataFolder;
        const third = yield* dataFolder;
        yield* install(first, APA);
        yield* install(second, NATURE);
        yield* install(third, CHICAGO);
        const row = yield* setup(first);
        yield* eventually(() => expect(row.titles()).toEqual(["APA"]));

        // The read of the folder in between stays in flight until released.
        const held = yield* Deferred.make<void>();
        const secondStyles = join(second, "styles");
        row.reads.held.set(secondStyles, held);
        yield* row.moveDataFolder(second);
        yield* eventually(() =>
          expect(row.reads.started.has(secondStyles)).toBe(true),
        );
        yield* row.moveDataFolder(third);
        yield* eventually(() => expect(row.titles()).toEqual(["Chicago"]));

        yield* Deferred.succeed(held, undefined);
        yield* Effect.sleep("50 millis");
        expect(row.titles()).toEqual(["Chicago"]);
      }),
  );

  it.live("follows a References style that vault sync rewrites", () =>
    Effect.gen(function* () {
      const dir = yield* dataFolder;
      yield* install(dir, APA);
      const row = yield* setup(dir);
      yield* eventually(() => expect(row.titles()).toEqual(["APA"]));

      yield* row.store(withStyle(APA.id));

      yield* eventually(() => expect(row.dropdown.getValue()).toBe(APA.id));
    }),
  );

  it.live("saves the chosen style to the default Profile", () =>
    Effect.gen(function* () {
      const dir = yield* dataFolder;
      yield* install(dir, APA);
      const write = vi.fn(() => Effect.void);
      const row = yield* setup(dir, { write });
      yield* eventually(() => expect(row.titles()).toEqual(["APA"]));

      row.dropdown.choose(APA.id);
      row.dropdown.choose(STYLE_DEFAULT);

      yield* eventually(() =>
        expect(write.mock.calls).toEqual([
          [{ "citation.references-style": APA.id }],
          [{ "citation.references-style": null }],
        ]),
      );
    }),
  );

  it.live("tells the user when the chosen style cannot be saved", () =>
    Effect.gen(function* () {
      const dir = yield* dataFolder;
      const row = yield* setup(dir, {
        write: () =>
          Effect.fail(
            new SettingsMutationError({ message: "disk full", cause: null }),
          ),
      });

      row.dropdown.choose(STYLE_DEFAULT);

      yield* eventually(() =>
        expect(row.notices.map(({ messages: [text] }) => text)).toEqual([
          `${m.settings_failed_save()}: disk full`,
        ]),
      );
    }),
  );
});

describe("referencesStyleDescription", () => {
  it("names the recovery step only when Zotero lacks the selection", () => {
    expect(referencesStyleDescription(false).textContent).toBe(
      m.settings_citation_references_style_desc(),
    );
    expect(referencesStyleDescription(true).textContent).toBe(
      m.settings_citation_references_style_warning(),
    );
  });
});

describe("citationLocaleError", () => {
  it("accepts the locale forms Pandoc and CSL read", () => {
    for (const locale of [
      "",
      "de",
      "en-US",
      "pt-BR",
      "zh-Hans-CN",
      "es-419",
      // Pandoc sorts a bibliography by the collation this extension names.
      "de-u-co-phonebk",
      // The extended language, private-use, and irregular tags BCP 47 keeps.
      "zh-cmn-Hans-CN",
      "x-pmr",
      "i-klingon",
      "en-GB-oed",
      // Case carries no meaning in a language tag, irregular ones included.
      "I-KLINGON",
      "SGN-BE-FR",
      "DE-de",
    ]) {
      expect(citationLocaleError(locale)).toBeUndefined();
    }
  });

  it("names the form an unreadable locale should take", () => {
    for (const locale of [
      "en_US",
      "en US",
      " de-DE",
      "1234",
      "de-",
      "de--DE",
      "abcdefghi",
      // A tag writes each variant and each extension once.
      "de-1901-1901",
      "en-u-ca-gregory-u-nu-latn",
    ]) {
      expect(citationLocaleError(locale)).toBe(
        m.settings_citation_locale_invalid(),
      );
    }
  });
});
