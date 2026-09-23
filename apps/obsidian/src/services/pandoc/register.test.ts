import "@mock/dom-parser";
import { TFile } from "@mock/obsidian";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { profileReader } from "@/services/profile/__fixtures__/reader";
import { defaults } from "@/services/settings/schema";

import type { CslResponse } from "./csl";
import { PANDOC_FILES_COMMAND, PANDOC_GUIDE_COMMAND } from "./integration";
import {
  CSL_COMMAND,
  registerPandocResolve,
  RESOLVE_COMMAND,
} from "./register";
import type { PandocResolveDeps } from "./register";

describe("Pandoc CLI registration", () => {
  it("connects every Pandoc handler to the CLI surface", () => {
    const registerCliHandler = vi.fn();
    const plugin = {
      manifest: { version: "2.0.1-test" },
      registerCliHandler,
    } as unknown as Plugin;

    registerPandocResolve(plugin, {} as never);

    expect(registerCliHandler.mock.calls.map(([command]) => command)).toEqual([
      PANDOC_FILES_COMMAND,
      PANDOC_GUIDE_COMMAND,
      RESOLVE_COMMAND,
      CSL_COMMAND,
    ]);
    expect(
      registerCliHandler.mock.calls.every(
        (call) => typeof call[3] === "function",
      ),
    ).toBe(true);
  });
});

const APA = "http://www.zotero.org/styles/apa";
const UNINSTALLED = "http://www.zotero.org/styles/uninstalled";
const NOTE_PATH = "/vault/draft.md";

/** One vault whose `zotlit:csl` handler answers for one note, over real style files. */
async function cslVault({
  note,
  vaultStyle,
}: {
  note: Record<string, unknown>;
  vaultStyle: string | null;
}) {
  await using stack = new AsyncDisposableStack();
  const root = stack.adopt(
    await mkdtemp(join(tmpdir(), "zotlit-csl-handler-")),
    (dir) => rm(dir, { recursive: true, force: true }),
  );
  const dataDir = join(root, "zotero");
  await mkdir(join(dataDir, "styles"), { recursive: true });
  await writeFile(
    join(dataDir, "styles", "apa.csl"),
    [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">',
      `  <info><title>APA Style 7th edition</title><id>${APA}</id></info>`,
      '  <bibliography><layout><text value="apa"/></layout></bibliography>',
      "</style>",
    ].join("\n"),
  );
  // The materialized style lands under the temporary root, not the device store.
  vi.stubEnv("TMPDIR", root);
  stack.defer(() => {
    vi.unstubAllEnvs();
  });

  const file = new TFile();
  file.path = "draft.md";
  const metadataCache = { getFileCache: () => ({ frontmatter: note }) };
  const settings = {
    ...defaults,
    "note.default-profile": {
      ...defaults["note.default-profile"],
      bindings: {
        ...defaults["note.default-profile"].bindings,
        "citation.references-style": vaultStyle,
      },
    },
  };
  const registerCliHandler = vi.fn();
  registerPandocResolve(
    {
      manifest: { version: "2.0.1-test" },
      registerCliHandler,
    } as unknown as Plugin,
    {
      app: {
        vault: {
          adapter: { getBasePath: () => "/vault" },
          getFileByPath: (path: string) => (path === file.path ? file : null),
        },
        metadataCache,
      },
      db: {},
      zoteroPref: { ready: Promise.resolve(), dataDir },
      settings: { current: settings },
      profile: profileReader(settings, metadataCache),
    } as unknown as PandocResolveDeps,
  );
  const handler = registerCliHandler.mock.calls.find(
    ([command]) => command === CSL_COMMAND,
  )![3] as (params: Record<string, string>) => Promise<string>;

  const held = stack.move();
  return {
    csl: async (params: Record<string, string>) =>
      JSON.parse(await handler(params)) as CslResponse,
    [Symbol.asyncDispose]: () => held[Symbol.asyncDispose](),
  };
}

describe("zotlit:csl for one note", () => {
  it("answers the vault style for a note that selects none of its own", async () => {
    await using vault = await cslVault({ note: {}, vaultStyle: APA });

    const response = await vault.csl({ file: NOTE_PATH });

    expect(response).toMatchObject({
      styleId: APA,
      title: "APA Style 7th edition",
      source: { kind: "vault" },
    });
    await expect(
      readFile((response as { path: string }).path, "utf8"),
    ).resolves.toContain(`<id>${APA}</id>`);
  });

  it("answers the note's own style where it names one", async () => {
    await using vault = await cslVault({
      note: { "zotlit-csl": APA },
      vaultStyle: null,
    });

    expect(await vault.csl({ file: NOTE_PATH })).toMatchObject({
      styleId: APA,
      source: { kind: "note" },
    });
  });

  it("answers no style file where the vault selects Default", async () => {
    await using vault = await cslVault({ note: {}, vaultStyle: null });

    const response = await vault.csl({ file: NOTE_PATH });

    expect(response).toMatchObject({
      styleId: null,
      source: { kind: "vault" },
    });
    expect(response).not.toHaveProperty("path");
  });

  it("stops on a vault style Zotero lacks, naming the settings to repair", async () => {
    await using vault = await cslVault({ note: {}, vaultStyle: UNINSTALLED });

    expect(await vault.csl({ file: NOTE_PATH })).toMatchObject({
      errors: [
        {
          code: "style-missing",
          styleId: UNINSTALLED,
          message: expect.stringContaining("ZotLit settings"),
        },
      ],
    });
  });

  it("reports a path that names no vault note", async () => {
    await using vault = await cslVault({ note: {}, vaultStyle: APA });

    expect(await vault.csl({ file: "/elsewhere/draft.md" })).toMatchObject({
      errors: [{ code: "file-not-found" }],
    });
  });

  it("refuses a request that names both a style and a note", async () => {
    await using vault = await cslVault({ note: {}, vaultStyle: APA });

    expect(await vault.csl({ style: APA, file: NOTE_PATH })).toMatchObject({
      errors: [{ code: "flags-invalid" }],
    });
  });
});
