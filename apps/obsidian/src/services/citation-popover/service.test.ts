// @vitest-environment happy-dom
import type { TFile } from "obsidian";
import { act } from "preact/test-utils";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import * as m from "@/lib/i18n/generated/messages";
import type { CitekeyResolution } from "@/services/citation-index/service";
import type { DocumentCitations } from "@/services/citation-text/service";
import type { BibliographyRenderResult } from "@/services/pandoc/render-cache";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";
import {
  CLEAR_WORKS_SQL,
  inProcessReadsService,
  seedWorksSql,
  sharedClientOpener,
  worksSql,
} from "@/services/zotero-reads/test-utils";
import type { SeededWork } from "@/services/zotero-reads/test-utils";

import type { CitationPopoverContentProps } from "./content";
import { CitationPopover } from "./service";
import type { WorkHoverRequest } from "./service";

const popovers = vi.hoisted(
  () =>
    [] as {
      render: ReturnType<typeof vi.fn>;
      hide: ReturnType<typeof vi.fn>;
    }[],
);

vi.mock("./popover", () => ({
  CitationHoverPopover: class {
    readonly render = vi.fn(() => true);
    readonly #cleanup: (() => void)[] = [];
    readonly hide = vi.fn(() => {
      for (const cleanup of this.#cleanup.splice(0).reverse()) cleanup();
    });

    constructor() {
      popovers.push(this);
    }

    register(cleanup: () => void): void {
      this.#cleanup.push(cleanup);
    }
  },
}));

/** Every reads stand-in a test opened, disposed after it. */
const opened: AsyncDisposable[] = [];
afterEach(async () => {
  for (const reads of opened.splice(0)) await reads[Symbol.asyncDispose]();
});

/**
 * ZoteroReads on the in-process adapter over a `:memory:` database holding
 * `works`. The test sets `state`; `holds` replaces the works the database
 * holds, and `lock`/`unlock` make the item table unreadable and readable.
 */
function reads(works: readonly SeededWork[] = []) {
  const client = createClient(":memory:");
  createFixtureSchema(client.$client);
  client.$client.exec(seedWorksSql(works));
  const service = inProcessReadsService(sharedClientOpener(client));
  const stub = {
    state: "ready" as ZoteroReadsService["state"],
    get ready() {
      return service.ready;
    },
    acquireRead: () => service.acquireRead(),
    holds(next: readonly SeededWork[]) {
      client.$client.exec(`${CLEAR_WORKS_SQL}\n${worksSql(next)}`);
    },
    lock() {
      client.$client.exec("alter table items rename to lockedItems");
    },
    unlock() {
      client.$client.exec("alter table lockedItems rename to items");
    },
    async [Symbol.asyncDispose]() {
      await service[Symbol.asyncDispose]();
      client.$client.close();
    },
  };
  opened.push(stub);
  return stub;
}

const NOTE = { path: "note.md" } as TFile;

const emptyText = (): DocumentCitations => ({
  formatted: new Map(),
  entrySerials: false,
  summaries: new Map(),
  literalWorks: new Map(),
});

function harness(read: () => Promise<DocumentCitations | null>) {
  let file: TFile | null = NOTE;
  const deleted = new Set<(file: TFile) => void>();
  const citationText = { read: vi.fn(read) };
  const service = new CitationPopover({
    app: {
      vault: {
        getFileByPath: () => file,
      },
      metadataCache: {
        getFileCache: () => null,
        on: (event: string, cb: (file: TFile) => void) => {
          if (event === "deleted") deleted.add(cb);
          return { e: { offref: () => deleted.delete(cb) } };
        },
      },
    },
    db: reads(),
    citationIndex: {
      getDocumentCitationSet: () =>
        Promise.resolve({ occurrences: [], citations: [], errors: [] }),
      resolveCitekey: () => ({ kind: "missing" }),
      resolution: "fresh",
    },
    libraryScope: { current: [] },
    citationText,
    profile: profileReader(),
    bibliographyRender: {
      vaultPresentation: { styleId: null, locale: null },
      on: () => () => undefined,
      render: () =>
        Promise.resolve({
          kind: "held" as const,
          key: "empty",
          record: {
            value: { entries: [], hasEntryMarkers: false },
            status: "fresh" as const,
            settled: Promise.resolve({ entries: [], hasEntryMarkers: false }),
          },
        }),
    },
  } as never);
  const show = () =>
    service.show({
      event: new MouseEvent("mouseover"),
      hoverParent: { hoverPopover: null },
      sourcePath: NOTE.path,
      targetEl: document.createElement("span"),
      works: [{ citekey: "ghost" }],
      shown: {
        citation: {
          source: "[@ghost]",
          keys: [{ citekey: "ghost", start: 1, end: 7 }],
        },
        at: { kind: "offset", start: 0 },
      },
      open: vi.fn(),
    });
  return {
    citationText,
    removeSource() {
      file = null;
      for (const cb of deleted) cb(NOTE);
    },
    show,
    [Symbol.asyncDispose]: () => service[Symbol.asyncDispose](),
  };
}

beforeEach(() => {
  popovers.length = 0;
});

describe("Citation Popover citation text", () => {
  it("settles a hover the citation-text read answered nothing for", async () => {
    await using run = harness(() => Promise.resolve(null));

    run.show();

    await vi.waitFor(() => expect(popovers[0]!.render).toHaveBeenCalledOnce());
    expect(run.citationText.read).toHaveBeenCalledOnce();
    const content = popovers[0]!.render.mock
      .calls[0]![0] as ReactElement<CitationPopoverContentProps>;
    expect(content.props.note).toBeUndefined();
  });

  it("draws the text the read settled on rather than what stood at the hover", async () => {
    const settled = Promise.withResolvers<DocumentCitations | null>();
    await using run = harness(() => settled.promise);
    run.show();
    await vi.waitFor(() =>
      expect(run.citationText.read).toHaveBeenCalledOnce(),
    );
    expect(popovers[0]!.render).not.toHaveBeenCalled();

    settled.resolve(noteText("settled note"));

    await vi.waitFor(() => expect(popovers[0]!.render).toHaveBeenCalledOnce());
    const content = popovers[0]!.render.mock
      .calls[0]![0] as ReactElement<CitationPopoverContentProps>;
    expect(content.props.note).toEqual([{ t: "Str", c: "settled note" }]);
  });
});

/** One document's citation text, whose hovered occurrence carries a note. */
function noteText(note: string): DocumentCitations {
  return {
    ...emptyText(),
    formatted: new Map([
      [
        "[@ghost]",
        [
          {
            start: 0,
            text: {
              content: [
                { t: "Note", c: [{ t: "Para", c: [{ t: "Str", c: note }] }] },
              ],
              citations: [{ id: "ghost", mode: "normal" }],
            },
            serials: [],
          },
        ],
      ],
    ]),
  };
}

describe("source-less Citation Popover", () => {
  it("shows an uncited Item without a citation key under the vault presentation", async () => {
    const readBibliography = vi.fn(async () => ({
      entries: [
        {
          id: "ABCD2345",
          marker: [{ t: "Str", c: "[1]" }],
          content: [{ t: "Str", c: "Formatted alpha" }],
        },
      ],
      hasEntryMarkers: true,
    }));
    await using service = new CitationPopover({
      app: {},
      db: reads([{ itemID: 1, key: "ABCD2345", title: "Alpha kernels" }]),
      citationIndex: { resolution: null },
      libraryScope: { current: [] },
      profile: profileReader(),
      bibliographyRender: { readBibliography, on: () => () => undefined },
    } as never);

    service.showWork({
      event: new MouseEvent("mouseover"),
      hoverParent: { hoverPopover: null },
      targetEl: document.createElement("span"),
      work: { kind: "item", indexedKey: "ABCD2345" },
      open: vi.fn(),
    });

    await vi.waitFor(() => expect(popovers[0]!.render).toHaveBeenCalled());
    const content = popovers[0]!.render.mock.calls.at(
      -1,
    )![0] as ReactElement<CitationPopoverContentProps>;
    expect(content.props.blocks).toMatchObject([
      {
        kind: "entry",
        citekey: null,
        itemKey: "ABCD2345",
        content: [{ t: "Str", c: "Formatted alpha" }],
        marker: undefined,
        serial: undefined,
      },
    ]);
    expect(content.props.note).toBeUndefined();
    expect(readBibliography.mock.calls[0]).toEqual([
      [expect.objectContaining({ title: "Alpha kernels" })],
      { signal: expect.any(AbortSignal) },
    ]);
  });
});

function workHarness() {
  const listeners = new Map<string, Set<() => void>>();
  const on = (event: string, listener: () => void) => {
    const group = listeners.get(event) ?? new Set<() => void>();
    group.add(listener);
    listeners.set(event, group);
    return () => {
      group.delete(listener);
    };
  };
  const db = reads();
  const citationIndex = {
    resolution: {} as object | null,
    resolveCitekey: vi.fn<() => CitekeyResolution | null>(() => ({
      kind: "missing",
    })),
    on,
  };
  const readBibliography = vi.fn<
    () => Promise<BibliographyRenderResult | null>
  >(async () => null);
  const open = vi.fn();
  const service = new CitationPopover({
    app: {},
    db,
    citationIndex,
    libraryScope: { current: [] },
    profile: profileReader(),
    bibliographyRender: { readBibliography, on },
  } as never);
  const element = document.createElement("div");
  const root = createRoot(element);
  return {
    db,
    citationIndex,
    readBibliography,
    open,
    emit(event: string) {
      for (const listener of listeners.get(event) ?? []) listener();
    },
    show(
      work: WorkHoverRequest["work"] = { kind: "item", indexedKey: "ABCD2345" },
    ) {
      service.showWork({
        event: new MouseEvent("mouseover"),
        hoverParent: { hoverPopover: null },
        targetEl: element,
        work,
        open,
      });
    },
    async shown() {
      await vi.waitFor(() =>
        expect(popovers.at(-1)!.render).toHaveBeenCalled(),
      );
      const content = popovers
        .at(-1)!
        .render.mock.calls.at(
          -1,
        )![0] as ReactElement<CitationPopoverContentProps>;
      await act(() => root.render(content));
      return element;
    },
    async [Symbol.asyncDispose]() {
      await service[Symbol.asyncDispose]();
      root.unmount();
    },
  };
}

describe("source-less lookup states", () => {
  it("distinguishes an unavailable database from an absent exact Item", async () => {
    await using run = workHarness();
    run.db.state = "degraded";
    run.show();
    const element = await run.shown();
    expect(element.textContent).toBe(m.citation_popover_database_unavailable());
    expect(element.querySelector("[data-citation-popover-actions]")).toBeNull();

    run.db.state = "ready";
    run.emit("invalidated");
    await vi.waitFor(async () => {
      expect((await run.shown()).textContent).toBe(
        m.citation_popover_item_unavailable(),
      );
    });
    expect(popovers.at(-1)!.hide).not.toHaveBeenCalled();
  });
});

describe("source-less Citation Key refresh", () => {
  it("refreshes pending, missing, unique, and ambiguous results while open", async () => {
    await using run = workHarness();
    run.citationIndex.resolveCitekey.mockReturnValue(null);
    run.show({ kind: "citekey", citekey: "doe2024" });
    expect((await run.shown()).textContent).toBe(
      m.references_citekey_pending({ citekey: "doe2024" }),
    );

    run.citationIndex.resolveCitekey.mockReturnValue({ kind: "missing" });
    run.emit("resolution-changed");
    await vi.waitFor(async () =>
      expect((await run.shown()).textContent).toBe(
        m.references_citekey_unresolved({ citekey: "doe2024" }),
      ),
    );

    run.db.holds([
      {
        itemID: 1,
        key: "ABCD2345",
        title: "Alpha kernels",
        citationKey: "doe2024",
      },
    ]);
    const item = {
      itemID: 1,
      libraryID: 1,
      key: "ABCD2345",
      indexedKey: "ABCD2345",
    };
    run.citationIndex.resolveCitekey.mockReturnValue({ kind: "unique", item });
    run.emit("resolution-changed");
    await vi.waitFor(async () =>
      expect((await run.shown()).textContent).toContain("Alpha kernels"),
    );
    expect(
      (await run.shown()).querySelector("[data-citation-popover-actions]"),
    ).not.toBeNull();

    run.citationIndex.resolveCitekey.mockReturnValue({
      kind: "ambiguous",
      candidates: [
        item,
        { ...item, key: "EFGH6789", indexedKey: "EFGH6789", itemID: 2 },
      ],
    });
    run.emit("resolution-changed");
    await vi.waitFor(async () =>
      expect((await run.shown()).textContent).toContain(
        m.references_citekey_ambiguous({ citekey: "doe2024" }),
      ),
    );
    expect(
      (await run.shown()).querySelector("[data-citation-popover-actions]"),
    ).toBeNull();
  });
});

describe("source-less Item actions", () => {
  it("keeps the displayed Item identity and reports deletion before an action", async () => {
    await using run = workHarness();
    run.db.holds([
      {
        itemID: 1,
        key: "ABCD2345",
        title: "Alpha kernels",
        citationKey: "shared2024",
      },
    ]);
    run.show();
    const element = await run.shown();
    element
      .querySelector<HTMLButtonElement>(
        `[aria-label="${m.references_open_note()}"]`,
      )!
      .click();
    // The action reads the Item again first, so it lands once that read does.
    await vi.waitFor(() =>
      expect(run.open).toHaveBeenCalledExactlyOnceWith("ABCD2345", false),
    );

    // The open hid that card; the next hover shows the Item again.
    run.open.mockClear();
    run.show();
    const again = await run.shown();
    popovers.at(-1)!.hide.mockClear();
    run.db.holds([]);
    again
      .querySelector<HTMLButtonElement>(
        `[aria-label="${m.references_open_note()}"]`,
      )!
      .click();
    await vi.waitFor(async () => {
      expect((await run.shown()).textContent).toBe(
        m.citation_popover_item_unavailable(),
      );
    });
    expect(run.open).not.toHaveBeenCalled();
    expect(popovers.at(-1)!.hide).not.toHaveBeenCalled();
  });
});

describe("popover failure and lifetime", () => {
  it("keeps a readable Item when the formatting request throws", async () => {
    await using run = workHarness();
    run.db.holds([{ itemID: 1, key: "ABCD2345", title: "Alpha kernels" }]);
    run.readBibliography.mockRejectedValue(new Error("Engine stopped"));
    run.show();
    expect((await run.shown()).textContent).toContain("Alpha kernels");
    expect(
      (await run.shown()).querySelector("[data-citation-popover-actions]"),
    ).not.toBeNull();
  });

  it("closes a document popover when its source is deleted", async () => {
    await using run = harness(() => Promise.resolve(emptyText()));
    run.show();
    await vi.waitFor(() => expect(popovers.at(-1)!.render).toHaveBeenCalled());
    run.removeSource();
    await vi.waitFor(() => expect(popovers.at(-1)!.hide).toHaveBeenCalled());
  });
});

describe("source-less presentation updates", () => {
  it("keeps Item actions when nothing could be formatted", async () => {
    await using run = workHarness();
    run.db.holds([{ itemID: 1, key: "ABCD2345", title: "Alpha kernels" }]);
    run.readBibliography.mockResolvedValue(null);
    run.show();
    const element = await run.shown();
    expect(element.textContent).toContain("Alpha kernels");
    expect(
      element.querySelector("[data-citation-popover-actions]"),
    ).not.toBeNull();
  });

  it("retains the new Item data when an older render finishes later", async () => {
    await using run = workHarness();
    const pending = Promise.withResolvers<BibliographyRenderResult | null>();
    run.readBibliography.mockReturnValueOnce(pending.promise);
    run.db.holds([{ itemID: 1, key: "ABCD2345", title: "Old title" }]);
    run.show();
    await vi.waitFor(() => expect(run.readBibliography).toHaveBeenCalledOnce());
    run.db.holds([{ itemID: 1, key: "ABCD2345", title: "Corrected title" }]);
    run.emit("invalidated");
    expect((await run.shown()).textContent).toContain("Corrected title");
    pending.resolve(null);
    await pending.promise;
    expect((await run.shown()).textContent).toContain("Corrected title");
    expect(popovers.at(-1)!.render).toHaveBeenCalledOnce();
  });

  it("recovers from a database read failure without changing exact identity", async () => {
    await using run = workHarness();
    // The connection validates the copy first; the read fails after it.
    await (await run.db.acquireRead())[Symbol.asyncDispose]();
    run.db.lock();
    run.show();
    expect((await run.shown()).textContent).toBe(
      m.citation_popover_database_unavailable(),
    );
    run.db.unlock();
    run.db.holds([{ itemID: 1, key: "ABCD2345", title: "Recovered Item" }]);
    run.emit("invalidated");
    await vi.waitFor(async () =>
      expect((await run.shown()).textContent).toContain("Recovered Item"),
    );
    expect(run.citationIndex.resolveCitekey).not.toHaveBeenCalled();
  });
});

describe("source-less bibliography revalidation", () => {
  it.each([true, false])(
    "draws the bibliography the read settled on (success: %s)",
    async (success) => {
      await using run = workHarness();
      run.db.holds([{ itemID: 1, key: "ABCD2345", title: "Alpha kernels" }]);
      const settled = Promise.withResolvers<BibliographyRenderResult | null>();
      run.readBibliography.mockReturnValue(settled.promise);
      run.show();
      await vi.waitFor(() => expect(run.readBibliography).toHaveBeenCalled());

      settled.resolve(
        success
          ? {
              entries: [
                {
                  id: "ABCD2345",
                  marker: undefined,
                  content: [{ t: "Str", c: "New bibliography" }],
                },
              ],
              hasEntryMarkers: false,
            }
          : null,
      );

      await vi.waitFor(async () =>
        expect((await run.shown()).textContent).toContain(
          success ? "New bibliography" : "Alpha kernels",
        ),
      );
    },
  );
});

describe("source-less empty bibliography entries", () => {
  it("shows the LETTERS5 summary when the engine returns an empty entry", async () => {
    await using run = workHarness();
    run.db.holds([
      {
        itemID: 5,
        key: "LETTERS5",
        itemType: "letter",
        title: "A letter that records no Venue at all",
        citationKey: "chenLetterNoVenue2015",
        date: "2015",
        creators: [["Mei", "Chen"]],
      },
    ]);
    const bibliography: BibliographyRenderResult = {
      entries: [{ id: "LETTERS5", marker: undefined, content: [] }],
      hasEntryMarkers: false,
    };
    run.readBibliography.mockResolvedValue(bibliography);
    run.show({ kind: "item", indexedKey: "LETTERS5" });
    const element = await run.shown();
    expect(element.textContent).toBe(
      "Chen (2015): A letter that records no Venue at all",
    );
    expect(
      element.querySelector("[data-citation-popover-actions]"),
    ).not.toBeNull();
  });
});
