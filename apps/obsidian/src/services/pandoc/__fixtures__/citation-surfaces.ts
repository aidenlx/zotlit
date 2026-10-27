import { missingStyleChanges } from "@/services/pandoc/render-cache";
import { testNotifier } from "@/lib/__fixtures__/notifier";
import { Notifier } from "@/lib/notifier";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { delay } from "@std/async";
import { Context, DateTime, Effect, FileSystem, Layer, Stream } from "effect";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  App,
  EventRef,
  FileSystemAdapter,
  HoverParent,
  LinkCache,
  MetadataCache,
  TFile,
  Vault,
  Workspace,
  WorkspaceLeaf,
} from "obsidian";
import { act } from "preact/test-utils";
import { vi } from "vitest";

import { testEvent } from "@/lib/__fixtures__/event-stream";
import { createObsidianHost } from "@/lib/__fixtures__/obsidian-host";
import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import { MemoryVault } from "@/lib/__fixtures__/obsidian-vault";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { layerUnreadViewServices } from "@/lib/__fixtures__/view-atoms";
import { buildRuntime } from "@/lib/effect-layer";
// One vault, read at once through every Citation Presentation surface: the
// Document Citation Text, the References Sidebar, the Citation Popover, the
// Copied Bibliography, and the built-in export.
import { subscribe } from "@/lib/effect-stream";
import { spliceFrontMatter } from "@/lib/live-text";
import { makeViewRegistry } from "@/lib/view-atoms";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import { CitationIndex } from "@/services/citation-index/service";
import {
  createCitationIndexHarness,
  GROUP_LIBRARY_ID,
  groupLibrary,
  harnessApp,
  KEY_A,
  KEY_B,
  LibraryScopeStub,
  personalLibrary,
} from "@/services/citation-index/test-harness";
import type { CitationIndexHarness } from "@/services/citation-index/test-harness";
import { inProcessParseClient } from "@/services/citation-parse/in-process";
import { citationPopoverFixture } from "@/services/citation-popover/__fixtures__";
import { firstText } from "@/services/citation-text/__fixtures__";
import { citationTextFixture } from "@/services/citation-text/__fixtures__";
import { CitationText } from "@/services/citation-text/service";
import type { ManagedBinaryApi } from "@/services/managed-binary/service";
import { createCitationEngine } from "@/services/pandoc/engine";
import type { CitationEngine } from "@/services/pandoc/engine";
import { BibliographyRender } from "@/services/pandoc/render-cache";
import { bibliographyRenderFixture } from "@/services/pandoc/render-cache/__fixtures__";
import { PandocEngine } from "@/services/pandoc/service";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import type { ProfileFixtureSettings as Settings } from "@/services/profile/__fixtures__/reader";
import type { ResolvedLiteratureNoteProfileBindings } from "@/services/profile/bindings";
import { Profile } from "@/services/profile/service";
import {
  applySettings,
  buildSeededSettings,
} from "@/services/settings/__fixtures__";
import type { SettingsFixture } from "@/services/settings/__fixtures__";
import { ZoteroReads } from "@/services/zotero-reads/service";

type ProfileFixture = Pick<Settings, "profiles" | "defaultDocument">;
import { fakeFetchClient } from "@/lib/__fixtures__/fake-fetch";
import { OpenDocumentsStub } from "@/lib/__fixtures__/open-documents";
import { seedWorksSql } from "@/services/zotero-reads/test-utils";
import { applyCitationPresentation } from "@/views/citation-presentation/presentation";
import type { CitationPresentationChoice } from "@/views/citation-presentation/presentation";
import { runPandocExport } from "@/views/pandoc-export/register";
import type { PandocExportDeps } from "@/views/pandoc-export/register";
import { ReferencesView } from "@/views/references/view";

import {
  citedWorks,
  clipboardWrites,
  exportRun,
  resetCitationSurfaceMocks,
} from "./citation-surface-mocks";
import type { CitedWork } from "./citation-surface-mocks";

