// @vitest-environment happy-dom
import {
  ButtonComponent,
  DropdownComponent,
  Modal,
  settingsOf,
  TFile,
} from "@mock/obsidian";
import type { App, Command, Plugin } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import type { InstalledCslStyle } from "@/services/pandoc/styles";
import type { ResolvedLiteratureNoteProfileBindings } from "@/services/settings/profile";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import { registerPandocExport } from "./register";
import type { PandocExportDeps } from "./register";

/** The styles Zotero has installed while the export dialog is open. */
const zotero = vi.hoisted(() => ({ styles: [] as InstalledCslStyle[] }));
const notices = vi.hoisted(() => ({ showExportFailure: vi.fn() }));

vi.mock("@/services/pandoc/styles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/pandoc/styles")>()),
  listInstalledStyles: () => Promise.resolve(zotero.styles),
}));
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
}

/** One vault the built-in export command is registered in, on one note. */
function openVault({
  note,
  settings = {},
  engineInstalled = true,
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
    vault: { adapter: { getBasePath: () => BASE_PATH } },
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
      settings: { current: resolvedSettings },
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
});

describe("the Export note with citations command", () => {
  it("is registered under the name the palette offers it by", () => {
    expect(openVault({ note: {} }).command).toMatchObject({
      id: "pandoc-export",
      name: m.command_pandoc_export_name(),
    });
  });

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

  it("names the Profile when its selected style is unavailable", async () => {
    const vault = openVault({
      note: {
        "zotero-note-key": "1/NOTE1234",
        "zotlit-profile": PROFILE_ID,
      },
      settings: {
        "note.profiles": [
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
