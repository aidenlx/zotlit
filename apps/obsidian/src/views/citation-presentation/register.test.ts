import { Menu, TFile, TFolder } from "@mock/obsidian";
import type { App, Command, Plugin, TAbstractFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { ResolvedLiteratureNoteProfileBindings } from "@/services/settings/profile";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import type { CitationPresentationModalOptions } from "./modal";
import type { CitationPresentationChoice } from "./presentation";
import { registerCitationPresentation } from "./register";

/** The dialog the action opens, answering with whatever this test chose. */
const dialog = vi.hoisted(() => ({
  opened: [] as unknown[],
  answer: null as unknown,
}));

vi.mock("./modal", () => ({
  openCitationPresentationModal: (_app: unknown, options: unknown) => {
    dialog.opened.push(options);
    return Promise.resolve(dialog.answer);
  },
}));

const NOTE_STYLE_ID = "http://www.zotero.org/styles/note-numbered";
const VAULT_STYLE_ID = "http://www.zotero.org/styles/vault-prose";
const DATA_DIR = "/zotero";

type FileMenuHandler = (
  menu: Menu,
  file: TAbstractFile,
  source: string,
) => void;

interface VaultOptions {
  /** The properties the active note carries; `undefined` leaves no note active. */
  note?: Record<string, unknown>;
  settings?: Partial<Settings> & Partial<ResolvedLiteratureNoteProfileBindings>;
  /** Holds the vault selections back until `loadSettings()` hands them over. */
  loading?: boolean;
}

/** One vault the action runs in, opened on one Markdown note. */
function openVault({ note, settings = {}, loading }: VaultOptions = {}) {
  const file = markdownFile("draft.md");
  const vaultSettings = Promise.withResolvers<Settings>();
  const {
    ["citation.references-style"]: referencesStyle,
    ...persistedSettings
  } = settings;
  const resolvedSettings: Settings = {
    ...defaults,
    ...persistedSettings,
    "note.default-profile": {
      ...defaults["note.default-profile"],
      ...persistedSettings["note.default-profile"],
      bindings: {
        ...defaults["note.default-profile"].bindings,
        ...persistedSettings["note.default-profile"]?.bindings,
        ...(referencesStyle === undefined
          ? {}
          : { "citation.references-style": referencesStyle }),
      },
    },
  };
  if (!loading) vaultSettings.resolve(resolvedSettings);
  const frontmatter = note ?? {};
  const writes: string[] = [];
  let command: Command | undefined;
  let fileMenu: FileMenuHandler | undefined;

  const app = {
    workspace: {
      getActiveFile: () => (note ? file : null),
      on: (name: string, callback: FileMenuHandler) => {
        if (name === "file-menu") fileMenu = callback;
        return {};
      },
    },
    metadataCache: { getFileCache: () => ({ frontmatter }) },
    fileManager: {
      processFrontMatter: (
        target: TFile,
        edit: (fm: Record<string, unknown>) => void,
      ) => {
        writes.push(target.path);
        edit(frontmatter);
        return Promise.resolve();
      },
    },
  } as unknown as App;

  registerCitationPresentation(
    {
      app,
      addCommand: (added: Command) => {
        command = added;
        return added;
      },
      registerEvent: () => undefined,
    } as unknown as Pick<Plugin, "addCommand" | "registerEvent" | "app">,
    {
      app,
      zoteroPref: { ready: Promise.resolve(), dataDir: DATA_DIR },
      settings: { loaded: vaultSettings.promise },
    },
  );

  if (!command) throw new Error("the action registered no command");
  if (!fileMenu) throw new Error("the action registered no file menu");
  const palette = command;
  const onFileMenu = fileMenu;
  return {
    file,
    frontmatter,
    /** Every note this run rewrote the properties of, newest last. */
    writes,
    /** The command palette entry, as the palette offers it. */
    offered: () => palette.checkCallback?.(true) === true,
    /** Perform the action from the palette, and let its dialog settle. */
    async perform() {
      palette.checkCallback?.(false);
      await vi.waitFor(() => expect(dialog.opened.length).toBeGreaterThan(0));
      await vi.waitFor(() => expect(writes.length).toBeGreaterThan(0));
    },
    /** Perform it from the palette, leaving the dialog to answer as it will. */
    async open() {
      palette.checkCallback?.(false);
      await vi.waitFor(() => expect(dialog.opened.length).toBeGreaterThan(0));
      await Promise.resolve();
    },
    /** Perform it from the palette, leaving it to whatever it waits on. */
    begin() {
      palette.checkCallback?.(false);
    },
    /** Hand over the vault selections a loading vault held back. */
    loadSettings() {
      vaultSettings.resolve(resolvedSettings);
    },
    /** One menu this action was offered a place in, as Obsidian builds it. */
    menu(source: string, target: TAbstractFile = file as never) {
      const menu = new Menu();
      onFileMenu(menu, target, source);
      return menu;
    },
    /** The note's More options menu, where the note on screen is configured. */
    moreOptions(target?: TAbstractFile) {
      return this.menu("more-options", target);
    },
  };
}

function markdownFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.extension = "md";
  return file;
}

