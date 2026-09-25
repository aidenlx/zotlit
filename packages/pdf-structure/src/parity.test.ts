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

import type {
  ObsidianTextItem,
  Rect,
  StructuredPage,
  ZoteroChar,
} from "@/chars";
import { structurePage, toZoteroChars } from "@/chars";
import { PdfTextStructure } from "@/session";
import type { PdfPosition } from "@/sort-index";
import { computeSortIndex } from "@/sort-index";
import type { RangeEnd, RangeStep } from "@/text-selection";
import { adjustRange, offsetsByRects, textRange } from "@/text-selection";

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

/** The Fixture PDFs that carry a text layer. */
const withTextLayer = () =>
  PDFS.filter(
    (asset) =>
      !PARITY_PDFS.some(
        (pdf) => pdf.asset === asset && pdf.branches.includes("no-text-layer"),
      ),
  );

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
  getSelectionRangesByPosition(
    pdfPages: Record<number, StructuredPage>,
    position: PdfPosition,
  ): ZoteroRange[];
  getReversedSelectionRanges(ranges: ZoteroRange[]): ZoteroRange[];
  getModifiedSelectionRanges(
    pdfPages: Record<number, StructuredPage>,
    ranges: ZoteroRange[],
    head: { pageIndex: number; rects: Rect[] } | RangeStep,
  ): ZoteroRange[];
}

/** One page's part of a selection, as Zotero's reader holds it. */
interface ZoteroRange {
  anchorOffset: number;
  headOffset: number;
  anchor?: boolean;
  head?: boolean;
  collapsed?: boolean;
  position: { pageIndex: number; rects: Rect[] };
  text: string;
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

