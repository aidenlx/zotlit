// @vitest-environment happy-dom
import { type TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getItemsByKey, resolveIndexedKeyLibrary } from "@zotlit/db";

import { type Citation } from "@/services/citation-index/service";

import { ALPHA, ALPHA_KEY, citation, fragment } from "./__fixtures__";
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

interface Harness {
  service: CitationText;
  citationRequests: { citations: readonly string[] }[];
  /** Fires the Citation Index's own event for one document. */
  indexChanged: (path: string) => void;
  /** Fires the render cache's wholesale drop. */
  rendersInvalidated: () => void;
  /** Fires the Note Index's report that a citekey's resolution moved. */
  resolutionChanged: () => void;
  /** Fires Obsidian's own metadata event for one file. */
  metadataChanged: (path: string) => void;
  dispose: () => Promise<void>;
}

async function makeHarness({
  body,
  cited = [citation("alpha", ALPHA_KEY)],
  formats = true,
}: {
  body: string;
  cited?: Citation[];
  /** Whether an engine is installed, which is what the cache answers for. */
  formats?: boolean;
}): Promise<Harness> {
  const citationRequests: { citations: readonly string[] }[] = [];
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

  const service = new CitationText({
    app: {
      vault: { cachedRead: () => Promise.resolve(body) },
      metadataCache: {
        on: (name: string, cb: () => void) => {
          listeners.set(`metadata:${name}`, cb);
          return { e: { offref: () => undefined } };
        },
      },
    },
    db: { state: "ready", client: {} },
    citationIndex: {
      getCitations: () => Promise.resolve(cited),
      on: listen("index"),
    },
    noteIndex: {
      on: listen("notes"),
      whenIndexed: () => Promise.resolve(),
    },
    bibliographyRender: {
      renderCitations: (citations: readonly string[]) => {
        citationRequests.push({ citations });
        return Promise.resolve(
          formats ? citations.map((source) => fragment(`«${source}»`)) : null,
        );
      },
      on: listen("render"),
    },
  } as never);
  await service.ready;

  return {
    service,
    citationRequests,
    indexChanged: (path) => fire("index:changed", path),
    rendersInvalidated: () => fire("render:invalidated"),
    resolutionChanged: () => fire("notes:changed"),
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
      { citations: ["@alpha", "[see @alpha, p. 3]"] },
    ]);
    expect(formatted.get("[see @alpha, p. 3]")?.textContent).toBe(
      "«[see @alpha, p. 3]»",
    );
    await dispose();
  });

  it("reads no citation out of a code block", async () => {
    const { service, citationRequests, dispose } = await makeHarness({
      body: "```\n[@alpha]\n```\n\nReal [@alpha] here.",
    });

    await service.load(NOTE);

    expect(citationRequests).toEqual([{ citations: ["[@alpha]"] }]);
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

    const { formatted, summaries } = await service.load(NOTE);

    expect(summaries.get("alpha")).toBe("Zeta (2020)");
    expect(formatted.size).toBe(0);
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
});

describe("CitationText staleness", () => {
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

  // The Citation Key Property of any Literature Note decides what a citekey
  // here reaches, so a moved mapping makes every document's text stale.
  it("drops every document when a citekey's resolution moved", async () => {
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
