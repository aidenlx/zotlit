// @vitest-environment happy-dom
import type { TFile } from "obsidian";
import { act } from "preact/test-utils";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getItemsByKey } from "@zotlit/db";
import { makeCreator, makeItem } from "@zotlit/item-lookup/fixtures";

import type { Held } from "@/lib/held-reads";
import * as m from "@/lib/i18n/generated/messages";
import type { CitekeyResolution } from "@/services/citation-index/service";
import type { DocumentCitations } from "@/services/citation-text/service";
import type {
  BibliographyRenderOutcome,
  BibliographyRenderResult,
} from "@/services/pandoc/render-cache";
import { profileReader } from "@/services/profile/__fixtures__/reader";

import type { CitationPopoverContentProps } from "./content";
import { createCitationPopover } from "./service";
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
    readonly hide = vi.fn();

    constructor() {
      popovers.push(this);
    }

    register(): void {}
    registerEvent(): void {}
  },
}));

vi.mock("@zotlit/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@zotlit/db")>()),
  getZoteroIdentity: () => ({
    userID: null,
    localUserKey: null,
    username: null,
  }),
  getItemsByKey: vi.fn(() => []),
  getAttachmentsByParents: vi.fn(() => []),
}));

const NOTE = { path: "note.md" } as TFile;

const emptyText = (): DocumentCitations => ({
  formatted: new Map(),
  entrySerials: false,
  summaries: new Map(),
  literalWorks: new Map(),
});