// Every module this vault stands in for, registered once here so each suite
// that opens one takes the same doubles. The registrations hoist above the
// imports, so this fixture's own graph loads with them already in place.
vi.mock("@/views/pandoc-export/modal", async () => ({
  openPandocExportModal: (await import("./citation-surface-mocks"))
    .answerExportModal,
}));

/** Zotero itself, answering for the Items this vault cites. */
vi.mock("@/services/pandoc/bibliography", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/pandoc/bibliography")>()),
  fetchBibliography: (await import("./citation-surface-mocks"))
    .fetchCitedBibliography,
}));

vi.mock("@/lib/clipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/clipboard")>()),
  writeClipboardRichText: (await import("./citation-surface-mocks"))
    .collectClipboardWrite,
}));

vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));

vi.mock("@/components/obsidian/icon-button", async () => {
  const { createElement } = await import("react");
  return {
    IconButton: ({ icon, ...props }: { icon: string }) =>
      createElement("button", { ...props, "data-icon": icon }),
  };
});

/** Instantiating the Haskell runtime dominates every timing here. */
export const TIMEOUT = 60_000;

/** The citation key the draft cites first, which the harness resolves to {@link KEY_A}. */
const CITATION_KEY = "doe2024";
/** The citation key the draft cites second, which the harness resolves to {@link KEY_B}. */
export const SECOND_CITATION_KEY = "roe2025";

/**
 * The note whose citations every in-app surface below reads. It cites two works
 * in this order, so a numbering style has an ordered citation set to count and
 * each surface can be read for the work it stands beside.
 */
const DRAFT = "draft.md";
const DRAFT_BODY = `Cited @${CITATION_KEY}. Then @${SECOND_CITATION_KEY}.`;

/** The note the built-in export runs over, which cites the first of those works. */
export const EXPORT_NOTE = "export.md";
const LINKPATH = "Doe 2024";
export const EXPORT_BODY = `Cited [[${LINKPATH}]].\n`;

/**
 * SQL for the Zotero database: My Library of account user 1, the library of
 * group 7, and `works`.
 */
function zoteroRows(works: readonly CitedWork[]): string {
  return `
    ${seedWorksSql(works.map(({ work }) => work))}
    insert into libraries (libraryID, type) values (${GROUP_LIBRARY_ID}, 'group');
    insert into groups (groupID, libraryID, name) values (7, ${GROUP_LIBRARY_ID}, 'Group');
    insert into settings (setting, key, value) values ('account', 'userID', 1);
  `;
}

/** The work both notes cite first, as the database and Zotero itself answer it. */
const CITED_WORK: CitedWork = {
  work: {
    itemID: 1,
    key: KEY_A,
    creators: [["Ann", "Zeta"]],
    title: "A study of nothing",
    date: "2020",
    citationKey: CITATION_KEY,
  },
  csl: {
    id: "zeta2020",
    type: "article-journal",
    title: "A study of nothing",
    author: [{ family: "Zeta", given: "Ann" }],
    issued: { "date-parts": [[2020]] },
  },
};

/** The work the draft cites second, which every surface numbers after the first. */
const SECOND_CITED_WORK: CitedWork = {
  work: {
    itemID: 2,
    key: KEY_B.slice(0, KEY_B.indexOf("g")),
    libraryID: GROUP_LIBRARY_ID,
    creators: [["Bo", "Alpha"]],
    title: "A second study of nothing",
    date: "2021",
    citationKey: SECOND_CITATION_KEY,
  },
  csl: {
    id: "alpha2021",
    type: "article-journal",
    title: "A second study of nothing",
    author: [{ family: "Alpha", given: "Bo" }],
    issued: { "date-parts": [[2021]] },
  },
};

const WASM_PATH = join(
  dirname(createRequire(import.meta.url).resolve("pandoc-wasm")),
  "pandoc.wasm",
);

function pandocEngineHandle(engine: CitationEngine) {
  return {
    binary: stubService<ManagedBinaryApi<CitationEngine>>("PandocEngine", {
      getStatus: Effect.succeed({
        kind: "installed",
        version: "test",
        binary: { directory: "pandoc-engine", name: "pandoc.wasm" },
      }),
      changes: Stream.empty,
      getEngine: Effect.succeed(engine),
      decline: Effect.void,
    }),
    runSync: Effect.runSync,
    runPromise: Effect.runPromise,
  };
}

