import { Text } from "@codemirror/state";
import { Effect, Stream } from "effect";
import type { App, Editor, EditorSuggestContext, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { testRuntime } from "@/lib/__fixtures__/runtime";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { lookupAnswer } from "@/services/citation-index/__fixtures__/lookup";
import type {
  CitationKeyResolution,
  CitekeyResolution,
} from "@/services/citation-index/service";
import {
  createCitationIndexHarness,
  KEY_A,
} from "@/services/citation-index/test-harness";
import { ItemLookup } from "@/services/item-lookup/service";
import type { SearchHit } from "@/services/item-lookup/service";
import { InertTemplateError } from "@/services/template/errors";
import {
  inProcessReadsService,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";
import { placeInsertion } from "@/views/annot-view/async-insert";

import {
  CitationEditorSuggest,
  resolveCitationInsert,
  resolveCitationTrigger,
} from "./editor-suggest";
import type { CitationSuggestDeps } from "./register";

function makeHit(citationKey: string | null): SearchHit {
  return {
    item: { key: "ABC123", fields: { citationKey } },
    matches: [],
  } as unknown as SearchHit;
}

/** The two decisions an insert runs on: how a citation renders, and whether
 *  its Citation Key names one Zotero Item or several — the second only once
 *  the resolution snapshot has an answer at all. */
function insertDeps(
  renderCitation: unknown,
  resolved: CitekeyResolution = { kind: "unique", item: UNIQUE_ITEM },
  resolution: CitationKeyResolution = "fresh",
): Pick<CitationSuggestDeps, "noteFeature" | "citationLookup"> {
  return {
    noteFeature: {
      renderCitation,
    } as CitationSuggestDeps["noteFeature"],
    citationLookup: {
      read: async ({ citekeys }) => {
        if (resolution === "failed") throw new Error("Citation lookup failed");
        return lookupAnswer(
          Object.fromEntries((citekeys ?? []).map((key) => [key, resolved])),
        );
      },
      status: resolution ?? "pending",
    },
  };
}

const UNIQUE_ITEM = {
  itemID: 1,
  libraryID: 1,
  key: "ABC123",
  indexedKey: "ABC123",
};

describe("resolveCitationInsert", async () => {
  it("resolves to a not-ready notice when the template isn't loaded yet", async () => {
    // Regression for the C3 readiness gap: renderCitation returns null instead
    // of throwing when `template.loaded` is false, so the handler (which can't
    // await) must resolve to a notice rather than inserting an empty string
    // into the editor.
    const renderCitation = vi.fn().mockReturnValue(null);
    const hit = makeHit("abc2024");

    const outcome = await resolveCitationInsert(
      insertDeps(renderCitation),
      hit,
      "main",
    );

    expect(renderCitation).toHaveBeenCalledWith(
      [{ citationKey: "abc2024", item: hit.item }],
      "main",
    );
    expect(outcome).toEqual({
      kind: "notice",
      message: m.notice_template_not_ready(),
    });
  });

  it("resolves an inert-template error to a notice carrying its own message", async () => {
    const renderCitation = vi.fn(() => {
      throw new InertTemplateError("The citation text is inert");
    });

    const outcome = await resolveCitationInsert(
      insertDeps(renderCitation),
      makeHit("abc2024"),
      "main",
    );

    expect(outcome).toEqual({
      kind: "notice",
      message: "The citation text is inert",
    });
  });

  it("rethrows render errors that are not inert-template errors", async () => {
    const renderCitation = vi.fn(() => {
      throw new Error("boom");
    });

    await expect(
      resolveCitationInsert(
        insertDeps(renderCitation),
        makeHit("abc2024"),
        "main",
      ),
    ).rejects.toThrow("boom");
  });

  it("resolves to a no-citekey notice without rendering when the item has none", async () => {
    const renderCitation = vi.fn();

    const outcome = await resolveCitationInsert(
      insertDeps(renderCitation),
      makeHit(null),
      "main",
    );

    expect(renderCitation).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      kind: "notice",
      message: m.notice_no_citekey({ key: "ABC123" }),
    });
  });

  it("refuses a Citation Key that names several Zotero Items", async () => {
    const renderCitation = vi.fn();

    const outcome = await resolveCitationInsert(
      insertDeps(renderCitation, {
        kind: "ambiguous",
        candidates: [
          UNIQUE_ITEM,
          { itemID: 2, libraryID: 4, key: "ROE2025", indexedKey: "ROE2025g7" },
        ],
      }),
      makeHit("abc2024"),
      "main",
    );

    // The inserted text carries the key alone, so inserting it would lose the
    // Item the user picked here.
    expect(renderCitation).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      kind: "notice",
      message: m.notice_citekey_ambiguous_insert({ citekey: "abc2024" }),
    });
  });

  it("refuses an insert while the resolution snapshot has no answer yet", async () => {
    const renderCitation = vi.fn();

    // A snapshot still resolving answers every key as missing, so an ambiguous
    // key would slip through the refusal above and lose its Item identity.
    const outcome = await resolveCitationInsert(
      insertDeps(renderCitation, { kind: "missing" }, null),
      makeHit("abc2024"),
      "main",
    );

    expect(renderCitation).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      kind: "notice",
      message: m.notice_citekey_not_ready(),
    });
  });

  it("refuses insertion when a fresh lookup fails despite a held answer", async () => {
    const renderCitation = vi.fn().mockReturnValue("[@abc2024]");

    const outcome = await resolveCitationInsert(
      insertDeps(
        renderCitation,
        { kind: "unique", item: UNIQUE_ITEM },
        "failed",
      ),
      makeHit("abc2024"),
      "main",
    );

    expect(renderCitation).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      kind: "notice",
      message: m.notice_citekey_not_ready(),
    });
  });
});