  it.each(withTextLayer())(
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

/**
 * A highlight's end dragged to a point, against the reader's own pointer path:
 * the ranges read off the stored rects, turned round for the start, and moved
 * to a point, then kept to two pages with their text joined by one space. The
 * drags where the port keeps the stored shape instead — past the anchor, or
 * off the Annotation's page — are compared as `null`s the port answers
 * elsewhere, so only the drags both sides place are compared.
 */
describe.skipIf(skip)("dragged range ends", () => {
  it.each(withTextLayer())(
    "match Zotero's pointer path on %s",
    async (asset) => {
      const zotero = (await import(
        /* @vite-ignore */ join(checkout, "reader/src/pdf/selection.js")
      )) as ZoteroSelection;
      const oracle = await askZotero(asset);
      const pages = oracle.pages.map((page, pageIndex) =>
        structurePage(pageIndex, page.viewBox, asObsidianItems(page.items)),
      );
      const byIndex = new Map(pages.map((page) => [page.pageIndex, page]));
      const round = (rects: readonly Rect[]) =>
        JSON.stringify(rects.map((rect) => rect.map((v) => +v.toFixed(3))));
      const got: string[] = [];
      const want: string[] = [];

      for (const { pageIndex, chars } of pages) {
        if (chars.length < 2) continue;
        const next = byIndex.get(pageIndex + 1)?.chars ?? [];
        for (let i = 0; i < 12; i++) {
          const from = (i * 53) % (chars.length - 1);
          const to = Math.min(chars.length, from + 1 + ((i * 29) % 60));
          const position = {
            pageIndex,
            rects: textRange(chars, from, to).rects,
          };
          const targets = [
            ...[3, 17, 41].map((step) => ({
              pageIndex,
              char: chars[(from + i * step) % chars.length]!,
            })),
            ...(next.length
              ? [{ pageIndex: pageIndex + 1, char: next[i % next.length]! }]
              : []),
          ];
          for (const { pageIndex: on, char } of targets) {
            for (const [dx, dy] of [
              [0.2, 0.5],
              [0.8, 0.5],
              [1.4, -0.3],
            ] as const) {
              const [x1, y1, x2, y2] = char.rect;
              const x = x1 + (x2 - x1) * dx;
              const y = y1 + (y2 - y1) * dy;
              for (const end of ["start", "end"] as RangeEnd[]) {
                const expected = zoteroDrag(zotero, {
                  pages: Object.fromEntries(
                    [pageIndex, pageIndex + 1].flatMap((index) => {
                      const page = byIndex.get(index);
                      return page ? [[index, page]] : [];
                    }),
                  ),
                  position,
                  end,
                  head: { pageIndex: on, rects: [[x, y, x, y]] },
                });
                if (!expected) continue;
                const where = `${asset} page ${pageIndex} ${from}-${to} ${end} to ${on} ${x},${y}`;
                const adjusted = adjustRange(
                  { position, end, point: { pageIndex: on, x, y } },
                  byIndex,
                );
                // A drag back onto the stored characters keeps the stored
                // rects by design, so only its text is compared.
                const kept =
                  adjusted !== null &&
                  round(adjusted.rects) === round(position.rects);
                const shape = (rects: readonly Rect[], next: readonly Rect[]) =>
                  kept ? "" : `${round(rects)} ${round(next)} `;
                got.push(
                  `${where} ${adjusted && `${shape(adjusted.rects, adjusted.nextPageRects ?? [])}${adjusted.text}`}`,
                );
                want.push(
                  `${where} ${shape(expected.rects, expected.nextPageRects)}${expected.text}`,
                );
              }
            }
          }
        }
      }

      expect(got.length).toBeGreaterThan(0);
      expect(got).toEqual(want);
    },
    180_000,
  );
});

/**
 * A highlight's end stepped from the keyboard, against the reader's own key
 * path: the ranges read off the stored rects, turned round for the start, and
 * moved one character or one line. A step Zotero refuses — one that would
 * collapse or turn the range round — or one that carries the range off the
 * Annotation's page, the port answers `null`; these, and a step that leaves
 * the range as it was, are all compared as "unchanged".
 */
describe.skipIf(skip)("stepped range ends", () => {
  it.each(withTextLayer())(
    "match Zotero's key path on %s",
    async (asset) => {
      const zotero = (await import(
        /* @vite-ignore */ join(checkout, "reader/src/pdf/selection.js")
      )) as ZoteroSelection;
      const oracle = await askZotero(asset);
      const pages = oracle.pages.map((page, pageIndex) =>
        structurePage(pageIndex, page.viewBox, asObsidianItems(page.items)),
      );
      const byIndex = new Map(pages.map((page) => [page.pageIndex, page]));
      const round = (rects: readonly Rect[]) =>
        JSON.stringify(rects.map((rect) => rect.map((v) => +v.toFixed(3))));
      const got: string[] = [];
      const want: string[] = [];

      for (const { pageIndex, chars } of pages) {
        if (chars.length < 2) continue;
        // A range at each end of the page as well as inside it, so a step
        // crosses onto the next page and off the first.
        const spans = [
          [0, Math.min(chars.length, 7)],
          [Math.max(0, chars.length - 5), chars.length],
          ...Array.from({ length: 16 }, (_, i) => {
            const from = (i * 53) % (chars.length - 1);
            return [from, Math.min(chars.length, from + 1 + ((i * 29) % 60))];
          }),
        ];
        for (const [from, to] of spans) {
          const position = {
            pageIndex,
            rects: textRange(chars, from!, to!).rects,
          };
          for (const end of ["start", "end"] as RangeEnd[]) {
            for (const step of ["left", "right", "up", "down"] as const) {
              // The page before is there so a step off the first page is seen
              // to leave it.
              const expected = zoteroDrag(zotero, {
                pages: Object.fromEntries(
                  [pageIndex - 1, pageIndex, pageIndex + 1].flatMap((index) => {
                    const page = byIndex.get(index);
                    return page ? [[index, page]] : [];
                  }),
                ),
                position,
                end,
                head: step,
              });
              const adjusted = adjustRange({ position, end, step }, byIndex);
              // Zotero reads the range off the rects again, which on
              // overlapping glyphs can take a character the stored rects
              // were not built from; its own step that goes nowhere answers
              // that read.
              const [reread] = zotero.getSelectionRangesByPosition(
                Object.fromEntries([[pageIndex, byIndex.get(pageIndex)!]]),
                position,
              );
              // A step that moves nothing writes nothing, whether it answers
              // the range unchanged, as Zotero does where no page lies
              // before, or `null`.
              const said = (
                answer: {
                  rects: readonly Rect[];
                  nextPageRects?: readonly Rect[];
                  text: string;
                } | null,
              ) =>
                answer === null ||
                (!answer.nextPageRects?.length &&
                  (round(answer.rects) === round(position.rects) ||
                    round(answer.rects) ===
                      round(reread?.position.rects ?? [])))
                  ? "unchanged"
                  : `${round(answer.rects)} ${round(answer.nextPageRects ?? [])} ${answer.text}`;
              const where = `${asset} page ${pageIndex} ${from}-${to} ${end} ${step}`;
              got.push(`${where} ${said(adjusted)}`);
              want.push(`${where} ${said(expected)}`);
            }
          }
        }
      }

      expect(got.length).toBeGreaterThan(0);
      expect(got).toEqual(want);
    },
    180_000,
  );
});

/**
 * Zotero's reader dragging one end of a stored highlight to a point, or
 * stepping it from the keyboard; `null` for a move the port answers
 * differently by design: one that turns the range round, collapses it, or
 * leaves the Annotation's page.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/pdf-view.js — `_handlePointerMove`, `updateAnnotationRange`; `_getAnnotationFromSelectionRanges`
 */
function zoteroDrag(
  zotero: ZoteroSelection,
  {
    pages,
    position,
    end,
    head,
  }: {
    pages: Record<number, StructuredPage>;
    position: { pageIndex: number; rects: Rect[] };
    end: RangeEnd;
    head: { pageIndex: number; rects: Rect[] } | RangeStep;
  },
): { rects: Rect[]; nextPageRects: Rect[]; text: string } | null {
  let ranges = zotero.getSelectionRangesByPosition(pages, position);
  if (!ranges.length) return null;
  if (end === "start") ranges = zotero.getReversedSelectionRanges(ranges);
  const moved = zotero
    .getModifiedSelectionRanges(pages, ranges, head)
    .filter((range) => range.position.rects.length > 0)
    .toSorted((a, b) => a.position.pageIndex - b.position.pageIndex);
  const [first, second] = moved;
  if (
    !first ||
    first.collapsed ||
    first.position.pageIndex !== position.pageIndex
  )
    return null;
  // A range turned round runs its head before its anchor on the anchor's page.
  const anchorRange = moved.find((range) => range.anchor);
  const headRange = moved.find((range) => range.head);
  if (
    anchorRange &&
    headRange &&
    (anchorRange.position.pageIndex === headRange.position.pageIndex
      ? end === "end"
        ? headRange.headOffset <= anchorRange.anchorOffset
        : headRange.headOffset >= anchorRange.anchorOffset
      : end === "end"
        ? headRange.position.pageIndex < anchorRange.position.pageIndex
        : headRange.position.pageIndex > anchorRange.position.pageIndex)
  )
    return null;
  return {
    rects: first.position.rects,
    nextPageRects: second?.position.rects ?? [],
    text: second ? `${first.text} ${second.text}` : first.text,
  };
}

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
