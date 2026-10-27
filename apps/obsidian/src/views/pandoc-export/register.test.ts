import { it as effectIt } from "@effect/vitest";
// @vitest-environment happy-dom
import {
  ButtonComponent,
  DropdownComponent,
  Modal,
  settingsOf,
} from "@mock/obsidian";
import { Cause, Effect, Exit, ManagedRuntime } from "effect";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TFile } from "obsidian";
import type { App, Command, FileSystemAdapter, Plugin } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
import * as m from "@/lib/i18n/generated/messages";
import { Notifier } from "@/lib/notifier";
import type { ProfileId } from "@/lib/profile-stamp";
import { lookupAnswer } from "@/services/citation-index/__fixtures__/lookup";
import type { ManagedBinaryApi } from "@/services/managed-binary/service";
import { nodeFileSystem } from "@/services/pandoc/__fixtures__/file-effects";
import type { CitationEngine } from "@/services/pandoc/engine";
import type { InstalledCslStyle } from "@/services/pandoc/styles";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import type { ProfileFixtureSettings as Settings } from "@/services/profile/__fixtures__/reader";
import type { ResolvedLiteratureNoteProfileBindings } from "@/services/profile/bindings";
import { defaults } from "@/services/settings/schema";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";

import { exportWithCitations, registerPandocExport } from "./register";
import type { PandocExportDeps, PandocExportOutcome } from "./register";

/** The styles Zotero has installed while the export dialog is open. */
const zotero = vi.hoisted(() => ({ styles: [] as InstalledCslStyle[] }));
/** How the stubbed export run ends. */
const exportRun = vi.hoisted(() => ({
  /** Interrupt the run, as unloading the plugin does. */
  unload: false,
}));

