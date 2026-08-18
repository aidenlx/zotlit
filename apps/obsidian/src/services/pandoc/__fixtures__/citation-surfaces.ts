// One vault, read at once through every Citation Presentation surface: the
// Document Citation Text, the References Sidebar, the Citation Popover, the
// Copied Bibliography, and the built-in export.

import { delay } from "@std/async";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  App,
  CachedMetadata,
  EventRef,
  HoverParent,
  LinkCache,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import { act } from "preact/test-utils";
import { vi } from "vitest";

import { Temporal } from "@zotlit/shared/temporal";

import {
  createCitationIndexHarness,
  KEY_A,
  KEY_B,
  SettingsStub,
} from "@/services/citation-index/test-harness";
import type { CitationIndexHarness } from "@/services/citation-index/test-harness";
import { createCitationPopover } from "@/services/citation-popover/service";
import { firstText } from "@/services/citation-text/__fixtures__";
import { CitationText } from "@/services/citation-text/service";
import { createCitationEngine } from "@/services/pandoc/engine";
import { BibliographyRenderCache } from "@/services/pandoc/render-cache";
import type { Settings } from "@/services/settings/schema";
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

vi.mock("@zotlit/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@zotlit/db")>()),
  ...(await import("./citation-surface-mocks")).zoteroDatabaseDoubles(),
}));

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