export interface CitationVaultOptions {
  /** Every style Zotero has installed here, by the file name it carries. */
  styles: Record<string, string>;
  /** The vault settings every surface renders under. */
  settings: Partial<Settings> & Partial<ResolvedLiteratureNoteProfileBindings>;
  /** The `zotlit-csl` property both notes carry; `undefined` writes none. */
  documentStyle?: unknown;
  /** The `lang` property both notes carry; `undefined` writes none. */
  documentLanguage?: unknown;
  /** Other frontmatter properties both notes carry. */
  documentProperties?: Record<string, unknown>;
  /**
   * Whether Zotero holds the works these notes cite; `false` leaves every
   * citation unresolved, so nothing reaches the bibliography.
   *
   * @default true
   */
  zoteroHoldsWork?: boolean;
}

/** One vault whose notes declare the Citation Presentation its surfaces render. */
export interface CitationVault extends AsyncDisposable {
  /**
   * The Document Citation Text of one citation the draft writes.
   *
   * @param citekey which citation to read; the first one by default.
   */
  citationText(citekey?: string): Promise<string | undefined>;
  /** The References Sidebar entry, once its own render settles. */
  sidebarText(): Promise<string>;
  /** The References Sidebar once it settles on its minimal, note-scoped error. */
  minimalSidebarText(): Promise<string>;
  /** The Citation Popover of one citation, as it fills, and then closed. */
  popoverText(citekey?: string): Promise<string>;
  /** That same popover, left on screen while the vault changes under it. */
  showPopover(citekey?: string): OpenPopover;
  /** What the sidebar's copy action puts on the clipboard, as plain text. */
  copiedBibliography(): Promise<string>;
  /** Whether the sidebar offers a Copied Bibliography right now. */
  copyOffered(): boolean;
  /** The built-in export of the cited note, and the style its dialog opened on. */
  exportNote(override?: { styleId: string | null }): Promise<ExportedDocument>;
  /** The style ID the vault-level notice named, when it fired at all. */
  vaultStyleMissing(): string | null;
  /** The style property one note carries right now. */
  noteStyle(path: string): unknown;
  noteBody(path: string): string | undefined;
  /** Rewrite the `zotlit-csl` both notes carry; `undefined` removes it. */
  setNoteStyle(declared: unknown): Promise<void>;
  /** Rewrite the `lang` both notes carry; `undefined` removes it. */
  setNoteLanguage(declared: unknown): Promise<void>;
  /** Rewrite both properties the way the confirmed action writes them. */
  setPresentation(choice: CitationPresentationChoice): Promise<void>;
  /** Drop new vault settings on every surface at once. */
  setSettings(next: Partial<Settings>): Promise<void>;
}

export interface ExportedDocument {
  /** Where the dialog's style picker started, which the note decides. */
  openedOn: string | null;
  /** The document the run wrote; `null` where the run stopped before writing. */
  html: string | null;
}

/** One Citation Popover on screen, read as often as the vault moves under it. */
export interface OpenPopover extends Disposable {
  /** What the popover shows once it fills, or once it leaves `after` behind. */
  text(after?: string): Promise<string>;
}

/** The References Sidebar, opened over the real pane so its own state drives it. */
class TestReferencesView extends ReferencesView {
  open(): Promise<void> {
    return this.onOpen();
  }

  close(): Promise<void> {
    return this.onClose();
  }
}

