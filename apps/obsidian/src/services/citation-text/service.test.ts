// @vitest-environment happy-dom
import type { LinkCache, TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getItemsByKey, resolveIndexedKeyLibrary } from "@zotlit/db";

import type {
  Citation,
  CitationOccurrence,
  DocumentCitationSet,
} from "@/services/citation-index/service";
import type { RenderedCitation } from "@/services/pandoc/engine";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import {
  ALPHA,
  ALPHA_KEY,
  citation,
  firstText,
  literalOccurrences,
  noted,
  occurrenceTexts,
  rendered,
} from "./__fixtures__";
import { citationKey, literalSummaryOf } from "./present";
import type { FormattedOccurrence } from "./present";
import { CitationText } from "./service";

vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return {
    ...actual,
    // The stub client runs no queries; these three are the whole read path from
    // an Indexed Key to the Item the citation names.
    getZoteroIdentity: () => ({
      userID: 1,
      localUserKey: null,
      username: null,
    }),
    resolveIndexedKeyLibrary: vi.fn(),
    getItemsByKey: vi.fn(),
  };
});

const NOTE = { path: "note.md" } as TFile;

/**
 * The Indexed Key a Literature Note stand-in carries. It names an Item of its
 * own, so a wikilink and a literal citekey are told apart by what they reach.
 */
const LIT_KEY = "BETA5678";

interface Harness {
  service: CitationText;
  citationRequests: { citations: readonly string[] }[];
  /** The CSL ids of every bibliography render the read asked for, in order. */
  bibliographyRequests: string[][];
  /** Fires the Citation Index's own event for one document. */
  indexChanged: (path: string) => void;
  /** Fires the render cache's wholesale drop. */
  rendersInvalidated: () => void;
  /** Fires the Note Index's report that a Literature Note moved. */
  resolutionChanged: () => void;
  /** Fires the Citation Index's report that the resolution snapshot rebuilt. */
  citekeyResolutionChanged: () => void;
  /** Fires Obsidian's own metadata event for one file. */
  metadataChanged: (path: string) => void;
  dispose: () => Promise<void>;
}