/** The work both notes cite first, as the database and Zotero itself answer it. */
const CITED_WORK: CitedWork = {
  libraryID: 1,
  key: "DOE2024",
  row: {
    key: "DOE2024",
    itemID: 1,
    groupID: null,
    indexedKey: KEY_A,
    creators: [{ creatorType: "author", lastName: "Zeta", firstName: "Ann" }],
    primaryCreatorType: "author",
    customFields: [],
    fields: {
      itemType: "book",
      title: "A study of nothing",
      date: "2020",
      citationKey: CITATION_KEY,
    },
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
  libraryID: 1,
  key: "ROE2025",
  row: {
    key: "ROE2025",
    itemID: 2,
    groupID: null,
    indexedKey: KEY_B,
    creators: [{ creatorType: "author", lastName: "Alpha", firstName: "Bo" }],
    primaryCreatorType: "author",
    customFields: [],
    fields: {
      itemType: "book",
      title: "A second study of nothing",
      date: "2021",
      citationKey: SECOND_CITATION_KEY,
    },
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

export interface CitationVaultOptions {
  /** Every style Zotero has installed here, by the file name it carries. */
  styles: Record<string, string>;
  /** The vault settings every surface renders under. */
  settings: Partial<Settings>;
  /** The `zotlit-csl` property both notes carry; `undefined` writes none. */
  documentStyle?: unknown;
  /** The `lang` property both notes carry; `undefined` writes none. */
  documentLanguage?: unknown;
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

  const settings = new SettingsStub(overrides);
  const harness = stack.use(
    await createCitationIndexHarness(
      { [DRAFT]: DRAFT_BODY, [EXPORT_NOTE]: EXPORT_BODY },
      { settingsService: settings },
    ),
  );
  // The wikilink Obsidian's own cache reports for the exported note.
  harness.metadataCache.fileCache.set(EXPORT_NOTE, {
    links: [link(LINKPATH)],
  } as CachedMetadata);
  /** The presentation properties both notes carry right now. */
  const declared: { style: unknown; language: unknown } = {
    style: documentStyle,
    language: documentLanguage,
  };
  /** Those same properties as one record, the way a note carries them. */
  const properties = (): Record<string, unknown> => {
    const record: Record<string, unknown> = {};
    if (declared.style !== undefined) record["zotlit-csl"] = declared.style;
    if (declared.language !== undefined) record["lang"] = declared.language;
    return record;
  };
  const writeProperties = (): void => {
    const written = properties();
    const frontmatter =
      Object.keys(written).length > 0 ? written : undefined;
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
    await createCitationEngine(await readFile(WASM_PATH)),
  );
  const cache = stack.use(
    new BibliographyRenderCache({
      db: harness.db,
      pandocEngine: {
        getStatus: () => ({ kind: "installed", version: "test" }),
        subscribe: () => () => undefined,
        getEngine: () => Promise.resolve(engine),
      },
      zoteroPref: { dataDir, on: () => () => undefined },
      settings,
    }),
  );
  await cache.ready;
  let vaultStyleMissing: string | null = null;
  stack.defer(
    cache.onStyleMissing((styleId) => {
      vaultStyleMissing = styleId;
    }),
  );

  const citationText = stack.use(
    new CitationText({
      app: harness.app,
      db: harness.db,
      citationIndex: harness.index,
      noteIndex: harness.noteIndex,
      bibliographyRender: cache,
    }),
  );
  await citationText.ready;

  const view = new TestReferencesView(
    {} as WorkspaceLeaf,
    {
      app: sidebarApp(harness),
      db: harness.db,
      citationIndex: harness.index,
      citationText,
      citekeyEditor: { openCitekey: () => Promise.resolve() },
      pandocEngine: {
        getStatus: () => ({ kind: "installed", version: "test" }),
        subscribe: () => () => undefined,
        decline: () => undefined,
      },
      bibliographyRender: cache,
      openSettings: () => undefined,
      openStyleSettings: () => undefined,
    } as unknown as ConstructorParameters<typeof TestReferencesView>[1],
  );
  document.body.append(view.contentEl);
  await act(() => view.open());
  stack.defer(async () => {
    await act(() => view.close());
    document.body.replaceChildren();
  });

  const popover = createCitationPopover({
    app: {
      metadataCache: harness.metadataCache,
      vault: {
        getFileByPath: (path: string) =>
          harness.metadataCache.files.get(path) ?? null,
      },
    } as unknown as App,
    db: harness.db,
    citationIndex: harness.index,
    citationText,
    bibliographyRender: cache,
  });

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
    popover.show({
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
    });
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

  const exportDeps = exportAdapter({ dataDir, engine, harness, settings });

  const held = stack.move();
  return {
    async citationText(citekey = CITATION_KEY) {
      const { formatted } = await citationText.load(harness.draft);
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
      declared.style = style;
      writeProperties();
      // The pane rescans on the metadata change; the surfaces follow it.
      await act(async () => undefined);
    },
    async setNoteLanguage(language) {
      declared.language = language;
      writeProperties();
      await act(async () => undefined);
    },
    async setPresentation(choice) {
      // The action's own update, over the properties both notes carry, so the
      // surfaces follow the one metadata change a confirmed dialog makes.
      await applyCitationPresentation(
        {
          processFrontMatter: (_file, edit) => {
            const written = properties();
            edit(written);
            declared.style = written["zotlit-csl"];
            declared.language = written["lang"];
            writeProperties();
            return Promise.resolve();
          },
        },
        harness.metadataCache.files.get(DRAFT)!,
        choice,
      );
      await act(async () => undefined);
    },
    async setSettings(next) {
      settings.update(next);
      // The drop reaches every surface at once; the pane republishes with it.
      await act(async () => undefined);
    },
    [Symbol.asyncDispose]: () => held[Symbol.asyncDispose](),
  };
}

/**
 * The workspace the sidebar follows: one active note, and no leaf ever moving
 * away from it.
 */
function sidebarApp({ app, draft }: CitationIndexHarness): App {
  return {
    metadataCache: app.metadataCache,
    vault: app.vault,
    workspace: {
      getActiveFile: () => draft,
      on: () => ({}) as EventRef,
    },
  } as unknown as App;
}

/**
 * Let every surface's own asynchronous work land, re-rendering the pane between
 * polls, until `settled` holds.
 */
async function settle(settled: () => boolean): Promise<void> {
  const deadline = Temporal.Now.instant().add({
    milliseconds: TIMEOUT / 2,
  });
  while (!settled()) {
    if (Temporal.Instant.compare(Temporal.Now.instant(), deadline) > 0) {
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
}: {
  dataDir: string;
  engine: Awaited<ReturnType<typeof createCitationEngine>>;
  harness: CitationIndexHarness;
  settings: SettingsStub;
}): PandocExportDeps {
  return {
    app: {
      metadataCache: harness.metadataCache,
      vault: {
        adapter: { getBasePath: () => dataDir },
        cachedRead: (file: TFile) => harness.vault.cachedRead(file),
      },
    } as unknown as App,
    db: {
      acquireRead: () =>
        Promise.resolve({
          client: harness.db.client,
          [Symbol.dispose]: () => undefined,
        }),
    } as unknown as PandocExportDeps["db"],
    pandocEngine: {
      getStatus: () => ({ kind: "installed", version: "test" }),
      getEngine: () => Promise.resolve(engine),
    },
    zoteroPref: {
      ready: Promise.resolve(),
      dataDir,
      get: () => true,
    } as unknown as PandocExportDeps["zoteroPref"],
    settings,
    openSettings: () => undefined,
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