export async function openCitationVault({
  styles,
  settings: overrides,
  documentStyle,
  documentLanguage,
  documentProperties = {},
  zoteroHoldsWork = true,
}: CitationVaultOptions): Promise<CitationVault> {
  resetCitationSurfaceMocks();
  if (zoteroHoldsWork) {
    citedWorks.set(KEY_A, CITED_WORK);
    citedWorks.set(KEY_B, SECOND_CITED_WORK);
  }

  await using stack = new AsyncDisposableStack();
  const dataDir = stack.adopt(
    await mkdtemp(join(tmpdir(), "zotlit-citation-surfaces-")),
    (dir) => rm(dir, { recursive: true, force: true }),
  );
  await mkdir(join(dataDir, "styles"), { recursive: true });
  for (const [name, xml] of Object.entries(styles)) {
    await writeFile(join(dataDir, "styles", name), xml);
  }

  // The Profile registry this fixture reads lives beside the settings store,
  // which holds no Profile list of its own.
  const { profiles, defaultDocument, ...persisted } = overrides;
  let profileFixture: ProfileFixture = { profiles, defaultDocument };
  const profileChanged = testEvent<void>();
  const settings = stack.use(await buildSeededSettings(persisted));
  const profileSettings = (): Settings => ({
    ...settings.bridge.runSync(settings.current),
    ...profileFixture,
  });
  const harness = stack.use(
    await createCitationIndexHarness(
      { [DRAFT]: DRAFT_BODY, [EXPORT_NOTE]: EXPORT_BODY },
      {
        settingsService: settings,
        zoteroRows: zoteroRows([...citedWorks.values()]),
        libraryScope: new LibraryScopeStub([personalLibrary(), groupLibrary()]),
      },
    ),
  );
  // The wikilink Obsidian's own cache reports for the exported note.
  harness.metadataCache.fileCache.set(EXPORT_NOTE, {
    links: [link(LINKPATH)],
  });
  /** The presentation properties both notes carry right now. */
  const declared: { style: unknown; language: unknown } = {
    style: documentStyle,
    language: documentLanguage,
  };
  /** Those same properties as one record, the way a note carries them. */
  const properties = (): Record<string, unknown> => {
    const record: Record<string, unknown> = { ...documentProperties };
    if (declared.style !== undefined) record["zotlit-csl"] = declared.style;
    if (declared.language !== undefined) record["lang"] = declared.language;
    return record;
  };
  const writeProperties = (): void => {
    const written = properties();
    const frontmatter = Object.keys(written).length > 0 ? written : undefined;
    // Pandoc reads the Document Language out of the exported note's own source,
    // which is what makes it the exported document's language, so that one
    // property is written into the body the export reads as well. Every other
    // property reaches ZotLit through Obsidian's metadata cache alone.
    harness.vault.write(
      harness.metadataCache.files.get(EXPORT_NOTE)!,
      typeof declared.language === "string"
        ? `---\nlang: ${JSON.stringify(declared.language)}\n---\n\n${EXPORT_BODY}`
        : EXPORT_BODY,
    );
    for (const path of [DRAFT, EXPORT_NOTE]) {
      harness.metadataCache.setFrontmatter(
        harness.metadataCache.files.get(path)!,
        frontmatter,
      );
    }
  };
  writeProperties();

  const engine = stack.use(
    await createCitationEngine(new Blob([await readFile(WASM_PATH)])),
  );
  const cache = stack.use(
    await bibliographyRenderFixture({
      profile: {
        changes: Stream.merge(
          settings.changes.pipe(Stream.drop(1)),
          profileChanged.stream,
        ).pipe(Stream.map(() => ({ loaded: true, profiles: [], diagnostics: [], defaultDocumentPath: "", templateStatus: { state: "loaded" as const, compileErrors: new Map() } }))),
      },
      db: harness.db,
      pandocEngine: pandocEngineHandle(engine),
      zoteroPref: { dataDir, moves: Stream.empty },
      settings,
      queryClient: harness.queryClient,
    }),
  );
  let vaultStyleMissing: string | null = null;
  stack.defer(
    subscribe(cache.runtime, missingStyleChanges(cache.changes), (styleId) => {
      vaultStyleMissing = styleId;
    }),
  );

  const citationText = stack.use(
    citationTextFixture({
      openDocuments: new OpenDocumentsStub(),
      profile: profileReader(profileSettings, harness.metadataCache),
      host: harness.host,
      citationIndex: harness.index,
      citationLookup: harness.lookup,
      noteIndex: harness.noteIndex,
      bibliographyRender: cache,
      queryClient: harness.queryClient,
    }),
  );

  harness.workspace.open(harness.draft);
  const profile = profileReader(profileSettings, harness.metadataCache);
  const pandocEngine = pandocEngineHandle(engine);
  const viewRuntime = buildRuntime(
    Layer.mergeAll(
      layerUnreadViewServices,
      layerHost(harness.host),
      Layer.succeed(CitationIndex, harness.runtime.runSync(CitationIndex)),
      Layer.succeed(
        CitationLookup,
        harness.lookup.runtime.runSync(CitationLookup),
      ),
      Layer.succeed(CitationText, citationText.runtime.runSync(CitationText)),
      Layer.succeed(
        BibliographyRender,
        cache.runtime.runSync(BibliographyRender),
      ),
      Layer.mock(PandocEngine, {
        changes: Stream.concat(
          Stream.fromEffect(pandocEngine.binary.getStatus),
          pandocEngine.binary.changes,
        ),
        decline: pandocEngine.binary.decline,
      }),
      Layer.mock(Profile, {
        loaded: Effect.sync(() => profile.loaded),
        profileOf: (file) => Effect.sync(() => profile.profileOf(file)),
        changes: Stream.merge(
          settings.changes.pipe(
            Stream.drop(1),
            Stream.map(() => undefined),
          ),
          profileChanged.stream,
        ).pipe(
          Stream.map(() => ({
            loaded: profile.loaded,
            profiles: profile.profiles,
            diagnostics: [],
            defaultDocumentPath: "",
            templateStatus: {
              state: "loaded" as const,
              compileErrors: new Map(),
            },
          })),
        ),
      }),
      Layer.mock(ZoteroReads, {
        reads: harness.db.reads,
        events: harness.db.changed.pipe(
          Stream.map(() => ({ _tag: "changed" as const })),
        ),
        changes: Stream.merge(Stream.make(undefined), harness.db.changed).pipe(
          Stream.map(() => ({
            state: harness.db.state,
            error: null,
            moved: false,
            dbFileMissing: false,
            activeReadMode: null,
          })),
        ),
      }),
    ),
    stack,
  );
  const registry = stack.adopt(
    makeViewRegistry(await viewRuntime.context(), { idleTTL: 0 }),
    (registry) => registry.dispose(),
  );

  const view = new TestReferencesView(
    // The view's leaf carries no App, as before the stub.
    Object.assign(
      stubService<WorkspaceLeaf>("WorkspaceLeaf", { updateHeader: () => {} }),
      { app: undefined },
    ),
    {
      registry,
      app: sidebarApp(harness),
      openSettings: () => undefined,
      openStyleSettings: () => undefined,
    },
  );
  document.body.append(view.contentEl);
  await act(() => view.open());
  stack.defer(async () => {
    await act(() => view.close());
    document.body.replaceChildren();
  });

  const popover = stack.use(
    citationPopoverFixture({
      profile: profileReader(profileSettings, harness.metadataCache),
      host: {
        metadataCache: harness.metadataCache,
        vault: MemoryVault.with({
          getFileByPath: (path: string) =>
            harness.metadataCache.files.get(path) ?? null,
        }),
      },
      db: harness.db,
      services: { citationIndex: harness.index, citationLookup: harness.lookup, citationText, bibliographyRender: cache },
      libraryScope: harness.libraryScope,
    }),
  );

  const copyAction = (): HTMLElement =>
    view.contentEl.querySelector<HTMLElement>(
      "[data-references-copy-bibliography]",
    )!;
  /** The sidebar offers copy exactly when its own completed render is on screen. */
  const copyOffered = (): boolean => !copyAction().hasAttribute("disabled");

  /** One Citation Popover over one draft citation, shown until it is disposed. */
  const showPopover = (citekey: string = CITATION_KEY): OpenPopover => {
    const parent: HoverParent = { hoverPopover: null };
    const targetEl = document.body.appendChild(document.createElement("span"));
    popover.runtime.runSync(
      popover.service.show({
        event: new MouseEvent("mouseover"),
        hoverParent: parent,
        sourcePath: DRAFT,
        targetEl,
        works: [
          {
            citekey,
            indexedKey: citekey === CITATION_KEY ? KEY_A : KEY_B,
          },
        ],
        // The occurrence the pointer is on, as a rendered surface names it.
        shown: { citation: { source: `@${citekey}`, keys: [] } },
        open: () => undefined,
      }),
    );
    return {
      async text(after) {
        let shown = "";
        await settle(() => {
          shown = parent.hoverPopover?.hoverEl.textContent ?? "";
          return shown.length > 0 && shown !== after;
        });
        return shown;
      },
      [Symbol.dispose]() {
        parent.hoverPopover?.hide();
        targetEl.remove();
      },
    };
  };

  const exportDeps = exportAdapter({
    dataDir,
    engine,
    harness,
    settings,
    profileSettings,
    notifier: await buildRuntime(testNotifier().layer, stack).runPromise(Notifier),
  });

  /** Wait until References acknowledges the change by withdrawing copy. */
  const changeSidebar = async (change: () => void): Promise<void> => {
    const changed = Promise.withResolvers<void>();
    using cleanup = new DisposableStack();
    cleanup.defer(
      registry.subscribe(view.model.state, (state) => {
        if (state.copy.kind === "blocked") changed.resolve();
      }),
    );
    await act(async () => {
      change();
      await changed.promise;
    });
  };

  const held = stack.move();
  return {
    async citationText(citekey = CITATION_KEY) {
      let held = citationText.bridge.runSync(citationText.peek(harness.draft.path));
      await settle(() => {
        held = citationText.bridge.runSync(citationText.peek(harness.draft.path));
        return held !== null && held.status !== "revalidating";
      });
      const { formatted } = held!.value;
      return firstText(formatted.get(`@${citekey}`));
    },
    async sidebarText() {
      await settle(copyOffered);
      return view.contentEl.textContent ?? "";
    },
    async minimalSidebarText() {
      const banner = (): string =>
        view.contentEl.querySelector("[data-references-banner]")?.textContent ??
        "";
      await settle(() => banner().length > 0);
      return view.contentEl.textContent ?? "";
    },
    async popoverText(citekey) {
      using shown = showPopover(citekey);
      return await shown.text();
    },
    showPopover,
    async copiedBibliography() {
      await settle(copyOffered);
      const taken = clipboardWrites.length;
      await act(() => {
        copyAction().click();
      });
      await settle(() => clipboardWrites.length > taken);
      return clipboardWrites.at(-1)!.text;
    },
    copyOffered,
    async exportNote(override) {
      const destination = join(dataDir, "exported.html");
      exportRun.destination = destination;
      exportRun.referencesStyleId = null;
      exportRun.override = override?.styleId;
      await runPandocExport(
        harness.metadataCache.files.get(EXPORT_NOTE)!,
        exportDeps,
      );
      return {
        openedOn: exportRun.referencesStyleId,
        html: await readFile(destination, "utf8").catch(() => null),
      };
    },
    vaultStyleMissing: () => vaultStyleMissing,
    noteStyle: (path) =>
      harness.metadataCache.fileCache.get(path)?.frontmatter?.["zotlit-csl"],
    noteBody: (path) => harness.vault.bodies.get(path),
    async setNoteStyle(style) {
      await changeSidebar(() => {
        declared.style = style;
        writeProperties();
      });
    },
    async setNoteLanguage(language) {
      await changeSidebar(() => {
        declared.language = language;
        writeProperties();
      });
    },
    async setPresentation(choice) {
      // The action's own update, over the draft as text: its Properties block
      // over an empty body. Both notes then carry the properties it wrote, so
      // the surfaces follow the one metadata change a confirmed dialog makes.
      const host = createObsidianHost({
        [DRAFT]: spliceFrontMatter("", properties()),
      });
      await applyCitationPresentation(host.app, host.file(DRAFT), choice);
      const written =
        host.metadataCache.getFileCache(host.file(DRAFT))?.frontmatter ?? {};
      await changeSidebar(() => {
        declared.style = written["zotlit-csl"];
        declared.language = written["lang"];
        writeProperties();
      });
    },
    async setSettings(next) {
      const { profiles, defaultDocument, ...persisted } = next;
      await changeSidebar(() => {
        applySettings(settings, settings.bridge, persisted);
        if ("profiles" in next || "defaultDocument" in next) {
          profileFixture = { ...profileFixture, profiles, defaultDocument };
          profileChanged.emit();
        }
      });
    },
    [Symbol.asyncDispose]: () => held[Symbol.asyncDispose](),
  };
}

