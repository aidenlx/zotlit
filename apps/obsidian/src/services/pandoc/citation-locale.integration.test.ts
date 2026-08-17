// @vitest-environment happy-dom
// One vault Citation Locale, as every Citation Presentation surface renders it.

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
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getItemsByKey, resolveIndexedKeyLibrary } from "@zotlit/db";
import type { CslItemData } from "@zotlit/db";
import { Temporal } from "@zotlit/shared/temporal";

import {
  createCitationIndexHarness,
  KEY_A,
  SettingsStub,
} from "@/services/citation-index/test-harness";
import type { CitationIndexHarness } from "@/services/citation-index/test-harness";
import { createCitationPopover } from "@/services/citation-popover/service";
import { firstText } from "@/services/citation-text/__fixtures__";
import { CitationText } from "@/services/citation-text/service";
import { runPandocExport } from "@/views/pandoc-export/register";
import type { PandocExportDeps } from "@/views/pandoc-export/register";
import { ReferencesView } from "@/views/references/view";

import { createCitationEngine } from "./engine";
import type { CitationEngine } from "./engine";
import { BibliographyRenderCache } from "./render-cache";

const clipboard = vi.hoisted(() => ({
  writes: [] as { html: string; text: string }[],
}));

/** What the export dialog answers with, as the run under way chose it. */
const exportRun = vi.hoisted(() => ({
  choices: null as {
    format: "html";
    styleId: string | null;
    destination: string;
  } | null,
}));

vi.mock("@/views/pandoc-export/modal", () => ({
  openPandocExportModal: () => Promise.resolve(exportRun.choices),
}));

/** Zotero itself, answering for the one Item this vault cites. */
vi.mock("@/services/pandoc/bibliography", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/pandoc/bibliography")>()),
  fetchBibliography: () =>
    Promise.resolve({
      source: "local-api" as const,
      items: new Map([[KEY_A, EXPORTED_ITEM]]),
    }),
}));

vi.mock("@/lib/clipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/clipboard")>()),
  writeClipboardRichText: (content: { html: string; text: string }) => {
    clipboard.writes.push(content);
    return Promise.resolve("rich" as const);
  },
}));

vi.mock("zustand", () => import("@/views/__fixtures__/zustand"));

vi.mock("@/components/obsidian/icon-button", async () => {
  const { createElement } = await import("react");
  return {
    IconButton: ({ icon, ...props }: { icon: string }) =>
      createElement("button", { ...props, "data-icon": icon }),
  };
});

vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return {
    ...actual,
    getZoteroIdentity: () => ({
      userID: 1,
      localUserKey: null,
      username: null,
    }),
    resolveIndexedKeyLibrary: vi.fn(),
    getItemsByKey: vi.fn(),
    getAttachmentsByParents: () => [],
  };
});

const WASM_PATH = join(
  dirname(createRequire(import.meta.url).resolve("pandoc-wasm")),
  "pandoc.wasm",
);

/** Instantiating the Haskell runtime dominates every timing here. */
const TIMEOUT = 60_000;

const STYLE_ID = "http://www.zotero.org/styles/localized";

/**
 * Both layouts render one localized term and nothing else, so an in-text
 * citation and a bibliography entry each say which locale formatted it.
 */
const STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info>
    <title>Localized</title>
    <id>${STYLE_ID}</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation><layout><text term="editor" form="long"/></layout></citation>
  <bibliography><layout><text term="editor" form="long"/></layout></bibliography>