function answer(choice: CitationPresentationChoice | null): void {
  dialog.answer = choice;
}

/** What the dialog was opened on, which is what the user reads in it. */
function openedOn(): CitationPresentationModalOptions {
  return dialog.opened.at(-1) as CitationPresentationModalOptions;
}

beforeEach(() => {
  dialog.opened.length = 0;
  dialog.answer = { styleId: null, language: null };
});

describe("the Set citation presentation action", () => {
  it("is offered for the active Markdown note", () => {
    expect(openVault({ note: {} }).offered()).toBe(true);
  });

  it("stays out of reach where no note is active", () => {
    expect(openVault().offered()).toBe(false);
  });

  it("stays out of reach for a file that is no note", () => {
    const vault = openVault({ note: {} });
    vault.file.extension = "canvas";

    expect(vault.offered()).toBe(false);
  });

  it("opens on the presentation the note reads under today", async () => {
    const vault = openVault({
      note: { "zotlit-csl": NOTE_STYLE_ID, lang: "de-DE" },
      settings: {
        "citation.references-style": VAULT_STYLE_ID,
        "citation.locale": "en-GB",
      },
    });

    await vault.perform();

    expect(openedOn()).toMatchObject({
      dataDir: DATA_DIR,
      vaultStyleId: VAULT_STYLE_ID,
      vaultLocale: "en-GB",
      declared: { styleId: NOTE_STYLE_ID, language: "de-DE" },
    });
  });

  it("opens on the inherited presentation for a note that declares none", async () => {
    const vault = openVault({
      note: {},
      settings: { "citation.references-style": VAULT_STYLE_ID },
    });

    await vault.perform();

    expect(openedOn()).toMatchObject({
      vaultStyleId: VAULT_STYLE_ID,
      vaultLocale: "",
      declared: { styleId: null, language: "" },
    });
  });

  it("opens on the vault selections a still-loading vault is about to hold", async () => {
    const vault = openVault({
      note: {},
      settings: {
        "citation.references-style": VAULT_STYLE_ID,
        "citation.locale": "en-GB",
      },
      loading: true,
    });

    vault.begin();
    await Promise.resolve();
    expect(dialog.opened).toHaveLength(0);

    vault.loadSettings();
    await vi.waitFor(() => expect(dialog.opened.length).toBeGreaterThan(0));

    expect(openedOn()).toMatchObject({
      vaultStyleId: VAULT_STYLE_ID,
      vaultLocale: "en-GB",
    });
  });

  it("writes the chosen style and language into the note at once", async () => {
    const vault = openVault({ note: { title: "Draft" } });
    answer({ styleId: NOTE_STYLE_ID, language: "de-DE" });

    await vault.perform();

    expect(vault.frontmatter).toEqual({
      title: "Draft",
      "zotlit-csl": NOTE_STYLE_ID,
      lang: "de-DE",
    });
    expect(vault.writes).toEqual(["draft.md"]);
  });

  it("hands the note back to the vault selections it chose to inherit", async () => {
    const vault = openVault({
      note: { title: "Draft", "zotlit-csl": NOTE_STYLE_ID, lang: "de-DE" },
    });
    answer({ styleId: null, language: null });

    await vault.perform();

    expect(vault.frontmatter).toEqual({ title: "Draft" });
    expect(vault.writes).toEqual(["draft.md"]);
  });

  it("leaves the note alone where the dialog was dismissed", async () => {
    const vault = openVault({ note: { "zotlit-csl": NOTE_STYLE_ID } });
    answer(null);

    await vault.open();

    expect(vault.frontmatter).toEqual({ "zotlit-csl": NOTE_STYLE_ID });
    expect(vault.writes).toEqual([]);
  });
});

describe("the note's More options menu", () => {
  it("offers the action from the note it was opened over", async () => {
    const vault = openVault({ note: {} });
    answer({ styleId: NOTE_STYLE_ID, language: null });

    const item = vault.moreOptions().items[0];
    expect(item?.title).toBe(m.command_set_citation_presentation_name());
    expect(item?.section).toBe("zotlit");

    item?.click();
    await vi.waitFor(() => expect(vault.writes).toEqual(["draft.md"]));
    expect(vault.frontmatter).toEqual({ "zotlit-csl": NOTE_STYLE_ID });
  });

  it("stays off a file that is no note", () => {
    const vault = openVault({ note: {} });
    const canvas = new TFile();
    canvas.extension = "canvas";

    expect(vault.moreOptions(canvas as never).items).toHaveLength(0);
    expect(vault.moreOptions(new TFolder() as never).items).toHaveLength(0);
  });

  it("stays out of the menus that are no note's own", () => {
    const vault = openVault({ note: {} });

    expect(vault.menu("file-explorer-context-menu").items).toHaveLength(0);
  });
});
