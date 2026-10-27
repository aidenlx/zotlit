import { it as effectIt } from "@effect/vitest";
// @vitest-environment happy-dom
import { DateTime, Effect } from "effect";
import { TFile } from "obsidian";
import type { App, Editor, Modifier } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { openTestBridge } from "@/lib/__fixtures__/effect-bridge";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { lookupAnswer } from "@/services/citation-index/__fixtures__/lookup";
import { CitationIndex } from "@/services/citation-index/service";
import type {
  DocumentCitationSet,
  CitekeyResolution,
} from "@/services/citation-index/service";
import {
  createCitationIndexHarness,
  KEY_A,
} from "@/services/citation-index/test-harness";
import type { ItemLookupHandle } from "@/services/item-lookup/handle";
import type { SearchHit } from "@/services/item-lookup/service";
import { defaults } from "@/services/settings/schema";
import type { UseKind } from "@/services/use-ledger/service";
import { DbUnavailable } from "@/services/zotero-reads/rpc";

import { InsertCitationModal } from "./insert-modal";
import type { CitationSuggestDeps } from "./register";

let bridge: ReturnType<typeof openTestBridge>;
beforeEach(() => {
  bridge = openTestBridge();
  return () => bridge[Symbol.asyncDispose]();
});

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
    lookup?: Pick<ItemLookupHandle, "openSession">;
  } = {},
  editor: Editor = stubService<Editor>("Editor", {}),
  file: TFile | null = null,
): InsertCitationModal {
  const { lookup = { openSession: vi.fn() }, ...rest } = overrides;
  const deps = stubService<CitationSuggestDeps>("CitationSuggestDeps", {
    app: stubService<App>("App", {}),
    lookup: stubService<CitationSuggestDeps["lookup"]>("ItemLookup", lookup),
    bridge,
    noteFeature: stubService<CitationSuggestDeps["noteFeature"]>(
      "NoteFeatureHandle",
      { renderCitation: vi.fn() },
    ),
    settings: { current: Effect.succeed(defaults) },
    citationLookup: {
      read: () =>
        Effect.succeed(
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
        ),
      current: Effect.succeed({
        status: "fresh",
        revision: null,
        stopped: false,
      }),
    },
    useLedger: stubService<CitationSuggestDeps["useLedger"]>("UseLedger", {
      record: () =>
        Effect.succeed({ instant: DateTime.makeUnsafe(0), kind: "cited" }),
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
  effectIt.effect(
    "writes nothing into the note when the Citation Key names several Items",
    () =>
      Effect.promise(async () => {
        const ambiguous: CitekeyResolution = {
          kind: "ambiguous",
          candidates: [
            { itemID: 1, libraryID: 1, key: "DOE2024", indexedKey: "DOE2024" },
            {
              itemID: 2,
              libraryID: 4,
              key: "ROE2025",
              indexedKey: "ROE2025g7",
            },
          ],
        };
        const renderCitation = vi.fn();
        const record = vi.fn<(key: string, kind: UseKind) => void>();
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
              read: () => Effect.succeed(lookupAnswer({ doe2024: ambiguous })),
              current: Effect.succeed({
                status: "fresh",
                revision: null,
                stopped: false,
              }),
            },
            useLedger: {
              record: (key, kind) =>
                Effect.sync(() => {
                  record(key, kind);
                  return { instant: DateTime.makeUnsafe(0), kind };
                }),
            },
          },
          editor,
        );
        const hit = searchHit();

        await modal.onChooseSuggestion(hit, {} as MouseEvent);

        expect(renderCitation).not.toHaveBeenCalled();
        expect(replaceRange).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
      }),
  );
});

