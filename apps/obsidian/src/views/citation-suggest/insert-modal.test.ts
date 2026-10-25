// @vitest-environment happy-dom
import { Effect } from "effect";
import { TFile } from "obsidian";
import type { App, Editor, Modifier } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { lookupAnswer } from "@/services/citation-index/__fixtures__/lookup";
import type { CitekeyResolution } from "@/services/citation-index/service";
import type { ItemLookup } from "@/services/item-lookup/service";
import type { SearchHit } from "@/services/item-lookup/service";
import { defaults } from "@/services/settings/schema";

import { InsertCitationModal } from "./insert-modal";
import type { CitationSuggestDeps } from "./register";

function searchHit(): SearchHit {
  return stubService<SearchHit>("SearchHit", {
    item: stubService<SearchHit["item"]>("Item", {
      key: "ABC123",
      indexedKey: "ABC123",
      fields: stubService<SearchHit["item"]["fields"]>("ItemFields", {
        citationKey: "doe2024",
      }),
    }),
  });
}

function makeModal(
  overrides: Partial<Omit<CitationSuggestDeps, "lookup">> & {
    lookup?: Pick<ItemLookup, "openSession">;
  } = {},
  editor: Editor = stubService<Editor>("Editor", {}),
  file: TFile | null = null,
): InsertCitationModal {
  const { lookup = { openSession: vi.fn() }, ...rest } = overrides;
  const deps = stubService<CitationSuggestDeps>("CitationSuggestDeps", {
    app: stubService<App>("App", {}),
    lookup: stubService<CitationSuggestDeps["lookup"]>("ItemLookup", lookup),
    noteFeature: stubService<CitationSuggestDeps["noteFeature"]>(
      "NoteFeature",
      { renderCitation: vi.fn() },
    ),
    settings: { current: Effect.succeed(defaults) },
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
      status: "fresh",
    },
    useLedger: stubService<CitationSuggestDeps["useLedger"]>("UseLedger", {
      record: vi.fn(),
    }),
    ...rest,
  });
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
    const editor = stubService<Editor>("Editor", {
      getValue: () => "",
      getCursor: () => ({ line: 0, ch: 0 }),
      getLine: () => "",
      replaceRange,
      setCursor: vi.fn(),
      offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
      posToOffset: () => 0,
    });
    const modal = makeModal(
      {
        noteFeature: { renderCitation },
        citationLookup: {
          read: async () => lookupAnswer({ doe2024: ambiguous }),
          status: "fresh",
        },
        useLedger: { record },
      },
      editor,
    );
    const hit = searchHit();

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
      editor: stubService<Editor>("Editor", {
        getValue: () => text,
        getCursor: () => ({ line: 0, ch: text.length }),
        getLine: () => text,
        replaceRange: (insert: string) => {
          text += insert;
        },
        setCursor: vi.fn(),
        offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
        posToOffset: () => text.length,
      }),
      text: () => text,
      change: (next: string) => {
        text = next;
      },
    };
  }

  const hit = searchHit();

  it("records the chosen Item after its citation is inserted", async () => {
    const draft = editor();
    const record = vi.fn();
    const modal = makeModal(
      {
        noteFeature: { renderCitation: () => "[@doe2024]" },
        useLedger: { record },
      },
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
        citationLookup: { status: "fresh", read: () => answer.promise },
        useLedger: { record },
      },
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
      },
      draft.editor,
    );

    await modal.onChooseSuggestion(hit, {} as MouseEvent);

    expect(draft.text()).toBe("");
    expect(record).not.toHaveBeenCalled();
  });
});

describe("Insert Citation document citations", () => {
  const file = new TFile();
  file.path = "Draft.md";
  function setup(
    read: CitationSuggestDeps["citationIndex"]["getDocumentCitationSet"],
  ) {
    const search = vi.fn().mockResolvedValue([]);
    const modal = makeModal(
      {
        lookup: {
          openSession: () => ({
            search,
            close() {},
            [Symbol.dispose]() {},
          }),
        },
        citationIndex: { getDocumentCitationSet: read },
      },
      stubService<Editor>("Editor", {}),
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
