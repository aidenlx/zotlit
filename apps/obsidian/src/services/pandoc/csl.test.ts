import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { CONTRACT_VERSION } from "./contract";
import { CSL_COMMAND, materializeCslStyle, resolveCslStyle } from "./csl";
import type { CslResponse } from "./csl";
import { resolveInstalledStyle } from "./styles";

/** Filenames the filesystem refuses outright, as a file without read access is. */
const deniedReads = new Set<string>();

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const [path] = args;
      if (typeof path === "string" && deniedReads.has(basename(path))) {
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      }
      return actual.readFile(...args);
    },
  };
});

const PARENT = "http://www.zotero.org/styles/journal";
const DEPENDENT = "http://www.zotero.org/styles/journal-german";
const BROKEN_DEPENDENT = "http://www.zotero.org/styles/journal-broken";
const MISSING = "http://www.zotero.org/styles/uninstalled";

describe("zotlit:csl", () => {
  it("answers a materialized file for an independent style", async () => {
    await using zotero = await installStyles();

    const response = await zotero.csl(PARENT);

    expect(response).toEqual({
      contractVersion: CONTRACT_VERSION,
      command: CSL_COMMAND,
      styleId: PARENT,
      path: expect.stringMatching(/\.csl$/),
    });
    await expect(readFile(pathOf(response), "utf8")).resolves.toContain(
      `<id>${PARENT}</id>`,
    );
  });

  it("names the independent parent a dependent style resolved through", async () => {
    await using zotero = await installStyles();

    const response = await zotero.csl(DEPENDENT);

    expect(response).toMatchObject({
      styleId: DEPENDENT,
      parentId: PARENT,
    });
    // The parent's formatting under the dependent style's own default locale.
    const xml = await readFile(pathOf(response), "utf8");
    expect(xml).toContain(`<id>${PARENT}</id>`);
    expect(xml).toContain('default-locale="de-DE"');
  });

  it("answers one path for identical content and another for changed content", async () => {
    await using zotero = await installStyles();

    const first = pathOf(await zotero.csl(PARENT));
    expect(pathOf(await zotero.csl(PARENT))).toBe(first);

    await zotero.writeStyle("journal.csl", {
      id: PARENT,
      body: '<bibliography><layout><text value="revised"/></layout></bibliography>',
      hidden: true,
    });

    expect(pathOf(await zotero.csl(PARENT))).not.toBe(first);
  });

  it("restamps the style it hands out, so use holds off the store reaper", async () => {
    await using zotero = await installStyles();

    const path = pathOf(await zotero.csl(PARENT));
    const stale = Temporal.Instant.from("2024-01-01T00:00:00Z");
    const staleSeconds = stale.epochMilliseconds / 1000;
    await utimes(path, staleSeconds, staleSeconds);

    // The second resolve finds the content already materialized and writes
    // nothing; only the restamp separates its answer from an untouched file.
    expect(pathOf(await zotero.csl(PARENT))).toBe(path);
    expect((await stat(path)).mtimeMs).toBeGreaterThan(stale.epochMilliseconds);
  });

  it("never exposes a partial file to a concurrent run", async () => {
    await using zotero = await installStyles();

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => zotero.csl(DEPENDENT)),
    );

    const paths = new Set(responses.map(pathOf));
    expect(paths.size).toBe(1);
    const [path] = paths;
    await expect(readFile(path!, "utf8")).resolves.toContain("</style>");
    // The staged writes leave nothing of their own behind.
    await expect(readdir(dirname(path!))).resolves.toEqual([basename(path!)]);
  });

  it("reports an uninstalled requested style", async () => {
    await using zotero = await installStyles();

    expect(await zotero.csl(MISSING)).toEqual({
      contractVersion: CONTRACT_VERSION,
      command: CSL_COMMAND,
      errors: [
        {
          code: "style-missing",
          styleId: MISSING,
          message: expect.stringContaining(MISSING),
        },
      ],
    });
  });

  it("reports an uninstalled independent parent", async () => {
    await using zotero = await installStyles();
    await zotero.writeStyle("orphan.csl", {
      id: "http://www.zotero.org/styles/orphan",
      parentId: MISSING,
    });

    expect(
      await zotero.csl("http://www.zotero.org/styles/orphan"),
    ).toMatchObject({
      errors: [{ code: "parent-missing", parentId: MISSING }],
    });
  });

  it("reports a CSL file that refuses to be read", async () => {
    await using zotero = await installStyles();
    deniedReads.add("journal.csl");

    expect(await zotero.csl(DEPENDENT)).toMatchObject({
      errors: [{ code: "style-unreadable", styleId: DEPENDENT }],
    });
  });

  it("reports content that is no standalone CSL style", async () => {
    await using zotero = await installStyles();
    await zotero.writeCsl(
      "broken.csl",
      `<?xml version="1.0"?><style xmlns="http://purl.org/net/xbiblio/csl" version="1.0"><info><id>${MISSING}</id></info><bibliography><layout><text value="x"/></bibliography></style>`,
    );

    expect(await zotero.csl(MISSING)).toMatchObject({
      errors: [{ code: "style-invalid", styleId: MISSING }],
    });
  });

  it("reports a dependent style whose own file is no CSL style", async () => {
    await using zotero = await installStyles();
    // The file names the installed parent, and closes an element it never
    // opened. The parent's formatting stands in for the formatting a dependent
    // style leaves out, never for markup it holds broken.
    await zotero.writeCsl(
      "journal-broken.csl",
      `<?xml version="1.0"?><style xmlns="http://purl.org/net/xbiblio/csl" version="1.0"><info><id>${BROKEN_DEPENDENT}</id><link href="${PARENT}" rel="independent-parent"/></info><layout/></citation></style>`,
    );

    expect(await zotero.csl(BROKEN_DEPENDENT)).toMatchObject({
      errors: [
        {
          code: "style-invalid",
          styleId: BROKEN_DEPENDENT,
          parentId: PARENT,
        },
      ],
    });
  });

  it("reports a materialization that fails", async () => {
    await using zotero = await installStyles();

    const response = await resolveCslStyle(PARENT, {
      resolve: (styleId) => resolveInstalledStyle(zotero.dataDir, { styleId }),
      materialize: () => Promise.reject(new Error("no space left on device")),
    });

    expect(response).toMatchObject({
      errors: [
        {
          code: "csl-write-failed",
          styleId: PARENT,
          message: expect.stringContaining("no space left on device"),
        },
      ],
    });
  });
});