vi.mock("@/services/pandoc/styles", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/pandoc/styles")>();
  return {
    ...actual,
    // An installed style resolves as Zotero lists it; anything else takes the
    // real resolver's answer for a data directory that holds no styles.
    resolveInstalledStyle: (
      ...args: Parameters<typeof actual.resolveInstalledStyle>
    ) => {
      const listed = zotero.styles.find(({ id }) => id === args[1].styleId);
      return listed
        ? Effect.succeed({
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
  exportCitedDocument: () =>
    exportRun.unload
      ? Effect.interrupt
      : Effect.succeed({ output: new Uint8Array() }),
}));
vi.mock("@/services/pandoc/installed-styles", () => ({
  listInstalledStylesOrNone: () => Effect.succeed(zotero.styles),
}));
const writes = vi.hoisted(() => ({
  wait: null as Promise<void> | null,
  started: null as (() => void) | null,
}));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      writes.started?.();
      if (writes.wait) await writes.wait;
      return actual.writeFile(...args);
    },
  };
});

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
  // The export stub above still needs an available engine handle.
  const getEngine = vi.fn(() => Promise.resolve({}));
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

  const app = stubService<App>("App", {
    workspace: stubService<App["workspace"]>("Workspace", {
      getActiveFile: () => (note ? file : null),
    }),
    metadataCache: stubService<App["metadataCache"]>("MetadataCache", {
      getFileCache: () => ({ frontmatter }),
    }),
    vault: stubService<App["vault"]>("Vault", {
      adapter: stubService<FileSystemAdapter>("FileSystemAdapter", {
        getBasePath: () => basePath,
      }),
      getName: () => "Research",
      cachedRead: () => Promise.resolve("[[Doe 2020]]\n"),
    }),
  });

  const reader = profileReader(resolvedSettings, {
    getFileCache: () => ({ frontmatter }),
  });
  const notifier = testNotifier();
  const runtime = ManagedRuntime.make(notifier.layer);
  runtimes.push(runtime);
  const bridge = effectBridge(runtime);
  const deps = stubService<PandocExportDeps>("PandocExportDeps", {
    fileSystem: nodeFileSystem,
    app,
    pandocEngine: stubService<ManagedBinaryApi<CitationEngine>>(
      "PandocEngine",
      {
        getStatus: Effect.succeed(
          engineInstalled
            ? {
                kind: "installed",
                version: "test",
                binary: {
                  directory: "pandoc-engine",
                  name: "pandoc.wasm",
                },
              }
            : { kind: "absent" },
        ),
        getEngine: Effect.promise(() => getEngine()).pipe(
          Effect.map(() =>
            stubService<CitationEngine>("CitationEngine", {
              [Symbol.asyncDispose]: async () => {},
            }),
          ),
        ),
      },
    ),
    zoteroPref: stubService<PandocExportDeps["zoteroPref"]>("ZoteroPref", {
      current: Effect.succeed(
        stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
          dataDir: DATA_DIR,
          httpPort: 23119,
        }),
      ),
      get: () => Effect.succeed(false),
    }),
    db: stubService<PandocExportDeps["db"]>("ZoteroReads", {}),
    citationParse: stubService<PandocExportDeps["citationParse"]>(
      "CitationParse",
      {},
    ),
    zoteroHttp: stubService<PandocExportDeps["zoteroHttp"]>("ZoteroHttp", {}),
    citationLookup: {
      read: () => Effect.succeed(lookupAnswer()),
    },
    settings: { current: Effect.succeed(resolvedSettings) },
    bridge,
    profile: {
      loaded: Effect.succeed(true),
      profileOf: (file) => Effect.succeed(reader.profileOf(file)),
    },
    notifier: Notifier.of({
      ...notifier.service,
      track: (notice) => runtime.runSync(Notifier).track(notice),
    }),
    openSettings: () => undefined,
  });
  registerPandocExport(
    stubService<Pick<Plugin, "addCommand" | "app">>("Plugin", {
      app,
      addCommand: (added: Command) => {
        command = added;
        return added;
      },
    }),
    deps,
  );

  if (!command) throw new Error("the export registered no command");
  const palette = command;
  return {
    file,
    close: () => runtime.dispose(),
    notices: notifier.notices,
    /** Whether the engine was ever asked to convert anything. */
    converted: () => getEngine.mock.calls.length > 0,
    /** The command palette entry, as the palette offers it. */
    offered: () => palette.checkCallback?.(true) === true,
    /** Run one export of the note, as the palette entry does. */
    export: runExport,
    /** Run one export, and read the dialog it opens. */
    openDialog: () => dialog(runExport()),
    /** Run the command from the palette, and read the dialog it opens. */
    openDialogFromPalette() {
      palette.checkCallback?.(false);
      return dialog(null);
    },
  };

  async function runExport(): Promise<PandocExportOutcome> {
    const exit = await bridge.runPromiseExit(exportWithCitations(file, deps));
    if (Exit.isSuccess(exit)) return exit.value;
    if (Cause.hasInterruptsOnly(exit.cause)) return { kind: "stopped" };
    throw Cause.squash(exit.cause);
  }

  /**
   * The dialog an export opened.
   *
   * @param outcome how the export ends, where the test holds it.
   */
  async function dialog(outcome: Promise<PandocExportOutcome> | null) {
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
      /** How the export ended. */
      outcome,
    };
  }
}

function markdownFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.extension = "md";
  return file;
}

