// @vitest-environment happy-dom
import {
  ButtonComponent,
  DropdownComponent,
  Modal,
  settingsOf,
  TFile,
} from "@mock/obsidian";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App, Command, Plugin } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import type { InstalledCslStyle } from "@/services/pandoc/styles";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import type { ProfileFixtureSettings as Settings } from "@/services/profile/__fixtures__/reader";
import type { ResolvedLiteratureNoteProfileBindings } from "@/services/profile/bindings";
import { defaults } from "@/services/settings/schema";

import { registerPandocExport } from "./register";
import type { PandocExportDeps } from "./register";

/** The styles Zotero has installed while the export dialog is open. */
const zotero = vi.hoisted(() => ({ styles: [] as InstalledCslStyle[] }));
const notices = vi.hoisted(() => ({
  showExportFailure: vi.fn(),
  /** Every message a finished export showed. */
  shown: [] as string[],
}));

vi.mock("@/services/pandoc/styles", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/pandoc/styles")>();
  return {
    ...actual,
    listInstalledStyles: () => Promise.resolve(zotero.styles),
    // An installed style resolves as Zotero lists it; anything else takes the
    // real resolver's answer for a data directory that holds no styles.
    resolveInstalledStyle: (
      ...args: Parameters<typeof actual.resolveInstalledStyle>
    ) => {
      const listed = zotero.styles.find(({ id }) => id === args[1].styleId);
      return listed
        ? Promise.resolve({
            kind: "installed" as const,
            styleId: listed.id,
            title: listed.title,
            parentId: undefined,
            xml: "<style/>",
          })
        : actual.resolveInstalledStyle(...args);
    },
  };
});
vi.mock("@/services/pandoc/export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/pandoc/export")>()),
  exportCitedDocument: () => Promise.resolve({ output: new Uint8Array() }),
}));
vi.mock("@/lib/notice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notice")>();
  return {
    ...actual,
    BaseNotice: class extends actual.BaseNotice {
      constructor(message: string | DocumentFragment, duration?: number) {
        super(message, duration);
        if (typeof message === "string") notices.shown.push(message);
      }
    },
  };
});
vi.mock("./notices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./notices")>()),
  showExportFailure: notices.showExportFailure,
}));

const DATA_DIR = "/zotero";
const BASE_PATH = "/vault";
const NOTE_STYLE = {
  id: "http://www.zotero.org/styles/note-numbered",
  title: "Note numbered",
};
const VAULT_STYLE = {
  id: "http://www.zotero.org/styles/vault-prose",
  title: "Vault prose",
};
const MISSING_STYLE_ID = "http://www.zotero.org/styles/missing-profile-style";
const PROFILE_ID = "Aa1Bb2Cc3Dd4" as ProfileId;

interface VaultOptions {
  /** The properties the active note carries; `undefined` leaves no note active. */
  note?: Record<string, unknown>;
  settings?: Partial<Settings> &
    Pick<
      Partial<ResolvedLiteratureNoteProfileBindings>,
      "citation.references-style"
    >;
  engineInstalled?: boolean;
  /** Where the vault stands on disk, which is where an export is written. */
  basePath?: string;
}