/**
 * The path a successful response carries, asserting there is one and that it is
 * absolute — citeproc opens it from whatever working directory Pandoc runs in.
 */
function pathOf(response: CslResponse): string {
  expect(response).not.toHaveProperty("errors");
  const path = "path" in response ? response.path : "";
  expect(isAbsolute(path)).toBe(true);
  return path;
}

interface StyleFixture {
  id: string;
  parentId?: string;
  defaultLocale?: string;
  /** The elements a processor formats with, absent for a dependent style. */
  body?: string;
  hidden?: boolean;
}

/** One Zotero install, and the materialization store its resolutions land in. */
interface ZoteroStyles extends AsyncDisposable {
  dataDir: string;
  /** One `zotlit:csl` call against this install. */
  csl: (styleId: string) => Promise<CslResponse>;
  writeStyle: (filename: string, fixture: StyleFixture) => Promise<void>;
  writeCsl: (filename: string, xml: string) => Promise<void>;
}

async function installStyles(): Promise<ZoteroStyles> {
  await using stack = new AsyncDisposableStack();
  const root = stack.adopt(
    await mkdtemp(join(tmpdir(), "zotlit-csl-command-")),
    (dir) => rm(dir, { recursive: true, force: true }),
  );
  deniedReads.clear();

  const dataDir = join(root, "zotero");
  const store = join(root, "store");
  const writeCsl = async (
    filename: string,
    xml: string,
    { hidden = false } = {},
  ): Promise<void> => {
    const dir = join(dataDir, "styles", ...(hidden ? ["hidden"] : []));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, filename), xml);
  };
  await writeCsl("journal.csl", styleXml({ id: PARENT }), { hidden: true });
  await writeCsl(
    "journal-german.csl",
    styleXml({ id: DEPENDENT, parentId: PARENT, defaultLocale: "de-DE" }),
  );

  const held = stack.move();
  return {
    dataDir,
    csl: (styleId) =>
      resolveCslStyle(styleId, {
        resolve: (requested) =>
          resolveInstalledStyle(dataDir, { styleId: requested }),
        materialize: (xml) => materializeCslStyle(xml, store),
      }),
    writeStyle: (filename, fixture) =>
      writeCsl(filename, styleXml(fixture), fixture),
    writeCsl: (filename, xml) => writeCsl(filename, xml),
    [Symbol.asyncDispose]: () => held[Symbol.asyncDispose](),
  };
}

/** A CSL file shaped like the ones Zotero installs. */
function styleXml({ id, parentId, defaultLocale, body }: StyleFixture): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0"${
      defaultLocale === undefined ? "" : ` default-locale="${defaultLocale}"`
    }>`,
    "  <info>",
    `    <id>${id}</id>`,
    ...(parentId === undefined
      ? []
      : [`    <link href="${parentId}" rel="independent-parent"/>`]),
    "  </info>",
    ...(parentId === undefined
      ? [
          body ??
            `  <bibliography><layout><text value="${id}"/></layout></bibliography>`,
        ]
      : []),
    "</style>",
  ].join("\n");
}