/**
 * The workspace the sidebar follows: one active note, and no leaf ever moving
 * away from it.
 */
function sidebarApp({ host, draft }: CitationIndexHarness): App {
  return harnessApp(
    host,
    stubService<Workspace>("Workspace", {
      getActiveFile: () => draft,
      on: () => stubService<EventRef>("EventRef", {}),
    }),
  );
}

/**
 * Let every surface's own asynchronous work land, re-rendering the pane between
 * polls, until `settled` holds.
 */
async function settle(settled: () => boolean): Promise<void> {
  const deadline = DateTime.add(DateTime.nowUnsafe(), {
    milliseconds: TIMEOUT / 2,
  });
  while (!settled()) {
    if (DateTime.isGreaterThan(DateTime.nowUnsafe(), deadline)) {
      throw new Error("a surface never settled");
    }
    await act(async () => {
      await delay(25);
    });
  }
}

/**
 * What the built-in export command runs against: this vault's own notes and
 * settings, one read lease over the stubbed database, and the engine every
 * other surface renders through. The command reads the Citation Locale itself,
 * so the export takes the same one the in-app surfaces do.
 */
function exportAdapter({
  dataDir,
  engine,
  harness,
  settings,
  profileSettings,
  notifier,
}: {
  notifier: Notifier["Service"];
  dataDir: string;
  engine: Awaited<ReturnType<typeof createCitationEngine>>;
  harness: CitationIndexHarness;
  settings: SettingsFixture;
  profileSettings: () => Settings;
}): PandocExportDeps {
  return {
    citationParse: inProcessParseClient,
    fileSystem: Effect.runSync(FileSystem.FileSystem.pipe(Effect.provide(NodeFileSystem.layer))),
    notifier,
    app: stubService<App>("App", {
      metadataCache: harness.metadataCache as unknown as MetadataCache,
      vault: stubService<Vault>("Vault", {
        adapter: stubService<FileSystemAdapter>("FileSystemAdapter", {
          getBasePath: () => dataDir,
        }),
        cachedRead: (file: TFile) => harness.vault.cachedRead(file),
      }),
    }),
    pandocEngine: pandocEngineHandle(engine).binary,
    // The bibliography fetch is mocked, so nothing reaches Zotero.
    zoteroHttp: fakeFetchClient(() => {
      throw new Error("No Zotero in this fixture");
    }),
    settings,
    bridge: settings.bridge,
    openSettings: () => undefined,
    context: Context.make(
      ZoteroPref,
      stubService<ZoteroPref["Service"]>("ZoteroPref", {
        current: Effect.succeed(stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", { dataDir, httpPort: 23119 })),
        get: () => Effect.succeed(true),
      }),
    ).pipe(
      Context.add(ZoteroReads, stubService<ZoteroReads["Service"]>("ZoteroReads", { reads: harness.db.reads })),
      Context.add(CitationLookup, harness.lookup.runtime.runSync(CitationLookup)),
      Context.add(
        Profile,
        stubService<Profile["Service"]>("Profile", {
          loaded: Effect.succeed(true),
          profileOf: (file) => Effect.sync(() => profileReader(profileSettings, harness.metadataCache).profileOf(file)),
        }),
      ),
    ),
  };
}

function link(target: string): LinkCache {
  return {
    link: target,
    original: `[[${target}]]`,
    position: {
      start: { line: 0, col: 0, offset: 0 },
      end: { line: 0, col: target.length + 4, offset: 0 },
    },
  };
}
