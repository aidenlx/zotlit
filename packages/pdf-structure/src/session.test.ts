import type { LogRecord } from "@logtape/logtape";
import { configure, reset } from "@logtape/logtape";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ObsidianTextItem } from "@/chars";
import type { PdfPageSource } from "@/session";
import { createStructuredPageCache, PdfTextStructure } from "@/session";
import type { PdfPosition } from "@/sort-index";

let records: LogRecord[] = [];

beforeAll(async () => {
  await configure({
    sinks: { memory: (record: LogRecord) => void records.push(record) },
    loggers: [
      { category: ["zotlit"], lowestLevel: "debug", sinks: ["memory"] },
      { category: ["logtape", "meta"], lowestLevel: "error", sinks: [] },
    ],
  });
});

afterAll(() => reset());

beforeEach(() => {
  records = [];
});

/** One 10 pt glyph per page, at a page-dependent height. */
const glyphs = (pageIndex: number): ObsidianTextItem[] => [
  {
    transform: [10, 0, 0, 10, 72, 700 - pageIndex * 10],
    fontName: "ABCDEF+Times",
    chars: [
      {
        c: "7",
        u: "7",
        r: [72, 695 - pageIndex * 10, 78, 707 - pageIndex * 10],
      },
    ],
  },
];

function stubSource(overrides: Partial<PdfPageSource> = {}) {
  const textCalls: number[] = [];
  const source: PdfPageSource = {
    numPages: 3,
    getViewBox: () => Promise.resolve([0, 0, 612, 792]),
    getTextItems: (pageIndex) => {
      textCalls.push(pageIndex);
      return Promise.resolve(glyphs(pageIndex));
    },
    getCatalogPageLabels: () => Promise.resolve(null),
    ...overrides,
  };
  return { source, textCalls };
}

describe("a Reader Session's Structured Characters", () => {
  it("extract a page once and keep it for the rest of the session", async () => {
    const { source, textCalls } = stubSource();
    const structure = new PdfTextStructure(source);

    const [first, second] = await Promise.all([
      structure.page(1),
      structure.page(1),
    ]);
    await structure.page(1);

    expect(textCalls).toEqual([1]);
    expect(first).toBe(second);
    expect(first!.chars.map(({ c }) => c)).toEqual(["7"]);
  });

  it("memoize into the cache the host hands over", async () => {
    const cache = createStructuredPageCache();
    const { source, textCalls } = stubSource();

    await new PdfTextStructure(source, cache).page(2);
    await new PdfTextStructure(source, cache).page(2);

    expect(textCalls).toEqual([2]);
  });
});

describe("a Reader Session's Page Labels", () => {
  it("run one pass however many callers await it", async () => {
    let passes = 0;
    const { source } = stubSource({
      getCatalogPageLabels: () => {
        passes++;
        return Promise.resolve(["A", "B", "C"]);
      },
    });
    const structure = new PdfTextStructure(source);

    void structure.pageLabels();
    const [labels, again] = await Promise.all([
      structure.pageLabels(),
      structure.pageLabels(),
    ]);

    expect(passes).toBe(1);
    expect(labels).toEqual(["A", "B", "C"]);
    expect(again).toEqual(["A", "B", "C"]);
  });

  it("align a creation to the previous Annotation", async () => {
    const { source } = stubSource({
      getCatalogPageLabels: () => Promise.resolve(["A", "5", "6"]),
    });
    const structure = new PdfTextStructure(source);

    expect(
      await structure.pageLabel(2, [{ pageLabel: "205", pageIndex: 1 }]),
    ).toBe("206");
  });
});

describe("a Sort Index on a page with no text layer", () => {
  it("keeps offset zero, reports the geometry, and says so once at debug", async () => {
    const { source } = stubSource({
      getTextItems: () => Promise.resolve([]),
    });
    const structure = new PdfTextStructure(source);
    const position: PdfPosition = {
      pageIndex: 1,
      rects: [[58, 598, 300, 614]],
    };

    expect(await structure.sortIndex(position)).toBe("00001|000000|00178");
    expect(await structure.sortIndex(position)).toBe("00001|000000|00178");
    expect((await structure.page(1)).chars).toEqual([]);

    const debug = records.filter(({ level }) => level === "debug");
    expect(debug).toHaveLength(1);
    expect(debug[0]).toMatchObject({
      category: ["zotlit", "pdf-structure"],
      properties: { pageIndex: 1 },
    });
  });
});
