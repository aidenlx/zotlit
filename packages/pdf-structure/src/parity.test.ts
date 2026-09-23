// The golden parity test. Zotero's pinned modules, run from a local checkout,
// are the oracle for the Structured Characters and Page Labels the port
// produces; the Sort Index strings Zotero itself wrote into the Fixture are the
// oracle for the Sort Index.

import { fingerprint } from "@oracle/fingerprint.mjs";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import {
  ANNOTATIONS,
  ASSET_DIR,
  ATTACHMENTS,
  PARITY_PDFS,
} from "@zotlit/scripts/fixture/spec";
import {
  getPackageRoot,
  getWorkspaceRoot,
} from "@zotlit/scripts/package-roots";

import type { ObsidianTextItem, Rect, ZoteroChar } from "@/chars";
import { structurePage, toZoteroChars } from "@/chars";
import { PdfTextStructure } from "@/session";
import type { PdfPosition } from "@/sort-index";
import { computeSortIndex } from "@/sort-index";
import { offsetsByRects, textRange } from "@/text-selection";

const run = promisify(execFile);

const packageRoot = getPackageRoot(import.meta.filename);

/**
 * Parity means parity with one fork, so every commit of the checkout the port
 * came from is pinned: a checkout at another revision, or with edits on top,
 * would quietly compare the port against different upstream code and pass.
 */
const PINNED_COMMITS = {
  ".": "22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c",
  reader: "132bb787937a540a09513415fd507654eb0e88f9",
  "reader/pdfjs/pdf.js": "f57fc80d1c07e4cdc50a767ae0b500b5272123b4",
} as const;

const git = (repository: string, ...args: string[]) =>
  run("git", ["-C", repository, ...args])
    .then(({ stdout }) => stdout.trim())
    .catch(() => null);

/**
 * The checkout sits beside the repository unless the environment names it.
 * Beside the *repository*, not beside the workspace root, so the default still
 * resolves from a worktree.
 */
async function defaultCheckout(): Promise<string> {
  const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
  const commonDir = await git(
    workspaceRoot,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  );
  return join(
    commonDir ? dirname(commonDir) : workspaceRoot,
    "..",
    "zotero-10",
  );
}

const checkout =
  process.env.ZOTLIT_ZOTERO_CHECKOUT ?? (await defaultCheckout());

async function findCheckoutProblem(): Promise<string | null> {
  for (const [path, commit] of Object.entries(PINNED_COMMITS)) {
    const repository = join(checkout, path);
    const head = await git(repository, "rev-parse", "HEAD");
    if (head !== commit) {
      return `${repository} is at ${head ?? "no readable revision"}, not the pinned ${commit}`;
    }
    const dirty = await git(repository, "status", "--porcelain");
    if (dirty) {
      return `${repository} sits at the pinned ${commit} with uncommitted changes on top`;
    }
  }
  return null;
}

const checkoutProblem = await findCheckoutProblem();

const skip = checkoutProblem !== null;

/**
 * Always runs, so a machine without the checkout reads the reason in the
 * report instead of seeing the whole suite quietly disappear.
 */
describe("the golden oracle", () => {
  it("is a Zotero checkout pinned to the commits the port came from", (context) => {
    if (checkoutProblem) {
      context.skip(
        `${checkoutProblem}. Set ZOTLIT_ZOTERO_CHECKOUT to a zotero/zotero ` +
          "checkout whose submodules are initialised and pinned to the " +
          "commits PINNED_COMMITS names.",
      );
    }
    expect(checkoutProblem).toBeNull();
  });
});

interface OracleItem {
  readonly transform: readonly number[];
  readonly chars: readonly ZoteroChar[];
}

interface OraclePage {
  readonly viewBox: Rect;
  readonly items: readonly OracleItem[];
  readonly structured: readonly string[];
}

interface Oracle {
  readonly numPages: number;
  readonly catalogPageLabels: readonly string[] | null;
  readonly pageLabels: readonly string[];
  readonly pages: readonly OraclePage[];
}

const oracles = new Map<string, Promise<Oracle>>();

function askZotero(asset: string): Promise<Oracle> {
  const pending =
    oracles.get(asset) ??
    run(
      process.execPath,
      [
        "--import",
        join(packageRoot, "oracle/register.mjs"),
        join(packageRoot, "oracle/extract.mjs"),
        join(ASSET_DIR, asset),
      ],
      {
        env: { ...process.env, ZOTLIT_ZOTERO_CHECKOUT: checkout },
        maxBuffer: 512 * 1024 * 1024,
      },
    ).then(({ stdout }) => JSON.parse(stdout) as Oracle);
  oracles.set(asset, pending);
  return pending;
}

/**
 * The shape Obsidian hands the adapter, rebuilt from what Zotero recorded:
 * Zotero's `u` is the raw glyph Obsidian puts in `c`, and the per-glyph
 * metrics are what the adapter has to derive from the item's text matrix.
 */