/** One vault the built-in export command is registered in, on one note. */
function openVault({
  note,
  settings = {},
  engineInstalled = true,
  basePath = BASE_PATH,
}: VaultOptions = {}) {
  const file = markdownFile("draft.md");
  const frontmatter = note ?? {};
  const getEngine = vi.fn();
  let command: Command | undefined;
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

  const app = {
    workspace: { getActiveFile: () => (note ? file : null) },
    metadataCache: { getFileCache: () => ({ frontmatter }) },
    vault: {
      adapter: { getBasePath: () => basePath },
      cachedRead: () => Promise.resolve("[[Doe 2020]]\n"),
    },
  } as unknown as App;

  registerPandocExport(
    {
      app,
      addCommand: (added: Command) => {
        command = added;
        return added;
      },
    } as unknown as Pick<Plugin, "addCommand" | "app">,
    {
      app,
      pandocEngine: {
        getStatus: () => ({ kind: engineInstalled ? "installed" : "absent" }),
        getEngine,
      },
      zoteroPref: { ready: Promise.resolve(), dataDir: DATA_DIR },
      citationIndex: {
        whenResolved: () => Promise.resolve(),
        resolveCitekey: () => ({ kind: "missing" }),
      },
      settings: { current: resolvedSettings },
      profile: profileReader(resolvedSettings, {
        getFileCache: () => ({ frontmatter }),
      }),
      openSettings: () => undefined,
    } as unknown as PandocExportDeps,
  );

  if (!command) throw new Error("the export registered no command");
  const palette = command;
  return {
    file,
    command: palette,
    /** Whether the engine was ever asked to convert anything. */
    converted: () => getEngine.mock.calls.length > 0,
    /** The command palette entry, as the palette offers it. */
    offered: () => palette.checkCallback?.(true) === true,
    /** Run the command from the palette, and read the dialog it opens. */
    async openDialog() {
      palette.checkCallback?.(false);
      await vi.waitFor(() => expect(Modal.instances).toHaveLength(1));
      const modal = Modal.instances.at(-1)!;
      const rows = settingsOf(modal.contentEl);
      const [format, style] = rows
        .flatMap((row) => row.components)
        .filter((component) => component instanceof DropdownComponent);
      // The listing lands after the dialog is built, so the entries the user
      // reads are the ones the resolved listing left in the picker.
      await vi.waitFor(() => expect(style!.options.length).toBeGreaterThan(1));
      return {
        format: format!,
        style: style!,
        /** What the dialog says under the style picker. */
        styleNote: () =>
          rows.find((row) => row.name === m.pandoc_export_style_name())?.desc,
        /** The destination the dialog names, as the user reads it. */
        destination: () =>
          rows.find((row) => row.name === m.pandoc_export_destination_name())
            ?.desc,
        /** Dismiss the dialog without answering, as closing its window does. */
        dismiss: () => modal.close(),
        confirm: () =>
          rows
            .flatMap((row) => row.components)
            .find(
              (component): component is ButtonComponent =>
                component instanceof ButtonComponent &&
                component.text === m.pandoc_export_confirm(),
            )
            ?.click(),
        title: modal.title,
      };
    },
  };
}

function markdownFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.extension = "md";
  return file;
}

beforeEach(() => {
  Modal.instances.length = 0;
  zotero.styles = [NOTE_STYLE, VAULT_STYLE];
  notices.showExportFailure.mockClear();
  notices.shown.length = 0;
});