async function makeHarness({
  body,
  cited = [citation("alpha", ALPHA_KEY)],
  formats = true,
  formatCitations,
  bibliography,
  links = [],
  notes = {},
  settings = {},
  documentCitationSet,
}: {
  body: string;
  cited?: Citation[];
  /** Whether an engine is installed, which is what the cache answers for. */
  formats?: boolean;
  /** A render-cache answer used when a test needs generation control. */
  formatCitations?: (
    citations: readonly string[],
  ) => Promise<readonly RenderedCitation[] | null>;
  /**
   * The works the bibliography renders an entry for, in bibliography order,
   * out of the works it was asked for. Defaults to all of them in that same
   * order; `null` for a render that cannot answer at all.
   */
  bibliography?: (ids: readonly string[]) => readonly string[] | null;
  /** The wikilinks Obsidian's metadata cache reports for the document. */
  links?: LinkCache[];
  /** The Literature Note each linkpath names, by linkpath. */
  notes?: Record<string, { citekey: string | undefined }>;
  settings?: Partial<Settings>;
  documentCitationSet?: DocumentCitationSet;
}): Promise<Harness> {
  const citationRequests: { citations: readonly string[] }[] = [];
  const bibliographyRequests: string[][] = [];
  const listeners = new Map<string, (payload?: never) => void>();
  const listen =
    (event: string) =>
    (name: string, cb: (payload?: never) => void): (() => void) => {
      listeners.set(`${event}:${name}`, cb);
      return () => listeners.delete(`${event}:${name}`);
    };
  const fire = (key: string, payload?: unknown): void => {
    listeners.get(key)?.(payload as never);
  };
  const wikilinkOccurrences: CitationOccurrence[] =
    settings["citation.wikilink-citations"] === true
      ? links.map((entry) => ({
          kind: "wikilink",
          raw: entry.link.split("#", 1)[0]!,
          position: entry.position,
        }))
      : [];
  const set = documentCitationSet ?? {
    occurrences: [...literalOccurrences(body), ...wikilinkOccurrences].sort(
      (a, b) => a.position.start.offset - b.position.start.offset,
    ),
    citations: cited,
    errors: [],
  };

  const service = new CitationText({
    app: {
      vault: { cachedRead: () => Promise.resolve(body) },
      metadataCache: {
        on: (name: string, cb: () => void) => {
          listeners.set(`metadata:${name}`, cb);
          return { e: { offref: () => undefined } };
        },
        // The document reports its own links; a Literature Note reports the
        // frontmatter that makes it one.
        getFileCache: (file: { path: string }) =>
          file.path === NOTE.path
            ? { links }
            : { frontmatter: { "zotero-key": LIT_KEY } },
        getFirstLinkpathDest: (linkpath: string) =>
          Object.hasOwn(notes, linkpath) ? { path: linkpath } : null,
      },
    },
    db: { state: "ready", client: {} },
    citationIndex: {
      getDocumentCitationSet: () => Promise.resolve(set),
      // Every Literature Note stand-in shares one Indexed Key, so one entry
      // answers for however many linkpaths the test names.
      citekeyOf: (indexedKey: string) =>
        indexedKey === LIT_KEY
          ? (Object.values(notes)[0]?.citekey ?? null)
          : null,
      whenResolved: () => Promise.resolve(),
      on: listen("index"),
    },
    noteIndex: {
      on: listen("notes"),
      whenIndexed: () => Promise.resolve(),
    },
    bibliographyRender: {
      vaultPresentation: { styleId: null, locale: null },
      renderCitations: (citations: readonly string[]) => {
        citationRequests.push({ citations });
        if (formatCitations) return formatCitations(citations);
        return Promise.resolve(
          formats ? citations.map((source) => rendered(`«${source}»`)) : null,
        );
      },
      render: (items: readonly { id: string }[]) => {
        const ids = items.map(({ id }) => id);
        bibliographyRequests.push(ids);
        const entries = bibliography ? bibliography(ids) : ids;
        return Promise.resolve(
          entries === null
            ? { kind: "failed" }
            : {
                kind: "rendered",
                entries: entries.map((id) => ({
                  id,
                  marker: undefined,
                  content: [],
                })),
                hasEntryMarkers: false,
              },
        );
      },
      on: listen("render"),
    },
    settings: {
      current: { ...defaults, ...settings },
    },
  } as never);
  await service.ready;

  return {
    service,
    citationRequests,
    bibliographyRequests,
    indexChanged: (path) => fire("index:changed", path),
    rendersInvalidated: () => fire("render:invalidated"),
    resolutionChanged: () => fire("notes:changed"),
    citekeyResolutionChanged: () => fire("index:resolution-changed"),
    metadataChanged: (path) => fire("metadata:changed", { path }),
    dispose: () => service[Symbol.asyncDispose](),
  };
}

beforeEach(() => {
  vi.mocked(resolveIndexedKeyLibrary).mockReturnValue({
    libraryID: 1,
    key: "ALPHA123",
  });
  vi.mocked(getItemsByKey).mockReturnValue([ALPHA as never]);
});