describe("resolveCitationTrigger", () => {
  const knownKeys = new Set([
    "rougier2014",
    "smith:2024/a.b-c",
    "key,with,commas",
  ]);
  const isKnownCitekey = (key: string): boolean => knownKeys.has(key);

  it.each([
    "[@rougier2014,]",
    "[@rougier2014, p]",
    "[@rougier2014, p. 1]",
    "【@rougier2014, p】",
    "[@smith:2024/a.b-c, p]",
    "[@{key,with,commas}, p]",
  ])("keeps locator edits out of the suggester: %s", (line) => {
    for (const atTrigger of [false, true]) {
      expect(
        resolveCitationTrigger(line, line.length - 1, {
          atTrigger,
          isKnownCitekey,
        }),
      ).toBeNull();
    }
  });

  it.each([
    "Ten Simple Rules",
    "Methods, results",
    "rougier2014 figures",
    "smith:2024/a.b-c",
    "{key,with,commas}",
  ])("keeps title and citation-key queries searchable: %s", (query) => {
    const line = `[@${query}]`;
    expect(
      resolveCitationTrigger(line, line.length - 1, {
        atTrigger: false,
        isKnownCitekey,
      }),
    ).toEqual({ start: 0, end: line.length, query, variant: "main" });
  });

  it("matches the Bracket Trigger `[@`", () => {
    const line = "see [@foo";
    expect(
      resolveCitationTrigger(line, line.length, { atTrigger: false }),
    ).toEqual({
      start: 4,
      end: 9,
      query: "foo",
      variant: "main",
    });
  });

  it("matches the Bracket Trigger `【@`", () => {
    const line = "见【@foo";
    expect(
      resolveCitationTrigger(line, line.length, { atTrigger: false }),
    ).toEqual({
      start: 1,
      end: 6,
      query: "foo",
      variant: "main",
    });
  });

  it("prefers the Bracket Trigger over the At Trigger even when at-trigger is enabled", () => {
    const bracketLine = "see [@foo";
    const wideBracketLine = "见【@foo";
    expect(
      resolveCitationTrigger(bracketLine, bracketLine.length, {
        atTrigger: true,
      }),
    ).toEqual({ start: 4, end: 9, query: "foo", variant: "main" });
    expect(
      resolveCitationTrigger(wideBracketLine, wideBracketLine.length, {
        atTrigger: true,
      }),
    ).toEqual({ start: 1, end: 6, query: "foo", variant: "main" });
  });

  it("extends `end` to swallow an adjacent closing bracket for bracket matches", () => {
    // "[@foo]" with the cursor right before "]": bracket match consumes it.
    const line = "[@foo]";
    expect(resolveCitationTrigger(line, 5, { atTrigger: false })).toEqual({
      start: 0,
      end: 6,
      query: "foo",
      variant: "main",
    });
  });

  it("does not extend `end` when the adjacent char is a bracket but the trigger isn't", () => {
    // "(@foo]" — no Bracket Trigger match here ("(" isn't an opener for it),
    // and the At Trigger never swallows a following bracket.
    const line = "(@foo]";
    expect(resolveCitationTrigger(line, 5, { atTrigger: true })).toEqual({
      start: 1,
      end: 5,
      query: "foo",
      variant: "main",
    });
  });

  it("never extends `end` for an At Trigger match even next to `]`", () => {
    const line = "@foo]";
    expect(resolveCitationTrigger(line, 4, { atTrigger: true })).toEqual({
      start: 0,
      end: 4,
      query: "foo",
      variant: "main",
    });
  });

  it.each([
    ["line start", "@foo", 0],
    ["a preceding space", " @foo", 1],
    ["a preceding `(`", "(@foo", 1],
    ["a preceding `{`", "{@foo", 1],
    ["a preceding `（`", "（@foo", 1],
    ["a preceding `「`", "「@foo", 1],
    ['a preceding `"`', '"@foo', 1],
    ["a preceding `'`", "'@foo", 1],
  ])("fires the At Trigger at %s", (_label, line, start) => {
    expect(
      resolveCitationTrigger(line, line.length, { atTrigger: true }),
    ).toEqual({
      start,
      end: line.length,
      query: "foo",
      variant: "main",
    });
  });

  it("never fires mid-word", () => {
    const line = "user@example.com";
    expect(
      resolveCitationTrigger(line, line.length, { atTrigger: true }),
    ).toBeNull();
  });

  it("converts underscores to spaces in At Trigger queries only", () => {
    const atLine = "@machine_learning";
    expect(
      resolveCitationTrigger(atLine, atLine.length, { atTrigger: true }),
    ).toEqual({
      start: 0,
      end: atLine.length,
      query: "machine learning",
      variant: "main",
    });

    const bracketLine = "[@machine_learning";
    expect(
      resolveCitationTrigger(bracketLine, bracketLine.length, {
        atTrigger: true,
      }),
    ).toEqual({
      start: 0,
      end: bracketLine.length,
      query: "machine_learning",
      variant: "main",
    });
  });

  it("strips a trailing `/` and asks for the alt variant in the Bracket Trigger", () => {
    const line = "[@foo/";
    expect(
      resolveCitationTrigger(line, line.length, { atTrigger: false }),
    ).toEqual({
      start: 0,
      end: line.length,
      query: "foo",
      variant: "alt",
    });
  });

  it("strips a trailing `/` (before underscore conversion) and asks for the alt variant in the At Trigger", () => {
    const line = "@foo_bar/";
    expect(
      resolveCitationTrigger(line, line.length, { atTrigger: true }),
    ).toEqual({
      start: 0,
      end: line.length,
      query: "foo bar",
      variant: "alt",
    });
  });

  it("fires on a bare `@` with an empty query", () => {
    const line = "@";
    expect(resolveCitationTrigger(line, 1, { atTrigger: true })).toEqual({
      start: 0,
      end: 1,
      query: "",
      variant: "main",
    });
  });

  it("never fires on the full-width `＠`", () => {
    const line = "＠foo";
    expect(
      resolveCitationTrigger(line, line.length, { atTrigger: true }),
    ).toBeNull();
  });

  it("does not fire the At Trigger when at-trigger is disabled, but the Bracket Trigger is unaffected", () => {
    expect(resolveCitationTrigger("@foo", 4, { atTrigger: false })).toBeNull();
    expect(resolveCitationTrigger(" @foo", 5, { atTrigger: false })).toBeNull();

    const bracketLine = "[@foo]";
    expect(
      resolveCitationTrigger(bracketLine, 5, { atTrigger: false }),
    ).toEqual({
      start: 0,
      end: 6,
      query: "foo",
      variant: "main",
    });
  });

  it("ends the At Trigger query at the first space, so trailing content after it never fires", () => {
    const line = "@foo bar";
    expect(
      resolveCitationTrigger(line, line.length, { atTrigger: true }),
    ).toBeNull();
  });
});