function asObsidianItems(
  items: readonly OracleItem[],
): readonly ObsidianTextItem[] {
  return items.map(({ transform, chars }) => ({
    transform,
    fontName: chars[0]!.fontName,
    chars: chars.map(({ u, rect }) => ({ c: u, u, r: rect })),
  }));
}

interface Difference {
  readonly where: string;
  readonly index: number;
  readonly got: string | undefined;
  readonly want: string | undefined;
}

function differences(
  where: string,
  got: readonly string[],
  want: readonly string[],
): readonly Difference[] {
  const found: Difference[] = [];
  for (
    let i = 0;
    i < Math.max(got.length, want.length) && found.length < 5;
    i++
  ) {
    if (got[i] !== want[i])
      found.push({ where, index: i, got: got[i], want: want[i] });
  }
  return found;
}

/** Every Fixture PDF, so the parity claim covers every layout the Fixture has. */
const PDFS = [
  "rougier-2014/rougier-2014.pdf",
  "ioannidis-2005/ioannidis-2005.pdf",
  "sakimas-song/sakimas-song.pdf",
  ...PARITY_PDFS.map(({ asset }) => asset),
];

describe.skipIf(skip)("Structured Characters and Page Labels", () => {
  it.each(PDFS)(
    "match Zotero index for index on %s",
    async (asset) => {
      const oracle = await askZotero(asset);
      const adapterDifferences: Difference[] = [];
      const structureDifferences: Difference[] = [];
      const structuredCounts: number[] = [];

      for (const [pageIndex, page] of oracle.pages.entries()) {
        const items = asObsidianItems(page.items);
        const expected = page.items
          .flatMap((item) => item.chars)
          .map((char) => JSON.stringify(char));
        adapterDifferences.push(
          ...differences(
            `${asset} page ${pageIndex} chars`,
            toZoteroChars(items).map((char) => JSON.stringify(char)),
            expected,
          ),
        );

        const structured = structurePage(pageIndex, page.viewBox, items);
        structuredCounts.push(structured.chars.length);
        structureDifferences.push(
          ...differences(
            `${asset} page ${pageIndex} structure`,
            structured.chars.map((char) => fingerprint(char)),
            page.structured,
          ),
        );
      }

      expect(adapterDifferences).toEqual([]);
      expect(structureDifferences).toEqual([]);
      expect(structuredCounts).toEqual(
        oracle.pages.map((page) => page.structured.length),
      );
    },
    180_000,
  );

  it.each(PDFS)(
    "match Zotero's Page Labels on %s",
    async (asset) => {
      const oracle = await askZotero(asset);
      const structure = new PdfTextStructure({
        numPages: oracle.numPages,
        getViewBox: (pageIndex) =>
          Promise.resolve(oracle.pages[pageIndex]!.viewBox),
        getTextItems: (pageIndex) =>
          Promise.resolve(asObsidianItems(oracle.pages[pageIndex]!.items)),
        getCatalogPageLabels: () => Promise.resolve(oracle.catalogPageLabels),
      });

      expect(await structure.pageLabels()).toEqual(oracle.pageLabels);
    },
    180_000,
  );
});

/**
 * The Fixture carries every PDF Annotation type on `RGRPDF24` with the Sort
 * Index Zotero's own reader wrote for it, so those strings are an oracle no
 * part of this package took part in producing. The Annotations on the other
 * Attachments carry reviewed anchors rather than captured Zotero output.
 */
describe.skipIf(skip)("the Sort Index", () => {
  it("reproduces every Sort Index Zotero wrote into the Fixture", async () => {
    const attachment = ATTACHMENTS.find(({ key }) => key === "RGRPDF24")!;
    const recorded = ANNOTATIONS.filter(
      ({ parentItemID }) => parentItemID === attachment.itemID,
    );
    const oracle = await askZotero(attachment.sourceAsset!);

    const computed = recorded.map(({ key, position }) => {
      const page = oracle.pages[position.pageIndex]!;
      const structured = structurePage(
        position.pageIndex,
        page.viewBox,
        asObsidianItems(page.items),
      );
      return `${key} ${computeSortIndex(structured, position as PdfPosition)}`;
    });

    expect(recorded.length).toBeGreaterThan(0);
    expect(computed).toEqual(
      recorded.map(({ key, sortIndex }) => `${key} ${sortIndex}`),
    );
  }, 180_000);
});

/**
 * The Fixture's two hand-built PDFs exist to drive the line grouping down
 * branches the published papers never reach. The Spec declares which branch
 * each one is for; this checks the bytes still deliver it, so a regenerated
 * PDF that lost its rotated block cannot quietly weaken the parity claim.
 */