describe("CitationText", () => {
  it("formats every citation the document writes", async () => {
    const { service, citationRequests, dispose } = await makeHarness({
      body: "First @alpha.\n\nThen [see @alpha, p. 3].",
    });

    const { formatted } = await service.load(NOTE);

    expect(citationRequests).toEqual([
      { citations: [`@${ALPHA_KEY}`, `[see @${ALPHA_KEY}, p. 3]`] },
    ]);
    expect(firstText(formatted.get("[see @alpha, p. 3]"))).toBe(
      `«[see @${ALPHA_KEY}, p. 3]»`,
    );
    await dispose();
  });

  it("reads no citation out of a code block", async () => {
    const { service, citationRequests, dispose } = await makeHarness({
      body: "```\n[@alpha]\n```\n\nReal [@alpha] here.",
    });

    await service.load(NOTE);

    expect(citationRequests).toEqual([{ citations: [`[@${ALPHA_KEY}]`] }]);
    await dispose();
  });

  it("reads one document once, however many surfaces ask", async () => {
    const { service, citationRequests, dispose } = await makeHarness({
      body: "One [@alpha].\n\nTwo [@alpha].",
    });

    await service.load(NOTE);
    await service.load(NOTE);

    expect(citationRequests).toHaveLength(1);
    await dispose();
  });

  it("names each cited work by its summary", async () => {
    const { service, dispose } = await makeHarness({
      body: "Blah [@alpha].",
      formats: false,
    });

    const text = await service.load(NOTE);

    expect(literalSummaryOf(text)("alpha")).toBe("Zeta (2020)");
    expect(text.formatted.size).toBe(0);
    await dispose();
  });

  it("keeps a citation whose key reaches no item out of the render", async () => {
    const { service, citationRequests, dispose } = await makeHarness({
      body: "@ghost and [@ghost; @alpha].",
      cited: [citation("ghost", null)],
    });

    await service.load(NOTE);

    expect(citationRequests).toEqual([{ citations: [] }]);
    await dispose();
  });

  it("keeps resolved items from a partial cluster in the document render context", async () => {
    const body = "Partial [@alpha; @ghost], then complete [@alpha].";
    const { service, citationRequests, dispose } = await makeHarness({
      body,
      cited: [citation("alpha"), citation("ghost", null)],
    });

    const { formatted } = await service.load(NOTE);

    expect(citationRequests).toEqual([
      { citations: [`[@${ALPHA_KEY}]`, `[@${ALPHA_KEY}]`] },
    ]);
    expect(formatted.has("[@alpha; @ghost]")).toBe(false);
    expect(firstText(formatted.get("[@alpha]"))).toBe(`«[@${ALPHA_KEY}]»`);
    await dispose();
  });

  it("holds every occurrence of one source at the place the document writes it", async () => {
    const body = "First [@alpha]. Then [@alpha].";
    const { service, dispose } = await makeHarness({
      body,
      // Stands in for a position-dependent style, which renders the second
      // occurrence of a source as the subsequent form.
      formatCitations: (sources) =>
        Promise.resolve(
          sources.map((source, index) =>
            rendered(index === 0 ? `«${source}»` : "ibid."),
          ),
        ),
    });

    const { formatted } = await service.load(NOTE);

    expect(formatted.get("[@alpha]")?.map(({ start }) => start)).toEqual([
      body.indexOf("[@alpha]"),
      body.lastIndexOf("[@alpha]"),
    ]);
    expect(occurrenceTexts(formatted.get("[@alpha]"))).toEqual([
      `«[@${ALPHA_KEY}]»`,
      "ibid.",
    ]);
    await dispose();
  });

  it("withholds a generation whose render result is incomplete", async () => {
    const { service, dispose } = await makeHarness({
      body: "First [@alpha], then [see @alpha, p. 3].",
      formatCitations: async ([first]) => [rendered(`«${first}»`)],
    });

    const { formatted } = await service.load(NOTE);

    expect(formatted.size).toBe(0);
    await dispose();
  });
});