describe("a placed citation and the triggers", () => {
  /** The line after `citation` lands at the end of `line`, and the cursor ch. */
  const placeAtEnd = (line: string, citation: string) => {
    const { insert, cursor } = placeInsertion(citation, {
      kind: "citation",
      doc: Text.of([line]),
      range: { from: line.length, to: line.length },
    });
    return { line: `${line}${insert}`, cursor: line.length + cursor };
  };

  it("keeps an unpadded bracketed citation from re-matching either trigger", () => {
    const placed = placeAtEnd("see ", "[@smith2024]");
    expect(placed.line).toBe("see [@smith2024]");
    expect(
      resolveCitationTrigger(placed.line, placed.cursor, { atTrigger: true }),
    ).toBeNull();
  });

  it("keeps the padded alternate format from re-matching the At Trigger", () => {
    const placed = placeAtEnd("see ", "@smith2024");
    expect(
      resolveCitationTrigger(placed.line, placed.cursor, { atTrigger: true }),
    ).toBeNull();
  });
});

describe("Citation Suggester document citations", () => {
  const file = { path: "Draft.md" } as TFile;
  const context = {
    file,
    editor: {} as Editor,
    start: { line: 0, ch: 0 },
    end: { line: 0, ch: 2 },
    query: "",
  } satisfies EditorSuggestContext;

  function setup(read: unknown) {
    const search = vi.fn().mockResolvedValue([]);
    const close = vi.fn();
    const suggest = new CitationEditorSuggest({
      app: {} as App,
      lookup: { openSession: () => ({ search, close }) },
      citationIndex: { getDocumentCitationSet: read },
      settings: { current: Effect.succeed({}) },
      bridge: { runSync: Effect.runSync, runPromise: Effect.runPromise },
    } as unknown as CitationSuggestDeps);
    return { suggest, search, [Symbol.dispose]: () => suggest.close() };
  }

  it("uses the Document Citation Set through comments, math and nested code (#1694)", async () => {
    await using index = await createCitationIndexHarness({
      "draft.md": [
        "%% [@roe2025] %%",
        "$x [@roe2025]$",
        "> [!note] Example",
        "> ~~~",
        "> [@roe2025]",
        "> ~~~",
        "",
        "$5 [@doe2024] x$",
      ].join("\n"),
    });
    const set = await index.index.getDocumentCitationSet(index.draft);
    expect(set.citations.map(({ indexedKey }) => indexedKey)).toEqual([KEY_A]);
    using h = setup(index.index.getDocumentCitationSet.bind(index.index));
    await h.suggest.getSuggestions({ ...context, file: index.draft });
    expect(h.search).toHaveBeenCalledWith("", { limit: 50, cited: [KEY_A] });
  });

  it("reads once per dropdown and skips unresolved keys", async () => {
    const read = vi.fn().mockResolvedValue({
      citations: [
        { indexedKey: "AAAA2222" },
        { indexedKey: null },
        { indexedKey: "BBBB3333g2" },
      ],
    });
    using h = setup(read);
    await h.suggest.getSuggestions(context);
    await h.suggest.getSuggestions({ ...context, query: "Paper" });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(file, {
      signal: expect.any(AbortSignal),
    });
    expect(h.search).toHaveBeenLastCalledWith("Paper", {
      limit: 50,
      cited: ["AAAA2222", "BBBB3333g2"],
    });
    h.suggest.close();
    expect(read.mock.calls[0]![1].signal.aborted).toBe(true);
    await h.suggest.getSuggestions(context);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps the newest hits visible when keystrokes overlap a document read", async () => {
    const document = Promise.withResolvers<{ citations: [] }>();
    await using reads = inProcessReadsService(
      memoryOpener(
        () => `
      insert into libraries (libraryID, type, version, clientVersion)
        values (1, 'user', 1, 0);
      insert into itemTypes (itemTypeID, typeName) values (1, 'journalArticle');
      insert into fieldsCombined (fieldID, fieldName, custom) values (10, 'title', 0);
      insert into itemDataValues (valueID, value) values (1, 'Alpha');
      insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
        values (1, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ALPHA222');
      insert into itemData (itemID, fieldID, valueID) values (1, 10, 1);
    `,
      ).open,
    );
    await using lookup = new ItemLookup({
      runtime: testRuntime(),
      reads,
      useLedger: { uses: {} },
      libraryScope: {
        changed: Stream.empty,
        "libraries-changed": Stream.empty,
        current: {
          mode: "all",
          invalid: false,
          unavailable: [],
          available: [
            { selector: { type: "personal" }, libraryID: 1, name: null },
          ],
        },
      },
    });
    const suggest = new CitationEditorSuggest({
      app: {} as App,
      lookup,
      citationIndex: { getDocumentCitationSet: () => document.promise },
      settings: { current: Effect.succeed({}) },
      bridge: { runSync: Effect.runSync, runPromise: Effect.runPromise },
    } as unknown as CitationSuggestDeps);
    using _close = { [Symbol.dispose]: () => suggest.close() };
    const close = vi.spyOn(suggest, "close");
    // Obsidian consumes every answer and closes the dropdown for an empty list.
    const showSuggestions = (hits: SearchHit[]) => {
      if (hits.length === 0) suggest.close();
      return hits.map((hit) => hit.item.indexedKey);
    };
    const first = suggest
      .getSuggestions({ ...context, query: "missing" })
      .then(showSuggestions);
    const second = suggest
      .getSuggestions({ ...context, query: "Alpha" })
      .then(showSuggestions);
    document.resolve({ citations: [] });

    expect(await Promise.all([first, second])).toEqual([
      ["ALPHA222"],
      ["ALPHA222"],
    ]);
    expect(close).not.toHaveBeenCalled();
  });

  it("keeps searching when document citations fail", async () => {
    using debug = vi.spyOn(getLogger(["views", "citation-suggest"]), "debug");
    const error = new Error("Index unavailable");
    using h = setup(vi.fn().mockRejectedValue(error));
    await h.suggest.getSuggestions(context);
    expect(h.search).toHaveBeenCalledWith("", { limit: 50, cited: [] });
    expect(debug).toHaveBeenCalledWith(expect.any(String), {
      reason: "failed",
      error,
    });
  });

  it("bounds a slow document read and retains the fallback for the session", async () => {
    using debug = vi.spyOn(getLogger(["views", "citation-suggest"]), "debug");
    vi.useFakeTimers();
    using _restore = { [Symbol.dispose]: () => vi.useRealTimers() };
    const read = vi.fn().mockReturnValue(new Promise(() => {}));
    using h = setup(read);
    const pending = h.suggest.getSuggestions(context);
    await vi.advanceTimersByTimeAsync(150);
    await pending;
    expect(debug).toHaveBeenCalledWith(expect.any(String), {
      reason: "timeout",
    });
    expect(h.search).toHaveBeenCalledWith("", { limit: 50, cited: [] });
    expect(read.mock.calls[0]![1].signal.aborted).toBe(true);
    await h.suggest.getSuggestions(context);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("drops a pending answer when the dropdown closes", async () => {
    using debug = vi.spyOn(getLogger(["views", "citation-suggest"]), "debug");
    const read = vi.fn().mockReturnValue(new Promise(() => {}));
    using h = setup(read);
    const pending = h.suggest.getSuggestions(context);
    h.suggest.close();
    await expect(pending).resolves.toEqual([]);
    expect(debug).toHaveBeenCalledWith(expect.any(String), {
      reason: "aborted",
    });
    expect(read.mock.calls[0]![1].signal.aborted).toBe(true);
    expect(h.search).not.toHaveBeenCalled();
  });
});

// Regression tests for #1665: the dropdown kept an earlier query's rows on
// screen until the typed query's answer arrived, and Enter or a click chose
// from them.
describe("Citation Suggester choices while the typed query's answer is pending", () => {
  /** Two Items with one title: their rows read the same. */
  const figures = titled("DMRGRART", "rougier2014");
  const rules = titled("RUGIER24", "rougier2024");

  function titled(indexedKey: string, citationKey: string): SearchHit {
    return {
      item: { key: indexedKey, indexedKey, fields: { citationKey } },
      matches: [],
    } as unknown as SearchHit;
  }

  const enter = { type: "keydown", key: "Enter" } as KeyboardEvent;
  const click = { type: "click", button: 0 } as MouseEvent;

  function setup() {
    let note = "";
    const editor = {
      getValue: () => note,
      posToOffset: ({ ch }: { ch: number }) => ch,
      offsetToPos: (ch: number) => ({ line: 0, ch }),
      replaceRange: (
        text: string,
        from: { ch: number },
        to: { ch: number },
      ) => {
        note = note.slice(0, from.ch) + text + note.slice(to.ch);
      },
      setCursor: () => {},
    } as unknown as Editor;
    const answers = new Map<string, PromiseWithResolvers<SearchHit[]>>();
    const answerTo = (query: string) => {
      let answer = answers.get(query);
      if (!answer) {
        answer = Promise.withResolvers<SearchHit[]>();
        answers.set(query, answer);
      }
      return answer;
    };
    const record = vi.fn();
    const suggest = new CitationEditorSuggest({
      app: {} as App,
      lookup: {
        openSession: () => ({
          search: (query: string) => answerTo(query).promise,
          close: () => {},
        }),
      },
      citationIndex: {
        getDocumentCitationSet: async () => ({ citations: [] }),
      },
      settings: { current: Effect.succeed({}) },
      bridge: { runSync: Effect.runSync, runPromise: Effect.runPromise },
      useLedger: { record },
      ...insertDeps((cites: { citationKey: string }[]) =>
        cites.map(({ citationKey }) => `[@${citationKey}]`).join(""),
      ),
    } as unknown as CitationSuggestDeps);
    const shown = new Map<string, Promise<SearchHit[]>>();
    return {
      suggest,
      note: () => note,
      record,
      /** Types `query` after the trigger; Obsidian asks for its answer. */
      type: (query: string) => {
        note = `[@${query}`;
        const context = {
          file: null,
          editor,
          start: { line: 0, ch: 0 },
          end: { line: 0, ch: note.length },
          query,
        } as unknown as EditorSuggestContext;
        suggest.context = context;
        shown.set(query, suggest.getSuggestions(context));
      },
      /** Answers `query` and waits until its rows show. */
      answer: async (query: string, hits: SearchHit[]) => {
        answerTo(query).resolve(hits);
        await shown.get(query);
      },
      [Symbol.dispose]: () => suggest.close(),
    };
  }

  it("inserts the first row of the typed query's answer when Enter comes before it", async () => {
    using h = setup();
    h.type("");
    await h.answer("", [figures, rules]);
    h.type("ten simple");

    // The empty query's rows are still on screen, DMRGRART first.
    h.suggest.selectSuggestion(figures, enter);
    expect(h.note()).toBe("[@ten simple");

    await h.answer("ten simple", [rules, figures]);
    await vi.waitFor(() => expect(h.note()).toBe("[@rougier2024]"));
    expect(h.record).toHaveBeenCalledWith("RUGIER24", "cited");
  });

  it("drops a click on a row of an earlier query's answer", async () => {
    using h = setup();
    h.type("");
    await h.answer("", [figures, rules]);
    h.type("ten simple");

    h.suggest.selectSuggestion(figures, click);
    h.suggest.selectSuggestion(figures, enter);
    await h.answer("ten simple", [rules, figures]);

    await vi.waitFor(() => expect(h.note()).toBe("[@rougier2024]"));
    expect(h.record.mock.calls).toEqual([["RUGIER24", "cited"]]);
  });
});