describe("the Export note with citations command", () => {
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

  it("opens the dialog on the style the note itself names", async () => {
    const vault = openVault({
      note: { "zotlit-csl": NOTE_STYLE.id },
      settings: { "citation.references-style": VAULT_STYLE.id },
    });

    const dialog = await vault.openDialog();

    expect(dialog.title).toBe(m.pandoc_export_title());
    expect(dialog.style.getValue()).toBe(NOTE_STYLE.id);
    expect(dialog.destination()).toBe("/vault/draft.docx");
  });

  it("opens the dialog on the vault style where the note names none", async () => {
    const vault = openVault({
      note: {},
      settings: { "citation.references-style": VAULT_STYLE.id },
    });

    const dialog = await vault.openDialog();

    expect(dialog.style.getValue()).toBe(VAULT_STYLE.id);
  });

  it("names the destination after the format the run writes", async () => {
    const vault = openVault({ note: {} });

    const dialog = await vault.openDialog();
    dialog.format.choose("html");

    expect(dialog.destination()).toBe("/vault/draft.html");
  });

  it("converts nothing where the user dismissed the dialog", async () => {
    const vault = openVault({ note: {} });

    const dialog = await vault.openDialog();
    dialog.dismiss();
    await vi.waitFor(() => expect(Modal.instances).toHaveLength(1));

    expect(vault.converted()).toBe(false);
  });

  it("opens no dialog for a note whose own style property holds no ID", async () => {
    const vault = openVault({ note: { "zotlit-csl": ["a-list"] } });

    vault.command.checkCallback?.(false);
    await vi.waitFor(() => expect(vault.converted()).toBe(false));

    expect(Modal.instances).toHaveLength(0);
  });

  it.each([
    [
      "the note",
      { note: { "zotlit-csl": NOTE_STYLE.id } },
      m.pandoc_export_style_from_note(),
    ],
    [
      "the vault settings",
      {
        note: {},
        settings: { "citation.references-style": VAULT_STYLE.id },
      },
      m.pandoc_export_style_from_vault(),
    ],
    [
      "the Profile",
      {
        note: {
          "zotero-note-key": "1/NOTE1234",
          "zotlit-profile": PROFILE_ID,
        },
        settings: {
          profiles: [
            {
              id: PROFILE_ID,
              label: "Research",
              bindings: { "citation.references-style": NOTE_STYLE.id },
            },
          ],
        },
      },
      m.pandoc_export_style_from_profile({ profile: "Research" }),
    ],
  ] satisfies [string, VaultOptions, string][])(
    "says the style comes from %s",
    async (_source, options, text) => {
      const dialog = await openVault(options).openDialog();

      expect(dialog.styleNote()).toBe(text);
    },
  );

  it("says the note keeps its style where this export picks another", async () => {
    const vault = openVault({ note: { "zotlit-csl": NOTE_STYLE.id } });

    const dialog = await vault.openDialog();
    dialog.style.choose(VAULT_STYLE.id);

    expect(dialog.styleNote()).toBe(
      m.pandoc_export_style_changed({ style: NOTE_STYLE.title }),
    );
  });

  it("names the style the finished export cites with", async () => {
    await using stack = new AsyncDisposableStack();
    const basePath = stack.adopt(
      await mkdtemp(join(tmpdir(), "zotlit-export-")),
      (dir) => rm(dir, { recursive: true, force: true }),
    );
    const vault = openVault({
      note: {},
      settings: { "citation.references-style": VAULT_STYLE.id },
      basePath,
    });

    const dialog = await vault.openDialog();
    dialog.confirm();

    await vi.waitFor(() =>
      expect(notices.shown).toContain(
        m.notice_pandoc_export_done({
          file: "draft.docx",
          style: VAULT_STYLE.title,
        }),
      ),
    );
  });

  it("stops rather than exporting in another style where Zotero lacks the vault style", async () => {
    const vault = openVault({
      note: {},
      settings: { "citation.references-style": MISSING_STYLE_ID },
    });

    const dialog = await vault.openDialog();
    dialog.confirm();

    await vi.waitFor(() =>
      expect(notices.showExportFailure).toHaveBeenCalledWith({
        kind: "style-invalid",
        style: MISSING_STYLE_ID,
      }),
    );
    expect(vault.converted()).toBe(false);
  });

  it("names the Profile when its selected style is unavailable", async () => {
    const vault = openVault({
      note: {
        "zotero-note-key": "1/NOTE1234",
        "zotlit-profile": PROFILE_ID,
      },
      settings: {
        profiles: [
          {
            id: PROFILE_ID,
            label: "Research",
            bindings: { "citation.references-style": MISSING_STYLE_ID },
          },
        ],
      },
    });

    const dialog = await vault.openDialog();
    expect(dialog.style.getValue()).toBe(MISSING_STYLE_ID);
    dialog.confirm();

    await vi.waitFor(() =>
      expect(notices.showExportFailure).toHaveBeenCalledWith({
        kind: "profile-style-invalid",
        styleId: MISSING_STYLE_ID,
      }),
    );
    expect(vault.converted()).toBe(false);
  });
});