describe("CitationText over wikilink Citations", () => {
  /** The Literature Note the wikilink suites cite, and its citekey. */
  const LIT = "literatures/alpha";
  const notes: Record<string, { citekey: string | undefined }> = {
    [LIT]: { citekey: "alpha" },
  };
  /** Wikilink Citations, which a fragment-less link needs to be a Citation. */
  const WIKILINK_CITATIONS = { "citation.wikilink-citations": true } as const;

  /** One `[[…]]` of the document, as Obsidian's metadata cache reports it. */
  function link(target: string, start: number, original?: string): LinkCache {
    const raw = original ?? `[[${target}]]`;
    return {
      link: target,
      original: raw,
      position: {
        start: { line: 0, col: start, offset: start },
        end: { line: 0, col: start + raw.length, offset: start + raw.length },
      },
    };
  }

  it("renders a fragment-carrying wikilink as the citekey cluster it equals", async () => {
    const body = `Claim [[${LIT}#cite:locator=4]].`;
    const { service, citationRequests, dispose } = await makeHarness({
      body,
      cited: [],
      links: [link(`${LIT}#cite:locator=4`, body.indexOf("[["))],
      notes,
      settings: WIKILINK_CITATIONS,
    });

    const { formatted } = await service.load(NOTE);

    expect(citationRequests).toEqual([{ citations: [`[@${LIT_KEY}, p. 4]`] }]);
    expect(
      firstText(
        formatted.get(
          citationKey({ source: "[@alpha, p. 4]", works: [LIT_KEY] }),
        ),
      ),
    ).toBe(`«[@${LIT_KEY}, p. 4]»`);
    await dispose();
  });

  it("renders a Citation Run as one grouped citation", async () => {
    const body = `Both [[${LIT}#cite:locator=4]]; [[${LIT}]].`;
    const first = body.indexOf("[[");
    const { service, citationRequests, dispose } = await makeHarness({
      body,
      cited: [],
      links: [
        link(`${LIT}#cite:locator=4`, first),
        link(LIT, body.lastIndexOf("[[")),
      ],
      notes,
      settings: WIKILINK_CITATIONS,
    });

    await service.load(NOTE);

    expect(citationRequests).toEqual([
      { citations: [`[@${LIT_KEY}, p. 4; @${LIT_KEY}]`] },
    ]);
    await dispose();
  });

  it("leaves a fragment-less wikilink out while Wikilink Citations is off", async () => {
    const body = `Claim [[${LIT}]].`;
    const { service, citationRequests, dispose } = await makeHarness({
      body,
      cited: [],
      links: [link(LIT, body.indexOf("[["))],
      notes,
      settings: { "citation.wikilink-citations": false },
    });

    await service.load(NOTE);

    expect(citationRequests).toEqual([{ citations: [] }]);
    await dispose();
  });

  it("keeps a fragment-less member in the render context while presentation is off", async () => {
    const body = `Claim [[${LIT}]].`;
    const { service, citationRequests, dispose } = await makeHarness({
      body,
      cited: [],
      links: [link(LIT, body.indexOf("[["))],
      notes,
      settings: {
        "citation.wikilink-citations": true,
        "citation.show-formatted": false,
      },
    });

    await service.load(NOTE);

    expect(citationRequests).toEqual([{ citations: [`[@${LIT_KEY}]`] }]);
    await dispose();
  });

  it("leaves an aliased wikilink out, as the display surfaces do", async () => {
    const body = `Claim [[${LIT}|Alpha]].`;
    const { service, citationRequests, dispose } = await makeHarness({
      body,
      cited: [],
      links: [link(LIT, body.indexOf("[["), `[[${LIT}|Alpha]]`)],
      notes,
    });

    await service.load(NOTE);

    expect(citationRequests).toEqual([{ citations: [] }]);
    await dispose();
  });

  it("renders both syntaxes in one batch, in document order", async () => {
    const body = `Wikilink [[${LIT}#cite:locator=5]] then citekey [@alpha, p. 6].`;
    const { service, citationRequests, dispose } = await makeHarness({
      body,
      links: [link(`${LIT}#cite:locator=5`, body.indexOf("[["))],
      notes,
      settings: WIKILINK_CITATIONS,
    });

    await service.load(NOTE);

    expect(citationRequests).toEqual([
      { citations: [`[@${LIT_KEY}, p. 5]`, `[@${ALPHA_KEY}, p. 6]`] },
    ]);
    await dispose();
  });

  // An Item with no native citation key falls back to its note's filename,
  // and no Pandoc key carries the space in one.
  it("keeps a Citation no Pandoc source can name out of the render", async () => {
    const SPACED = "literatures/Doe 2020";
    const body = `Claim [[${SPACED}]].`;
    const { service, citationRequests, dispose } = await makeHarness({
      body,
      cited: [],
      links: [link(SPACED, body.indexOf("[["))],
      notes: { [SPACED]: { citekey: undefined } },
      settings: WIKILINK_CITATIONS,
    });

    await service.load(NOTE);

    expect(citationRequests).toEqual([{ citations: [] }]);
    await dispose();
  });

  it("summarizes a wikilink-cited work under the Item it names", async () => {
    const body = `Claim [[${LIT}]].`;
    const { service, dispose } = await makeHarness({
      body,
      cited: [],
      links: [link(LIT, body.indexOf("[["))],
      notes,
      settings: WIKILINK_CITATIONS,
      formats: false,
    });

    const { summaries } = await service.load(NOTE);

    expect(summaries.get(LIT_KEY)).toBe("Zeta (2020)");
    await dispose();
  });

  // A wikilink names its own works, so its citekey must not answer for a
  // literal key of the same spelling that reaches no Item at all.
  it("keeps a derived citekey out of the literal join", async () => {
    const body = `Claim [[${LIT}]], and @alpha reaches nothing.`;
    const { service, dispose } = await makeHarness({
      body,
      cited: [citation("alpha", null)],
      links: [link(LIT, body.indexOf("[["))],
      notes,
      settings: WIKILINK_CITATIONS,
      formats: false,
    });

    const text = await service.load(NOTE);

    expect(text.summaries.get(LIT_KEY)).toBe("Zeta (2020)");
    expect(literalSummaryOf(text)("alpha")).toBeUndefined();
    await dispose();
  });
});