describe.skipIf(skip)("the parity PDFs the Fixture declares", () => {
  it.each(PARITY_PDFS)(
    "exercise the branches $branches",
    async ({ asset }) => {
      const [page] = (await askZotero(asset)).pages;
      const chars = structurePage(
        0,
        page!.viewBox,
        asObsidianItems(page!.items),
      ).chars;

      const branches = new Set<string>();
      if (chars.length === 0) branches.add("no-text-layer");
      if (chars.some(({ rotation }) => rotation === 90))
        branches.add("rotation");
      if (chars.some(({ c, u }) => c.length > 1 && u.length === 1)) {
        branches.add("ligature");
      }
      // The generator sets the left column at x = 60 and the right at x = 330,
      // so the midpoint between them separates the two runs.
      const columnSplitX = 195;
      const columns = new Set(
        chars
          .filter(({ rotation }) => rotation === 0)
          .map(({ rect }) => (rect[0] < columnSplitX ? "left" : "right")),
      );
      if (columns.size === 2) branches.add("multi-column");

      expect([...branches].sort()).toEqual(
        PARITY_PDFS.find((pdf) => pdf.asset === asset)!.branches.toSorted(),
      );
    },
    180_000,
  );
});

/** The reader's own selection module, which the text-selection port copies. */
interface ZoteroSelection {
  extractRange(options: {
    chars: readonly unknown[];
    pageIndex: number;
    anchor: number;
    head: number;
  }): { position: { rects: Rect[] }; text: string } | null;
  extractRangeByRects(options: {
    chars: readonly unknown[];
    pageIndex: number;
    rects: readonly Rect[];
  }): { from: number; to: number } | null;
}

/**
 * The text-selection port against Zotero's own `selection.js`, over the same
 * Structured Characters: the characters themselves are already proved above,
 * so this isolates the range, rectangle and text rules.
 */
describe.skipIf(skip)("text ranges", () => {
  /** Anchor and head pairs spread over the page, both directions included. */
  const pairs = (charCount: number) =>
    Array.from({ length: 40 }, (_, i) => [
      (i * 37) % (charCount + 1),
      (i * 91 + 13) % (charCount + 1),
    ]);

  const withText = PDFS.filter(
    (asset) =>
      !PARITY_PDFS.some(
        (pdf) => pdf.asset === asset && pdf.branches.includes("no-text-layer"),
      ),
  );

  it.each(withText)(
    "match Zotero's ranges on %s",
    async (asset) => {
      const zotero = (await import(
        /* @vite-ignore */ join(checkout, "reader/src/pdf/selection.js")
      )) as ZoteroSelection;
      const oracle = await askZotero(asset);
      const got: string[] = [];
      const want: string[] = [];

      for (const [pageIndex, page] of oracle.pages.entries()) {
        const { chars } = structurePage(
          pageIndex,
          page.viewBox,
          asObsidianItems(page.items),
        );
        if (!chars.length) continue;
        for (const [anchor, head] of pairs(chars.length)) {
          const where = `${asset} page ${pageIndex} ${anchor}-${head}`;
          const expected = zotero.extractRange({
            chars,
            pageIndex,
            anchor: anchor!,
            head: head!,
          })!;
          const range = textRange(chars, anchor!, head!);
          got.push(`${where} ${JSON.stringify(range.rects)} ${range.text}`);
          want.push(
            `${where} ${JSON.stringify(expected.position.rects)} ${expected.text}`,
          );
          if (!range.rects.length) continue;

          const byRects = zotero.extractRangeByRects({
            chars,
            pageIndex,
            rects: range.rects,
          });
          got.push(
            `${where} ${JSON.stringify(offsetsByRects(chars, range.rects))}`,
          );
          want.push(
            `${where} ${JSON.stringify(byRects && { from: byRects.from, to: byRects.to })}`,
          );
        }
      }

      expect(got.length).toBeGreaterThan(0);
      expect(got).toEqual(want);
    },
    180_000,
  );
});

describe.skipIf(skip)("the vendored port", () => {
  const marker = "// === verbatim upstream copy starts here ===\n";

  async function expectVerbatim(file: string, upstreamPath: string) {
    const vendored = await readFile(
      join(packageRoot, "src/vendor", file),
      "utf8",
    );
    const upstream = await readFile(join(checkout, upstreamPath), "utf8");

    const [header, ...body] = vendored.split(marker);
    expect(
      Object.values(PINNED_COMMITS).filter((commit) =>
        header!.includes(commit),
      ),
    ).toEqual(Object.values(PINNED_COMMITS));
    expect(body.join(marker)).toBe(upstream);
  }

  it("carries native-text-selection-map.js verbatim under its provenance header", () =>
    expectVerbatim(
      "native-text-selection-map.js",
      "reader/src/pdf/native-text-selection-map.mjs",
    ));

  it.each(["structure.js", "page-label.js", "util.js"] as const)(
    "carries %s verbatim under its provenance header",
    (file) =>
      expectVerbatim(file, `reader/pdfjs/pdf.js/src/core/module/${file}`),
  );
});
