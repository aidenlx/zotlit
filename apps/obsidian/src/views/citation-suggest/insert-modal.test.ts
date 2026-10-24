// @vitest-environment happy-dom
import type { App, Editor, Modifier, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { Effect } from "@/lib/effect";
import { lookupAnswer } from "@/services/citation-index/__fixtures__/lookup";
import type { CitekeyResolution } from "@/services/citation-index/service";
import type { SearchHit } from "@/services/item-lookup/service";

import { InsertCitationModal } from "./insert-modal";
import type { CitationSuggestDeps } from "./register";

function makeModal(
  overrides: Partial<CitationSuggestDeps> = {},
  editor: Editor = {} as Editor,
  file: TFile | null = null,
): InsertCitationModal {
  const deps = {
    app: {} as App,
    lookup: { openSession: vi.fn() },
    noteFeature: { renderCitation: vi.fn() },
    settings: { current: Effect.succeed({}) },
    bridge: { runSync: Effect.runSync, runPromise: Effect.runPromise },
    citationLookup: {
      read: async () =>
        lookupAnswer({
          doe2024: {
            kind: "unique",
            item: {
              itemID: 1,
              libraryID: 1,
              key: "ABC123",
              indexedKey: "ABC123",
            },
          },
        }),
      status: "ready",
    },
    useLedger: { record: vi.fn() },
    ...overrides,
  } as unknown as CitationSuggestDeps;
  return new InsertCitationModal(deps, editor, file);
}

/**
 * Regression for discussion #644: the modal advertises `⇧↵` for the alternate
 * citation, but Obsidian's suggestion popup registers `Enter` with no
 * modifiers and matches them exactly, so Shift+Enter reached no handler at all
 * and the modal just sat there. The modal has to register the chord itself.
 */
describe("InsertCitationModal keymap", () => {
  function findShiftEnter(
    modal: InsertCitationModal,
  ): ((evt: KeyboardEvent) => boolean | void) | undefined {
    const scope = modal.scope as unknown as {
      handlers: {
        modifiers: Modifier[] | null;
        key: string | null;
        func: (evt: KeyboardEvent) => boolean | void;
      }[];
    };
    return scope.handlers.find(
      (h) => h.key === "Enter" && h.modifiers?.includes("Shift"),
    )?.func;
  }

  it("registers a Shift+Enter handler", () => {
    expect(findShiftEnter(makeModal())).toBeDefined();
  });

  it("selects the highlighted suggestion when Shift+Enter fires", () => {
    const modal = makeModal();
    const select = vi
      .spyOn(modal, "selectActiveSuggestion")
      .mockImplementation(() => {});
    const evt = { shiftKey: true } as KeyboardEvent;

    const result = findShiftEnter(modal)?.(evt);

    expect(select).toHaveBeenCalledWith(evt);
    // Returning false tells Obsidian the chord was consumed, so the keypress
    // does not fall through to the default Enter handling.
    expect(result).toBe(false);
  });
});

describe("InsertCitationModal ambiguity", () => {
  it("writes nothing into the note when the Citation Key names several Items", async () => {
    const ambiguous: CitekeyResolution = {
      kind: "ambiguous",
      candidates: [
        { itemID: 1, libraryID: 1, key: "DOE2024", indexedKey: "DOE2024" },
        { itemID: 2, libraryID: 4, key: "ROE2025", indexedKey: "ROE2025g7" },
      ],
    };
    const renderCitation = vi.fn();
    const record = vi.fn();
    const replaceRange = vi.fn();
    const editor = {
      getValue: () => "",
      getCursor: () => ({ line: 0, ch: 0 }),
      getLine: () => "",
      replaceRange,
      setCursor: vi.fn(),
      offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
      posToOffset: () => 0,
    } as unknown as Editor;
    const modal = makeModal(
      {
        noteFeature: { renderCitation },
        citationLookup: {
          read: async () => lookupAnswer({ doe2024: ambiguous }),
          status: "ready",
        },
        useLedger: { record },
      } as unknown as Partial<CitationSuggestDeps>,
      editor,
    );
    const hit = {
      item: {
        key: "ABC123",
        indexedKey: "ABC123",
        fields: { citationKey: "doe2024" },
      },
      matches: [],
    } as unknown as SearchHit;

    await modal.onChooseSuggestion(hit, {} as MouseEvent);

    expect(renderCitation).not.toHaveBeenCalled();
    expect(replaceRange).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});

describe("InsertCitationModal Uses", () => {
  function editor(value = "") {
    let text = value;
    return {
      editor: {
        getValue: () => text,
        getCursor: () => ({ line: 0, ch: text.length }),
        getLine: () => text,
        replaceRange: (insert: string) => {
          text += insert;
        },
        setCursor: vi.fn(),
        offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
        posToOffset: () => text.length,
      } as unknown as Editor,
      text: () => text,
      change: (next: string) => {
        text = next;
      },
    };
  }

  const hit = {
    item: {
      key: "ABC123",
      indexedKey: "ABC123",
      fields: { citationKey: "doe2024" },
    },
    matches: [],
  } as unknown as SearchHit;

  it("records the chosen Item after its citation is inserted", async () => {
    const draft = editor();
    const record = vi.fn();
    const modal = makeModal(
      {
        noteFeature: { renderCitation: () => "[@doe2024]" },
        useLedger: { record },
      } as unknown as Partial<CitationSuggestDeps>,
      draft.editor,
    );

    await modal.onChooseSuggestion(hit, {} as MouseEvent);

    expect(draft.text()).toBe("[@doe2024]");
    expect(record).toHaveBeenCalledExactlyOnceWith("ABC123", "cited");
  });

  it("records nothing when the editor changes while citation lookup is pending", async () => {
    const draft = editor();
    const record = vi.fn();
    const answer = Promise.withResolvers<ReturnType<typeof lookupAnswer>>();
    const modal = makeModal(
      {
        noteFeature: { renderCitation: () => "[@doe2024]" },
        citationLookup: { status: "ready", read: () => answer.promise },
        useLedger: { record },
      } as unknown as Partial<CitationSuggestDeps>,
      draft.editor,
    );

    const choose = modal.onChooseSuggestion(hit, {} as MouseEvent);
    draft.change("new text");
    answer.resolve(
      lookupAnswer({ doe2024: { kind: "unique", item: hit.item } }),
    );
    await choose;

    expect(draft.text()).toBe("new text");
    expect(record).not.toHaveBeenCalled();
  });

  it("records nothing for an empty rendered citation", async () => {
    const draft = editor();
    const record = vi.fn();
    const modal = makeModal(
      {
        noteFeature: { renderCitation: () => "" },
        useLedger: { record },
      } as unknown as Partial<CitationSuggestDeps>,
      draft.editor,
    );

    await modal.onChooseSuggestion(hit, {} as MouseEvent);

    expect(draft.text()).toBe("");
    expect(record).not.toHaveBeenCalled();
  });
});

describe("Insert Citation document citations", () => {
  const file = { path: "Draft.md" } as TFile;
  function setup(read: unknown) {
    const search = vi.fn().mockResolvedValue([]);
    const modal = makeModal(
      {
        lookup: { openSession: () => ({ search, close() {} }) },
        citationIndex: { getDocumentCitationSet: read },
      } as unknown as Partial<CitationSuggestDeps>,
      {} as Editor,
      file,
    );
    return { modal, search, [Symbol.dispose]: () => modal.onClose() };
  }

  it("reads once per open, skipping unresolved keys, and aborts on close", async () => {
    const read = vi.fn().mockResolvedValue({
      citations: [{ indexedKey: "AAAA2222" }, { indexedKey: null }],
    });
    using h = setup(read);
    h.modal.onOpen();
    await h.modal.getSuggestions("");
    await h.modal.getSuggestions("Paper");
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(file, {
      signal: expect.any(AbortSignal),
    });
    expect(h.search).toHaveBeenLastCalledWith("Paper", {
      limit: 50,
      cited: ["AAAA2222"],
    });
    h.modal.onClose();
    expect(read.mock.calls[0]![1].signal.aborted).toBe(true);
    h.modal.onOpen();
    await h.modal.getSuggestions("");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("continues searching after a document read fails", async () => {
    using h = setup(vi.fn().mockRejectedValue(new Error("Index unavailable")));
    h.modal.onOpen();
    await h.modal.getSuggestions("");
    expect(h.search).toHaveBeenCalledWith("", { limit: 50, cited: [] });
  });

  it("drops a pending answer on close and reads the reopened note afresh", async () => {
    const read = vi
      .fn()
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValue({ citations: [{ indexedKey: "BBBB3333" }] });
    using h = setup(read);
    h.modal.onOpen();
    const pending = h.modal.getSuggestions("");
    h.modal.onClose();
    h.modal.onOpen();
    await expect(pending).resolves.toEqual([]);
    expect(read.mock.calls[0]![1].signal.aborted).toBe(true);
    await h.modal.getSuggestions("");
    expect(h.search).toHaveBeenCalledExactlyOnceWith("", {
      limit: 50,
      cited: ["BBBB3333"],
    });
  });
});