describe("CitationText staleness", () => {
  it("does not publish a generation superseded while its render was running", async () => {
    let finishFirst: ((value: readonly RenderedCitation[]) => void) | undefined;
    let generation = 0;
    const { service, citationRequests, indexChanged, dispose } =
      await makeHarness({
        body: "Blah [@alpha].",
        formatCitations: async () => {
          generation += 1;
          if (generation === 1) {
            return new Promise((resolve) => {
              finishFirst = resolve;
            });
          }
          return [rendered("fresh")];
        },
      });

    const superseded = service.load(NOTE);
    await vi.waitFor(() => expect(citationRequests).toHaveLength(1));
    indexChanged(NOTE.path);
    const current = service.load(NOTE);
    await vi.waitFor(() => expect(citationRequests).toHaveLength(2));
    finishFirst?.([rendered("stale")]);

    expect(firstText((await superseded).formatted.get("[@alpha]"))).toBe(
      "fresh",
    );
    expect(firstText((await current).formatted.get("[@alpha]"))).toBe("fresh");
    await dispose();
  });

  it("answers a synchronous caller only once the read settled", async () => {
    const { service, dispose } = await makeHarness({ body: "Blah [@alpha]." });

    const reading = service.load(NOTE);
    expect(service.peek(NOTE.path)).toBeNull();
    await reading;

    expect(service.peek(NOTE.path)?.formatted.get("[@alpha]")).toBeDefined();
    await dispose();
  });

  it("drops a document whose own citations changed, and says so", async () => {
    const { service, indexChanged, dispose } = await makeHarness({
      body: "Blah [@alpha].",
    });
    await service.load(NOTE);
    const changed: string[] = [];
    service.on("changed", (path) => changed.push(path));

    indexChanged(NOTE.path);

    expect(service.peek(NOTE.path)).toBeNull();
    expect(changed).toEqual([NOTE.path]);
    await dispose();
  });

  it("drops every document when the renders go stale, and says so", async () => {
    const { service, rendersInvalidated, dispose } = await makeHarness({
      body: "Blah [@alpha].",
    });
    await service.load(NOTE);
    let invalidated = 0;
    service.on("invalidated", () => (invalidated += 1));

    rendersInvalidated();

    expect(service.peek(NOTE.path)).toBeNull();
    expect(invalidated).toBe(1);
    await dispose();
  });

  // A locator or a prefix belongs to the source a render is keyed by, and
  // editing one moves no citekey occurrence, so the metadata event is what
  // catches it.
  it("drops the one document whose own file changed", async () => {
    const { service, metadataChanged, dispose } = await makeHarness({
      body: "Blah [@alpha].",
    });
    await service.load(NOTE);
    const changed: string[] = [];
    service.on("changed", (path) => changed.push(path));

    metadataChanged(NOTE.path);

    expect(service.peek(NOTE.path)).toBeNull();
    expect(changed).toEqual([NOTE.path]);
    await dispose();
  });

  it("keeps a document held when another file changed", async () => {
    const { service, metadataChanged, dispose } = await makeHarness({
      body: "Blah [@alpha].",
    });
    await service.load(NOTE);
    const events: string[] = [];
    service.on("changed", () => events.push("changed"));
    service.on("invalidated", () => events.push("invalidated"));

    metadataChanged("somewhere/else.md");

    expect(service.peek(NOTE.path)).not.toBeNull();
    expect(events).toEqual([]);
    await dispose();
  });

  // Which Literature Note a wikilink resolves to decides what a citekey here
  // reaches, so a moved mapping makes every document's text stale.
  it("drops every document when a Literature Note moves", async () => {
    const { service, resolutionChanged, dispose } = await makeHarness({
      body: "Blah [@alpha].",
    });
    await service.load(NOTE);
    let invalidated = 0;
    service.on("invalidated", () => (invalidated += 1));

    resolutionChanged();

    expect(service.peek(NOTE.path)).toBeNull();
    expect(invalidated).toBe(1);
    await dispose();
  });

  // The citekey resolution snapshot decides what a literal `@citekey` reaches
  // and whether a wikilink's Item carries a native citation key, so a rebuild
  // makes every document's text stale.
  it("drops every document when the citekey resolution snapshot rebuilds", async () => {
    const { service, citekeyResolutionChanged, dispose } = await makeHarness({
      body: "Blah [@alpha].",
    });
    await service.load(NOTE);
    let invalidated = 0;
    service.on("invalidated", () => (invalidated += 1));

    citekeyResolutionChanged();

    expect(service.peek(NOTE.path)).toBeNull();
    expect(invalidated).toBe(1);
    await dispose();
  });

  it("reads a document again after it was dropped", async () => {
    const { service, citationRequests, indexChanged, dispose } =
      await makeHarness({ body: "Blah [@alpha]." });
    await service.load(NOTE);

    indexChanged(NOTE.path);
    await service.load(NOTE);

    expect(citationRequests).toHaveLength(2);
    expect(service.peek(NOTE.path)).not.toBeNull();
    await dispose();
  });
});