</style>`;

/** The citation key the draft cites, which the harness resolves to {@link KEY_A}. */
const CITATION_KEY = "doe2024";
const DRAFT = "draft.md";
const BODY = `Cited @${CITATION_KEY}.`;

/** The Zotero Item behind that citation key, as the stubbed database answers it. */
const ZOTERO_ITEM = {
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
};

/** The note the exported document cites, which the harness holds for {@link KEY_A}. */
const EXPORT_NOTE = "export.md";
const LINKPATH = "Doe 2024";

/** The same work as CSL-JSON, as Zotero hands it to an export. */
const EXPORTED_ITEM: CslItemData = {
  id: "zeta2020",
  type: "article-journal",
  title: "A study of nothing",
  author: [{ family: "Zeta", given: "Ann" }],
  issued: { "date-parts": [[2020]] },
};

/** The term the style renders, per Citation Locale. */
const EDITOR = { en: "editor", "de-DE": "Herausgeber" };

beforeEach(() => {
  clipboard.writes.length = 0;
  vi.mocked(resolveIndexedKeyLibrary).mockImplementation((_client, key) =>
    key === KEY_A ? { libraryID: 1, key: ZOTERO_ITEM.key } : null,
  );
  vi.mocked(getItemsByKey).mockImplementation((_client, _libraryID, keys) =>
    keys[0] === ZOTERO_ITEM.key ? [ZOTERO_ITEM as never] : [],
  );
});

describe("vault Citation Locale", { timeout: TIMEOUT }, () => {
  it("formats every in-app surface and the built-in export in it", async () => {
    await using vault = await openVault("de-DE");

    await expect(vault.citationText()).resolves.toBe(EDITOR["de-DE"]);
    await expect(vault.sidebarText()).resolves.toContain(EDITOR["de-DE"]);
    await expect(vault.popoverText()).resolves.toContain(EDITOR["de-DE"]);
    await expect(vault.copiedBibliography()).resolves.toContain(
      EDITOR["de-DE"],
    );

    const exported = await vault.exportHtml();
    expect(exported).toContain(EDITOR["de-DE"]);
    // The locale controls citeproc without becoming the document's language.
    expect(/<html[^>]*lang=/.test(exported)).toBe(false);
  });

  it("leaves Style default to the selected style", async () => {
    await using vault = await openVault(null);

    await expect(vault.citationText()).resolves.toBe(EDITOR.en);
    await expect(vault.sidebarText()).resolves.toContain(EDITOR.en);
    await expect(vault.popoverText()).resolves.toContain(EDITOR.en);
    await expect(vault.copiedBibliography()).resolves.toContain(EDITOR.en);
    await expect(vault.exportHtml()).resolves.toContain(EDITOR.en);
  });

  it("moves every surface together when the setting changes", async () => {
    await using vault = await openVault(null);
    await expect(vault.sidebarText()).resolves.toContain(EDITOR.en);
    // This popover stays open across the change, as a hovered one would.
    using popover = vault.showPopover();
    const shown = await popover.text();
    expect(shown).toContain(EDITOR.en);

    await vault.setLocale("de-DE");

    // Copy stays out of reach until the new locale's render lands.
    expect(vault.copyOffered()).toBe(false);
    await expect(vault.citationText()).resolves.toBe(EDITOR["de-DE"]);
    await expect(vault.sidebarText()).resolves.toContain(EDITOR["de-DE"]);
    await expect(popover.text(shown)).resolves.toContain(EDITOR["de-DE"]);
    await expect(vault.copiedBibliography()).resolves.toContain(
      EDITOR["de-DE"],
    );
    await expect(vault.exportHtml()).resolves.toContain(EDITOR["de-DE"]);
  });
});

/** One vault whose Citation Presentation every surface below renders through. */
interface Vault extends AsyncDisposable {
  /** The Document Citation Text of the one citation the draft writes. */
  citationText(): Promise<string>;
  /** The References Sidebar entry, once its own render settles. */
  sidebarText(): Promise<string>;
  /** The Citation Popover of that citation, as it fills, and then closed. */
  popoverText(): Promise<string>;
  /** That same popover, left on screen while the vault changes under it. */
  showPopover(): OpenPopover;
  /** What the sidebar's copy action puts on the clipboard, as plain text. */
  copiedBibliography(): Promise<string>;
  /** Whether the sidebar offers a Copied Bibliography right now. */
  copyOffered(): boolean;
  /** The built-in export of a cited note, as standalone HTML. */
  exportHtml(): Promise<string>;
  setLocale(locale: string | null): Promise<void>;
}

/** One Citation Popover on screen, read as often as the vault moves under it. */
interface OpenPopover extends Disposable {
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

async function openVault(locale: string | null): Promise<Vault> {
  await using stack = new AsyncDisposableStack();
  const dataDir = stack.adopt(
    await mkdtemp(join(tmpdir(), "zotlit-citation-locale-")),
    (dir) => rm(dir, { recursive: true, force: true }),
  );
  await mkdir(join(dataDir, "styles"), { recursive: true });
  await writeFile(join(dataDir, "styles", "localized.csl"), STYLE);

  const settings = new SettingsStub({
    "citation.references-style": STYLE_ID,
    "citation.locale": locale,
  });
  const harness = stack.use(
    await createCitationIndexHarness(
      { [DRAFT]: BODY, [EXPORT_NOTE]: `Cited [[${LINKPATH}]].\n` },
      { settingsService: settings },
    ),
  );
  // The wikilink Obsidian's own cache reports for the exported note.
  harness.metadataCache.fileCache.set(EXPORT_NOTE, {
    links: [link(LINKPATH)],
  } as CachedMetadata);
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

  /** One Citation Popover over the draft's citation, shown until it is disposed. */
  const showPopover = (): OpenPopover => {
    const parent: HoverParent = { hoverPopover: null };
    const targetEl = document.body.appendChild(document.createElement("span"));
    popover.show({
      event: new MouseEvent("mouseover"),
      hoverParent: parent,
      sourcePath: DRAFT,
      targetEl,
      works: [{ citekey: CITATION_KEY, indexedKey: KEY_A }],
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
    async citationText() {
      const { formatted } = await citationText.load(harness.draft);
      const text = firstText(formatted.get(`@${CITATION_KEY}`));
      if (text === undefined) throw new Error("no citation render");
      return text;
    },
    async sidebarText() {
      await settle(copyOffered);
      return view.contentEl.textContent ?? "";
    },
    async popoverText() {
      using shown = showPopover();
      return await shown.text();
    },
    showPopover,
    async copiedBibliography() {
      await settle(copyOffered);
      const taken = clipboard.writes.length;
      await act(() => {
        copyAction().click();
      });
      await settle(() => clipboard.writes.length > taken);
      return clipboard.writes.at(-1)!.text;
    },
    copyOffered,
    async exportHtml() {
      const destination = join(dataDir, "exported.html");
      // What the export dialog leaves the command: the vault's own style, and
      // no locale of its own — that one the command reads from the settings.
      exportRun.choices = {
        format: "html",
        styleId: settings.current["citation.references-style"],
        destination,
      };
      await runPandocExport(
        harness.metadataCache.files.get(EXPORT_NOTE)!,
        exportDeps,
      );
      return readFile(destination, "utf8");
    },
    async setLocale(next) {
      settings.update({ "citation.locale": next });
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
  engine: CitationEngine;
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