function harness(initial: Held<DocumentCitations> | null) {
  let held = initial;
  let file: TFile | null = NOTE;
  const deleted = new Set<(file: TFile) => void>();
  const listeners = {
    changed: new Set<(path: string) => void>(),
    settled: new Set<
      (path: string, held: Held<DocumentCitations> | null) => void
    >(),
    invalidated: new Set<() => void>(),
  };
  const citationText = {
    peek: vi.fn(() => held),
    on: vi.fn(
      <K extends keyof typeof listeners>(
        event: K,
        listener: (typeof listeners)[K] extends Set<infer T> ? T : never,
      ) => {
        listeners[event].add(listener as never);
        return () => listeners[event].delete(listener as never);
      },
    ),
  };
  const service = createCitationPopover({
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
    db: { state: "ready", client: {} },
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
    emitChanged: () => {
      for (const listener of listeners.changed) listener(NOTE.path);
    },
    emitInvalidated: () => {
      for (const listener of listeners.invalidated) listener();
    },
    emitSettled: (settled: Held<DocumentCitations> | null) => {
      for (const listener of listeners.settled) listener(NOTE.path, settled);
    },
    hold(value: Held<DocumentCitations>) {
      held = value;
    },
    show,
  };
}

beforeEach(() => {
  popovers.length = 0;
});

describe("Citation Popover citation text", () => {
  it("settles the second hover after the first citation-text read failed", async () => {
    vi.useFakeTimers();
    try {
      const run = harness(null);

      run.show();
      await vi.advanceTimersByTimeAsync(0);
      expect(run.citationText.peek).toHaveBeenCalledOnce();
      run.emitSettled(null);
      await vi.advanceTimersByTimeAsync(100);
      expect(popovers[0]!.render).toHaveBeenCalledOnce();
      expect(run.citationText.peek).toHaveBeenCalledOnce();

      run.show();
      await vi.advanceTimersByTimeAsync(0);
      expect(run.citationText.peek).toHaveBeenCalledTimes(2);
      run.emitSettled(null);
      await vi.advanceTimersByTimeAsync(100);
      expect(popovers[1]!.render).toHaveBeenCalledOnce();
      expect(run.citationText.peek).toHaveBeenCalledTimes(2);
      const content = popovers[1]!.render.mock
        .calls[0]![0] as ReactElement<CitationPopoverContentProps>;
      expect(content.props.note).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [
      "the document changed",
      (run: ReturnType<typeof harness>) => run.emitChanged(),
    ],
    [
      "all documents changed",
      (run: ReturnType<typeof harness>) => run.emitInvalidated(),
    ],
  ])("follows a replaced first read when %s", async (_name, invalidate) => {
    const run = harness(null);
    run.show();
    await vi.waitFor(() =>
      expect(run.citationText.peek).toHaveBeenCalledOnce(),
    );

    invalidate(run);
    await vi.waitFor(() =>
      expect(run.citationText.peek).toHaveBeenCalledTimes(2),
    );

    run.hold({
      value: emptyText(),
      status: "fresh",
      settled: Promise.resolve(emptyText()),
    });
    run.emitChanged();

    await vi.waitFor(() => expect(popovers[0]!.render).toHaveBeenCalledOnce());
  });

  it("uses the held citation text after its replacement read failed", async () => {
    const text: DocumentCitations = {
      ...emptyText(),
      formatted: new Map([
        [
          "[@ghost]",
          [
            {
              start: 0,
              text: {
                content: [
                  {
                    t: "Note",
                    c: [{ t: "Para", c: [{ t: "Str", c: "held note" }] }],
                  },
                ],
                citations: [{ id: "ghost", mode: "normal" }],
              },
              serials: [],
            },
          ],
        ],
      ]),
    };
    const run = harness({
      value: text,
      status: "failed",
      settled: Promise.resolve(null),
    });

    run.show();

    await vi.waitFor(() => expect(popovers[0]!.render).toHaveBeenCalledOnce());
    const content = popovers[0]!.render.mock
      .calls[0]![0] as ReactElement<CitationPopoverContentProps>;
    expect(content.props.note).toEqual([{ t: "Str", c: "held note" }]);
  });
});

describe("source-less Citation Popover", () => {
  it("shows an uncited Item without a citation key under the vault presentation", async () => {
    vi.mocked(getItemsByKey).mockReturnValue([
      makeItem({ key: "ABCD2345", title: "Alpha kernels", citationKey: null }),
    ]);
    const render = vi.fn(async () => ({
      kind: "held",
      record: {
        value: {
          entries: [
            {
              id: "ABCD2345",
              marker: [{ t: "Str", c: "[1]" }],
              content: [{ t: "Str", c: "Formatted alpha" }],
            },
          ],
        },
      },
    }));
    const service = createCitationPopover({
      app: {},
      db: { state: "ready", client: {} },
      citationIndex: { resolution: null },
      libraryScope: { current: [] },
      profile: profileReader(),
      bibliographyRender: { render, on: () => () => undefined },
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
    expect(render.mock.calls[0]).toEqual([
      [expect.objectContaining({ title: "Alpha kernels" })],
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
  const db = { state: "ready", client: {} };
  const citationIndex = {
    resolution: {} as object | null,
    resolveCitekey: vi.fn<() => CitekeyResolution | null>(() => ({
      kind: "missing",
    })),
    on,
  };
  const render = vi.fn<() => Promise<BibliographyRenderOutcome>>(async () => ({
    kind: "unavailable",
    reason: "engine-absent",
  }));
  const open = vi.fn();
  const service = createCitationPopover({
    app: {},
    db,
    citationIndex,
    libraryScope: { current: [] },
    profile: profileReader(),
    bibliographyRender: { render, on },
  } as never);
  const element = document.createElement("div");
  const root = createRoot(element);
  return {
    db,
    citationIndex,
    render,
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
    [Symbol.dispose]() {
      root.unmount();
    },
  };
}

describe("source-less lookup states", () => {
  beforeEach(() => {
    vi.mocked(getItemsByKey).mockReturnValue([]);
  });

  it("distinguishes an unavailable database from an absent exact Item", async () => {
    using run = workHarness();
    run.db.state = "loading";
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
    using run = workHarness();
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

    vi.mocked(getItemsByKey).mockReturnValue([
      makeItem({
        key: "ABCD2345",
        title: "Alpha kernels",
        citationKey: "doe2024",
      }),
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
    using run = workHarness();
    vi.mocked(getItemsByKey).mockReturnValue([
      makeItem({
        key: "ABCD2345",
        title: "Alpha kernels",
        citationKey: "shared2024",
      }),
    ]);
    run.show();
    const element = await run.shown();
    element
      .querySelector<HTMLButtonElement>(
        `[aria-label="${m.references_open_note()}"]`,
      )!
      .click();
    expect(run.open).toHaveBeenCalledExactlyOnceWith("ABCD2345", false);

    run.open.mockClear();
    popovers.at(-1)!.hide.mockClear();
    vi.mocked(getItemsByKey).mockReturnValue([]);
    element
      .querySelector<HTMLButtonElement>(
        `[aria-label="${m.references_open_note()}"]`,
      )!
      .click();
    expect(run.open).not.toHaveBeenCalled();
    expect((await run.shown()).textContent).toBe(
      m.citation_popover_item_unavailable(),
    );
    expect(popovers.at(-1)!.hide).not.toHaveBeenCalled();
  });
});

describe("popover failure and lifetime", () => {
  it("keeps a readable Item when the formatting request throws", async () => {
    using run = workHarness();
    vi.mocked(getItemsByKey).mockReturnValue([
      makeItem({ key: "ABCD2345", title: "Alpha kernels" }),
    ]);
    run.render.mockRejectedValue(new Error("Engine stopped"));
    run.show();
    expect((await run.shown()).textContent).toContain("Alpha kernels");
    expect(
      (await run.shown()).querySelector("[data-citation-popover-actions]"),
    ).not.toBeNull();
  });

  it("closes a document popover when its source is deleted", async () => {
    const text = emptyText();
    const run = harness({
      value: text,
      status: "fresh",
      settled: Promise.resolve(text),
    });
    run.show();
    await vi.waitFor(() => expect(popovers.at(-1)!.render).toHaveBeenCalled());
    run.removeSource();
    await vi.waitFor(() => expect(popovers.at(-1)!.hide).toHaveBeenCalled());
  });
});

describe("source-less presentation updates", () => {
  it.each(["engine-absent", "style-missing", "failed"] as const)(
    "keeps Item actions when formatting is %s",
    async (reason) => {
      using run = workHarness();
      vi.mocked(getItemsByKey).mockReturnValue([
        makeItem({
          key: "ABCD2345",
          title: "Alpha kernels",
          citationKey: null,
        }),
      ]);
      run.render.mockResolvedValue({ kind: "unavailable", reason });
      run.show();
      const element = await run.shown();
      expect(element.textContent).toContain("Alpha kernels");
      expect(
        element.querySelector("[data-citation-popover-actions]"),
      ).not.toBeNull();
    },
  );

  it("retains the new Item data when an older render finishes later", async () => {
    using run = workHarness();
    const pending = Promise.withResolvers<BibliographyRenderOutcome>();
    run.render.mockReturnValueOnce(pending.promise);
    vi.mocked(getItemsByKey).mockReturnValue([
      makeItem({ key: "ABCD2345", title: "Old title" }),
    ]);
    run.show();
    await vi.waitFor(() => expect(run.render).toHaveBeenCalledOnce());
    vi.mocked(getItemsByKey).mockReturnValue([
      makeItem({ key: "ABCD2345", title: "Corrected title" }),
    ]);
    run.emit("invalidated");
    expect((await run.shown()).textContent).toContain("Corrected title");
    pending.resolve({ kind: "unavailable", reason: "failed" });
    await pending.promise;
    expect((await run.shown()).textContent).toContain("Corrected title");
    expect(popovers.at(-1)!.render).toHaveBeenCalledOnce();
  });

  it("recovers from a database read failure without changing exact identity", async () => {
    using run = workHarness();
    vi.mocked(getItemsByKey).mockImplementationOnce(() => {
      throw new Error("Database locked");
    });
    run.show();
    expect((await run.shown()).textContent).toBe(
      m.citation_popover_database_unavailable(),
    );
    vi.mocked(getItemsByKey).mockReturnValue([
      makeItem({ key: "ABCD2345", title: "Recovered Item", citationKey: null }),
    ]);
    run.emit("invalidated");
    await vi.waitFor(async () =>
      expect((await run.shown()).textContent).toContain("Recovered Item"),
    );
    expect(run.citationIndex.resolveCitekey).not.toHaveBeenCalled();
  });
});

describe("source-less bibliography revalidation", () => {
  it.each([true, false])(
    "consumes the replacement bibliography (success: %s)",
    async (success) => {
      using run = workHarness();
      vi.mocked(getItemsByKey).mockReturnValue([
        makeItem({ key: "ABCD2345", title: "Alpha kernels" }),
      ]);
      const replacement =
        Promise.withResolvers<BibliographyRenderResult | null>();
      run.render.mockResolvedValue({
        kind: "held",
        key: "same-item",
        record: {
          status: "revalidating",
          value: {
            entries: [
              {
                id: "ABCD2345",
                marker: undefined,
                content: [{ t: "Str", c: "Old bibliography" }],
              },
            ],
            hasEntryMarkers: false,
          },
          settled: replacement.promise,
        },
      });
      run.show();
      await vi.waitFor(() => expect(run.render).toHaveBeenCalled());
      replacement.resolve(
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
      expect((await run.shown()).textContent).not.toContain("Old bibliography");
    },
  );
});

describe("source-less empty bibliography entries", () => {
  it("shows the LETTERS5 summary when the engine returns an empty entry", async () => {
    using run = workHarness();
    vi.mocked(getItemsByKey).mockReturnValue([
      makeItem({
        key: "LETTERS5",
        itemType: "letter",
        title: "A letter that records no Venue at all",
        citationKey: "chenLetterNoVenue2015",
        date: "2015",
        creators: [makeCreator("Mei", "Chen")],
        primaryCreatorType: "author",
      }),
    ]);
    const bibliography: BibliographyRenderResult = {
      entries: [{ id: "LETTERS5", marker: undefined, content: [] }],
      hasEntryMarkers: false,
    };
    run.render.mockResolvedValue({
      kind: "held",
      key: "letter",
      record: {
        status: "fresh",
        value: bibliography,
        settled: Promise.resolve(bibliography),
      },
    });
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