/**
 * The Entry Serial standing for each work of one held Citation's first
 * occurrence.
 */
function firstSerials(
  held: readonly FormattedOccurrence[] = [],
): readonly (number | undefined)[] | undefined {
  return held[0]?.serials;
}

/**
 * Two Items, so a cluster names two works the bibliography numbers apart. Every
 * other suite reads one Item for whatever Indexed Key it asks about.
 */
function readTwoItems(): void {
  vi.mocked(resolveIndexedKeyLibrary).mockImplementation(
    (_client, indexedKey) => ({
      libraryID: 1,
      key: indexedKey === LIT_KEY ? "BETA123" : "ALPHA123",
    }),
  );
  vi.mocked(getItemsByKey).mockImplementation((_client, _libraryID, keys) => [
    { ...ALPHA, key: keys[0] } as never,
  ]);
}

describe("CitationText Entry Serials", () => {
  /** `Both [@alpha; @beta].` under a style whose citations are footnotes. */
  const CLUSTER = "[@alpha; @beta]";
  const TWO_WORKS = [citation("alpha", ALPHA_KEY), citation("beta", LIT_KEY)];

  beforeEach(() => {
    readTwoItems();
  });

  it("stands one serial per cited work in for the note a style writes", async () => {
    const { service, bibliographyRequests, dispose } = await makeHarness({
      body: `Both ${CLUSTER}.`,
      cited: TWO_WORKS,
      formatCitations: (sources) => Promise.resolve(sources.map(noted)),
    });

    const { formatted, entrySerials } = await service.load(NOTE);

    expect(entrySerials).toBe(true);
    expect(firstSerials(formatted.get(CLUSTER))).toEqual([1, 2]);
    // The bibliography is read for the works the document cites, in the order
    // the References Sidebar lists them.
    expect(bibliographyRequests).toHaveLength(1);
    await dispose();
  });

  // Author-in-text and author-suppressed members are the same works in the
  // same order, so the digits they show are the same digits.
  it("numbers the works of a citation however it names them", async () => {
    const { service, dispose } = await makeHarness({
      body: `Both ${CLUSTER}.`,
      cited: TWO_WORKS,
      formatCitations: () =>
        Promise.resolve([
          {
            ...noted(`[@${ALPHA_KEY}; @${LIT_KEY}]`),
            citations: [
              { id: ALPHA_KEY, mode: "author-in-text" as const },
              { id: LIT_KEY, mode: "suppress-author" as const },
            ],
          },
        ]),
    });

    const { formatted } = await service.load(NOTE);

    expect(firstSerials(formatted.get(CLUSTER))).toEqual([1, 2]);
    await dispose();
  });

  it("leaves the slot of a work the bibliography left out empty", async () => {
    const { service, dispose } = await makeHarness({
      body: `Both ${CLUSTER}.`,
      cited: TWO_WORKS,
      formatCitations: (sources) => Promise.resolve(sources.map(noted)),
      // The render answers with the second work alone, which leaves the first
      // one no row to point at.
      bibliography: (ids) => ids.slice(1),
    });

    const { formatted } = await service.load(NOTE);

    expect(firstSerials(formatted.get(CLUSTER))).toEqual([undefined, 1]);
    await dispose();
  });

  it("leaves every slot empty when no bibliography can be rendered", async () => {
    const { service, dispose } = await makeHarness({
      body: `Both ${CLUSTER}.`,
      cited: TWO_WORKS,
      formatCitations: (sources) => Promise.resolve(sources.map(noted)),
      bibliography: () => null,
    });

    const { formatted, entrySerials } = await service.load(NOTE);

    expect(entrySerials).toBe(true);
    expect(firstSerials(formatted.get(CLUSTER))).toEqual([
      undefined,
      undefined,
    ]);
    await dispose();
  });

  // An in-text style writes no note, so nothing stands in for one and the
  // document pays for no bibliography of its own.
  it("keeps an in-text style's document off serials", async () => {
    const { service, bibliographyRequests, dispose } = await makeHarness({
      body: `Both ${CLUSTER}.`,
      cited: TWO_WORKS,
    });

    const { formatted, entrySerials } = await service.load(NOTE);

    expect(entrySerials).toBe(false);
    expect(firstSerials(formatted.get(CLUSTER))).toEqual([]);
    expect(bibliographyRequests).toEqual([]);
    await dispose();
  });
});