describe("InsertCitationModal Uses", () => {
  effectIt.effect(
    "#1857 unload cancels insertion without a notice or Use",
    () =>
      Effect.promise(async () => {
        const started = Promise.withResolvers<void>();
        const renderCitation = vi.fn(() => "[@doe2024]");
        const record = vi.fn<(key: string, kind: UseKind) => void>();
        const draft = editor();
        const modal = makeModal(
          {
            bridge,
            noteFeature: { renderCitation },
            citationLookup: {
              current: Effect.succeed({
                status: "fresh",
                revision: null,
                stopped: false,
              }),
              read: () =>
                Effect.sync(() => started.resolve()).pipe(
                  Effect.andThen(Effect.never),
                ),
            },
            useLedger: {
              record: (key, kind) =>
                Effect.sync(() => {
                  record(key, kind);
                  return { instant: DateTime.makeUnsafe(0), kind };
                }),
            },
          },
          draft.editor,
        );
        const pending = modal.onChooseSuggestion(searchHit(), {} as MouseEvent);
        await started.promise;
        await bridge[Symbol.asyncDispose]();
        await pending;
        expect(draft.text()).toBe("");
        expect(renderCitation).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
      }),
  );

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

  effectIt.effect(
    "records the chosen Item after its citation is inserted",
    () =>
      Effect.promise(async () => {
        const draft = editor();
        const record = vi.fn<(key: string, kind: UseKind) => void>();
        const modal = makeModal(
          {
            noteFeature: { renderCitation: () => "[@doe2024]" },
            useLedger: {
              record: (key, kind) =>
                Effect.sync(() => {
                  record(key, kind);
                  return { instant: DateTime.makeUnsafe(0), kind };
                }),
            },
          },
          draft.editor,
        );

        await modal.onChooseSuggestion(hit, {} as MouseEvent);

        expect(draft.text()).toBe("[@doe2024]");
        expect(record).toHaveBeenCalledExactlyOnceWith("ABC123", "cited");
      }),
  );

  effectIt.effect(
    "records nothing when the editor changes while citation lookup is pending",
    () =>
      Effect.promise(async () => {
        const draft = editor();
        const record = vi.fn<(key: string, kind: UseKind) => void>();
        const answer = Promise.withResolvers<ReturnType<typeof lookupAnswer>>();
        const modal = makeModal(
          {
            noteFeature: { renderCitation: () => "[@doe2024]" },
            citationLookup: {
              current: Effect.succeed({
                status: "fresh",
                revision: null,
                stopped: false,
              }),
              read: () => Effect.promise((_signal) => answer.promise),
            },
            useLedger: {
              record: (key, kind) =>
                Effect.sync(() => {
                  record(key, kind);
                  return { instant: DateTime.makeUnsafe(0), kind };
                }),
            },
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
      }),
  );

  effectIt.effect("records nothing for an empty rendered citation", () =>
    Effect.promise(async () => {
      const draft = editor();
      const record = vi.fn<(key: string, kind: UseKind) => void>();
      const modal = makeModal(
        {
          noteFeature: { renderCitation: () => "" },
          useLedger: {
            record: (key, kind) =>
              Effect.sync(() => {
                record(key, kind);
                return { instant: DateTime.makeUnsafe(0), kind };
              }),
          },
        },
        draft.editor,
      );

      await modal.onChooseSuggestion(hit, {} as MouseEvent);

      expect(draft.text()).toBe("");
      expect(record).not.toHaveBeenCalled();
    }),
  );
});

describe("Insert Citation document citations", () => {
  effectIt.effect(
    "prioritizes resolved citations from the real Citation Index",
    () =>
      Effect.promise(async () => {
        await using index = await createCitationIndexHarness({
          "draft.md": "A source [@doe2024].",
        });
        const search = vi.fn().mockResolvedValue([]);
        const modal = makeModal(
          {
            citationIndex: index.runtime.runSync(CitationIndex),
            lookup: {
              openSession: () => ({
                search,
                close() {},
                [Symbol.dispose]() {},
              }),
            },
          },
          stubService<Editor>("Editor", {}),
          index.draft,
        );
        using _close = { [Symbol.dispose]: () => modal.onClose() };
        modal.onOpen();
        await modal.getSuggestions("");
        expect(search).toHaveBeenCalledWith("", { limit: 50, cited: [KEY_A] });
      }),
  );

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

  effectIt.effect(
    "reads once per open, skipping unresolved keys, and aborts on close",
    () =>
      Effect.promise(async () => {
        const read = vi.fn(() =>
          Effect.succeed(
            stubService<DocumentCitationSet>("DocumentCitationSet", {
              citations: [{ indexedKey: "AAAA2222" }, { indexedKey: null }].map(
                (citation) =>
                  stubService<DocumentCitationSet["citations"][number]>(
                    "Citation",
                    citation,
                  ),
              ),
            }),
          ),
        );
        using h = setup(read);
        h.modal.onOpen();
        await h.modal.getSuggestions("");
        await h.modal.getSuggestions("Paper");
        expect(read).toHaveBeenCalledTimes(1);
        expect(read).toHaveBeenCalledWith(file);
        expect(h.search).toHaveBeenLastCalledWith("Paper", {
          limit: 50,
          cited: ["AAAA2222"],
        });
        h.modal.onClose();
        h.modal.onOpen();
        await h.modal.getSuggestions("");
        expect(read).toHaveBeenCalledTimes(2);
      }),
  );

  effectIt.effect("continues searching after a document read fails", () =>
    Effect.promise(async () => {
      using h = setup(
        vi.fn(() =>
          Effect.fail(new DbUnavailable({ message: "Index unavailable" })),
        ),
      );
      h.modal.onOpen();
      await h.modal.getSuggestions("");
      expect(h.search).toHaveBeenCalledWith("", { limit: 50, cited: [] });
    }),
  );

  effectIt.effect(
    "drops a pending answer on close and reads the reopened note afresh",
    () =>
      Effect.promise(async () => {
        const read = vi
          .fn()
          .mockReturnValueOnce(Effect.never)
          .mockReturnValue(
            Effect.succeed(
              stubService<DocumentCitationSet>("DocumentCitationSet", {
                citations: [
                  stubService<DocumentCitationSet["citations"][number]>(
                    "Citation",
                    { indexedKey: "BBBB3333" },
                  ),
                ],
              }),
            ),
          );
        using h = setup(read);
        h.modal.onOpen();
        const pending = h.modal.getSuggestions("");
        h.modal.onClose();
        h.modal.onOpen();
        await expect(pending).resolves.toEqual([]);
        await h.modal.getSuggestions("");
        expect(h.search).toHaveBeenCalledExactlyOnceWith("", {
          limit: 50,
          cited: ["BBBB3333"],
        });
      }),
  );
});