const runtimes: ManagedRuntime.ManagedRuntime<Notifier, never>[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

beforeEach(() => {
  Modal.instances.length = 0;
  zotero.styles = [NOTE_STYLE, VAULT_STYLE];
  exportRun.unload = false;
  writes.wait = null;
  writes.started = null;
});

describe("the Export note with citations command", () => {
  effectIt.live("closes a pending export dialog on unload (#1830)", () =>
    Effect.gen(function* () {
      const vault = openVault({ note: {} });
      const dialog = yield* Effect.promise(() => vault.openDialog());
      expect(Modal.instances.at(-1)?.isOpen).toBe(true);
      yield* Effect.promise(() => vault.close());
      expect(Modal.instances.at(-1)?.isOpen).toBe(false);
      expect(yield* Effect.promise(() => dialog.outcome!)).toEqual({
        kind: "stopped",
      });
      expect(vault.converted()).toBe(false);
    }),
  );

  effectIt.live(
    "finishes a started destination write before unload ends (#1830)",
    () =>
      Effect.gen(function* () {
        const basePath = yield* Effect.acquireRelease(
          Effect.promise(() => mkdtemp(join(tmpdir(), "zotlit-export-"))),
          (dir) =>
            Effect.promise(() => rm(dir, { recursive: true, force: true })),
        );
        const started = Promise.withResolvers<void>();
        const writing = Promise.withResolvers<void>();
        writes.started = () => started.resolve();
        writes.wait = writing.promise;
        const vault = openVault({ note: {}, basePath });
        const dialog = yield* Effect.promise(() => vault.openDialog());
        dialog.confirm();
        yield* Effect.promise(() => started.promise);
        let closed = false;
        const closing = vault.close().then(() => {
          closed = true;
        });
        yield* Effect.yieldNow;
        expect(closed).toBe(false);
        writing.resolve();
        yield* Effect.promise(() => closing);
        expect(
          yield* Effect.promise(() => readFile(join(basePath, "draft.docx"))),
        ).toHaveLength(0);
      }),
  );

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
    expect(dialog.destination()).toBe(
      m.pandoc_export_destination_in_vault({
        path: "draft.docx",
        vault: "Research",
      }),
    );
  });

  it("opens the dialog on the vault style where the note names none", async () => {
    const vault = openVault({
      note: {},
      settings: { "citation.references-style": VAULT_STYLE.id },
    });

    const dialog = await vault.openDialog();

    expect(dialog.style.getValue()).toBe(VAULT_STYLE.id);
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

    expect(await vault.export()).toEqual({
      kind: "failed",
      problem: { kind: "document-style-invalid" },
    });

    expect(vault.converted()).toBe(false);
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

    expect(await dialog.outcome).toEqual({
      kind: "exported",
      destination: join(basePath, "draft.docx"),
      styleTitle: VAULT_STYLE.title,
    });
    expect(await readFile(join(basePath, "draft.docx"))).toHaveLength(0);
  });

  it("writes the export the palette entry runs", async () => {
    await using stack = new AsyncDisposableStack();
    const basePath = stack.adopt(
      await mkdtemp(join(tmpdir(), "zotlit-export-")),
      (dir) => rm(dir, { recursive: true, force: true }),
    );
    const vault = openVault({ note: {}, basePath });

    const dialog = await vault.openDialogFromPalette();
    dialog.confirm();

    await vi.waitFor(async () =>
      expect(await readdir(basePath)).toEqual(["draft.docx"]),
    );
    await vi.waitFor(() =>
      expect(vault.notices.flatMap((notice) => notice.messages)).toContain(
        m.notice_pandoc_export_done({
          file: "draft.docx",
          style: m.settings_citation_references_style_default(),
        }),
      ),
    );
  });

  it("stops without a file where the export run is interrupted", async () => {
    exportRun.unload = true;
    await using stack = new AsyncDisposableStack();
    const basePath = stack.adopt(
      await mkdtemp(join(tmpdir(), "zotlit-export-")),
      (dir) => rm(dir, { recursive: true, force: true }),
    );
    const vault = openVault({ note: {}, basePath });

    const dialog = await vault.openDialog();
    dialog.confirm();

    expect(await dialog.outcome).toEqual({ kind: "stopped" });
    expect(vault.converted()).toBe(true);
    expect(await readdir(basePath)).toEqual([]);
  });

  it("stops rather than exporting in another style where Zotero lacks the vault style", async () => {
    const vault = openVault({
      note: {},
      settings: { "citation.references-style": MISSING_STYLE_ID },
    });

    const dialog = await vault.openDialog();
    dialog.confirm();

    expect(await dialog.outcome).toEqual({
      kind: "failed",
      problem: { kind: "style-invalid", style: MISSING_STYLE_ID },
    });
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

    expect(await dialog.outcome).toEqual({
      kind: "failed",
      problem: { kind: "profile-style-invalid", styleId: MISSING_STYLE_ID },
    });
    expect(vault.converted()).toBe(false);
  });
});
