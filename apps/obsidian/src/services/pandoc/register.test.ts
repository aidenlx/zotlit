import "@mock/dom-parser";
import { TFile } from "@mock/obsidian";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, vi } from "vitest";

import { fakeCliHost } from "@/lib/__fixtures__/cli-host";
import { Effect } from "@/lib/effect";
import { acquireAsyncDisposable } from "@/lib/effect-scope";
import { it } from "@/lib/effect-vitest";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import type { ProfileReader } from "@/services/profile/service";
import { defaults } from "@/services/settings/schema";

import type { CslResponse } from "./csl";
import {
  CSL_COMMAND,
  registerPandocResolve,
  RESOLVE_COMMAND,
} from "./register";
import type { PandocResolveDeps } from "./register";
import type { ResolveResponse } from "./resolve";

const APA = "http://www.zotero.org/styles/apa";

/** The Profile service, answering from a fixture reader. */
const effectProfile = (reader: ProfileReader) => ({
  loaded: Effect.sync(() => reader.loaded),
  profileOf: (file?: Parameters<ProfileReader["profileOf"]>[0]) =>
    Effect.sync(() => reader.profileOf(file)),
});
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
  const { host, command } = fakeCliHost();
  registerPandocResolve({ ...host, manifest: { version: "2.0.1-test" } }, {
    app: {
      vault: {
        adapter: { getBasePath: () => "/vault" },
        getFileByPath: (path: string) => (path === file.path ? file : null),
      },
      metadataCache,
    },
    zoteroPref: { current: Effect.succeed({ dataDir }) },
    settings: { current: Effect.succeed(settings) },
    profile: effectProfile(profileReader(settings, metadataCache)),
  } as unknown as PandocResolveDeps);
  const handlerOf = (name: string) => command(name).handler;

  const held = stack.move();
  return {
    csl: (params: Record<string, string>) =>
      handlerOf(CSL_COMMAND)(params).pipe(
        Effect.map((output) => JSON.parse(output) as CslResponse),
      ),
    resolve: (params: Record<string, string>) =>
      handlerOf(RESOLVE_COMMAND)(params).pipe(
        Effect.map((output) => JSON.parse(output) as ResolveResponse),
      ),
    [Symbol.asyncDispose]: () => held[Symbol.asyncDispose](),
  };
}

/** {@link cslVault}, removed when the test's scope closes. */
const scopedCslVault = (options: Parameters<typeof cslVault>[0]) =>
  acquireAsyncDisposable(() => cslVault(options));

describe("zotlit:csl for one note", () => {
  it.effect(
    "answers the vault style for a note that selects none of its own",
    () =>
      Effect.gen(function* () {
        const vault = yield* scopedCslVault({ note: {}, vaultStyle: APA });

        const response = yield* vault.csl({ file: NOTE_PATH });

        expect(response).toMatchObject({
          styleId: APA,
          title: "APA Style 7th edition",
          source: { kind: "vault" },
        });
        const written = yield* Effect.promise(() =>
          readFile((response as { path: string }).path, "utf8"),
        );
        expect(written).toContain(`<id>${APA}</id>`);
      }),
  );

  it.effect("answers the note's own style where it names one", () =>
    Effect.gen(function* () {
      const vault = yield* scopedCslVault({
        note: { "zotlit-csl": APA },
        vaultStyle: null,
      });

      expect(yield* vault.csl({ file: NOTE_PATH })).toMatchObject({
        styleId: APA,
        source: { kind: "note" },
      });
    }),
  );

  it.effect("answers no style file where the vault selects Default", () =>
    Effect.gen(function* () {
      const vault = yield* scopedCslVault({ note: {}, vaultStyle: null });

      const response = yield* vault.csl({ file: NOTE_PATH });

      expect(response).toMatchObject({
        styleId: null,
        source: { kind: "vault" },
      });
      expect(response).not.toHaveProperty("path");
    }),
  );

  it.effect(
    "stops on a vault style Zotero lacks, naming the settings to repair",
    () =>
      Effect.gen(function* () {
        const vault = yield* scopedCslVault({
          note: {},
          vaultStyle: UNINSTALLED,
        });

        expect(yield* vault.csl({ file: NOTE_PATH })).toMatchObject({
          errors: [
            {
              code: "style-missing",
              styleId: UNINSTALLED,
              message: expect.stringContaining("ZotLit settings"),
            },
          ],
        });
      }),
  );

  it.effect("reports a path that names no vault note", () =>
    Effect.gen(function* () {
      const vault = yield* scopedCslVault({ note: {}, vaultStyle: APA });

      expect(yield* vault.csl({ file: "/elsewhere/draft.md" })).toMatchObject({
        errors: [{ code: "file-not-found" }],
      });
    }),
  );

  it.effect("refuses a request that names both a style and a note", () =>
    Effect.gen(function* () {
      const vault = yield* scopedCslVault({ note: {}, vaultStyle: APA });

      expect(yield* vault.csl({ style: APA, file: NOTE_PATH })).toMatchObject({
        errors: [{ code: "flags-invalid" }],
      });
    }),
  );

  it.effect.each<[Record<string, string>, string]>([
    [{ file: NOTE_PATH, colour: "red" }, "Unknown parameter 'colour'"],
    [{ "--file": NOTE_PATH }, "Run the command with file=<value>, without --."],
    [{ file: "true" }, "file requires a value."],
  ])("refuses the parameters %j", ([params, message]) =>
    Effect.gen(function* () {
      const vault = yield* scopedCslVault({ note: {}, vaultStyle: APA });

      expect(yield* vault.csl(params)).toMatchObject({
        errors: [
          { code: "flags-invalid", message: expect.stringContaining(message) },
        ],
      });
    }),
  );
});

describe("zotlit:resolve parameters", () => {
  it.effect("refuses a bare file and gives the recovery for a -- token", () =>
    Effect.gen(function* () {
      const vault = yield* scopedCslVault({ note: {}, vaultStyle: APA });

      expect(yield* vault.resolve({ file: "true" })).toMatchObject({
        errors: [{ code: "flags-invalid", message: "file requires a value." }],
      });
      expect(yield* vault.resolve({ "--verbose": "true" })).toMatchObject({
        errors: [
          {
            code: "flags-invalid",
            message: expect.stringContaining(
              "Use a supported parameter as name=value, without --",
            ),
          },
        ],
      });
    }),
  );

  it.effect("refuses a parameter it does not take", () =>
    Effect.gen(function* () {
      const vault = yield* scopedCslVault({ note: {}, vaultStyle: APA });

      expect(
        yield* vault.resolve({ file: NOTE_PATH, style: APA }),
      ).toMatchObject({
        errors: [
          {
            code: "flags-invalid",
            message: expect.stringContaining("Unknown parameter 'style'"),
          },
        ],
      });
    }),
  );
});
