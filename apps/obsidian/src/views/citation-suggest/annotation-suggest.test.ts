// @vitest-environment happy-dom
import { Effect } from "effect";
import type { App, Editor, EditorSuggestContext } from "obsidian";
import { describe, expect, it } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import { AnnotationEditorSuggest } from "./annotation-suggest";
import type { AnnotationSuggestDeps } from "./annotation-suggest";
import {
  annotationTriggerError,
  annotationTriggerProblem,
  resolveAnnotationTrigger,
} from "./annotation-trigger";
import { resolveCitationTrigger } from "./editor-suggest";

const at = (line: string, ch = line.length, trigger = "[>") =>
  resolveAnnotationTrigger(line, ch, { trigger });

describe("Annotation Suggester trigger", () => {
  it("opens on the default trigger, which no citation trigger claims", () => {
    const trigger = defaults["citation.annotation-trigger"];
    expect(annotationTriggerProblem(trigger)).toBeNull();
    expect(resolveAnnotationTrigger("[>fig", 5, { trigger })).toEqual({
      start: 0,
      end: 5,
      query: "fig",
    });
  });

  it("opens on the trigger with the text after it as the query", () => {
    expect(at("As shown [>attention")).toEqual({
      start: 9,
      end: 20,
      query: "attention",
    });
  });

  it("keeps spaces and tokens in the query", () => {
    expect(at('[>fig tag:"to read" color:red')).toEqual({
      start: 0,
      end: 29,
      query: 'fig tag:"to read" color:red',
    });
  });

  it("consumes the closing bracket Obsidian pairs with [", () => {
    const line = "see [>fig]";
    expect(at(line, line.length - 1)).toEqual({
      start: 4,
      end: 10,
      query: "fig",
    });
  });

  it("opens on an empty query", () => {
    expect(at("[>")).toEqual({ start: 0, end: 2, query: "" });
  });

  it("stays closed once a closing bracket ends the query", () => {
    expect(at("[>fig] and more")).toBeNull();
  });

  it.each(["[@smith", "plain text"])(
    "stays closed for %j, which is not its trigger",
    (line) => {
      expect(at(line)).toBeNull();
    },
  );

  it.each(["[>smith", "[>"])(
    "leaves %j to the Annotation Suggester: the Citation Suggester stays closed",
    (line) => {
      expect(
        resolveCitationTrigger(line, line.length, { atTrigger: true }),
      ).toBeNull();
    },
  );

  it("follows a custom trigger", () => {
    expect(at("quote ;;fig", undefined, ";;")).toEqual({
      start: 6,
      end: 11,
      query: "fig",
    });
    expect(at("quote [>fig", undefined, ";;")).toBeNull();
    // A trigger that opens no bracket leaves a bracket after the cursor.
    expect(at("[;;fig]", 6, ";;")).toEqual({ start: 1, end: 6, query: "fig" });
  });

  it.each(["", "a b", "@", "[", "[[x"])(
    "stays closed under the unusable trigger %j",
    (trigger) => {
      expect(at(`${trigger}fig`, undefined, trigger)).toBeNull();
    },
  );
});

describe("AnnotationEditorSuggest", () => {
  function setup(
    settings: Partial<Settings> | undefined,
    run: AnnotationSuggestDeps["query"]["run"] = async () => ({
      kind: "cancelled",
    }),
    commentRenderer?: AnnotationSuggestDeps["commentRenderer"],
  ) {
    const suggest = new AnnotationEditorSuggest(
      stubService<AnnotationSuggestDeps>("AnnotationSuggestDeps", {
        app: stubService<App>("App", {}),
        settings: { current: Effect.succeed({ ...defaults, ...settings }) },
        bridge: { runSync: Effect.runSync, runPromise: Effect.runPromise },
        query: { run },
        commentRenderer: commentRenderer ?? (() => () => () => {}),
      }),
    );
    return { suggest, [Symbol.dispose]: () => suggest.close() };
  }
  const editor = (line: string) =>
    stubService<Editor>("Editor", { getLine: () => line });
  const trigger = (s: AnnotationEditorSuggest, line: string) =>
    s.onTrigger({ line: 0, ch: line.length }, editor(line), null);

  it("opens on the trigger the setting names, and the default before settings load", () => {
    {
      using h = setup(undefined);
      expect(trigger(h.suggest, "x [>fig")).toEqual({
        start: { line: 0, ch: 2 },
        end: { line: 0, ch: 7 },
        query: "fig",
      });
    }
    {
      using h = setup({ "citation.annotation-trigger": ";;" });
      expect(trigger(h.suggest, "x [>fig")).toBeNull();
      expect(trigger(h.suggest, "x ;;fig")?.query).toBe("fig");
    }
  });

  it("stays closed when the setting is empty", () => {
    using h = setup({ "citation.annotation-trigger": "" });
    expect(trigger(h.suggest, "x [>fig")).toBeNull();
  });

  /**
   * ZotLit Query as the suggester reaches it: a search for one word answers
   * one paper and two annotations named after the word, once `release(word)`
   * lets it finish, and answers `cancelled` for a search aborted meanwhile,
   * as the query worker does.
   */
  function gatedQuery() {
    const gates = new Map<string, PromiseWithResolvers<void>>();
    const gate = (word: string) => {
      let held = gates.get(word);
      if (!held) {
        held = Promise.withResolvers<void>();
        gates.set(word, held);
      }
      return held;
    };
    const run: AnnotationSuggestDeps["query"]["run"] = async (
      request,
      signal,
    ) => {
      const word =
        /contains\("([^"]*)"\)/.exec(request.filter ?? "")?.[1] ?? "";
      await gate(word).promise;
      if (signal.aborted) return { kind: "cancelled" };
      if (request.from === "items")
        return {
          kind: "result",
          result: {
            libraries: [],
            query: { filter: null, fields: [], sort: [], limit: null },
            returnedCount: 1,
            matchedCount: 1,
            truncated: false,
            warnings: [],
            rows: [{ indexedKey: "PAPER", values: {} }],
          },
        };
      return {
        kind: "result",
        result: {
          libraries: [],
          query: { filter: null, fields: [], sort: [], limit: null },
          returnedCount: 2,
          matchedCount: 2,
          truncated: false,
          warnings: [],
          groups: [
            {
              value: "PAPER",
              count: 2,
              rows: [`${word}-1`, `${word}-2`].map((key) => ({
                indexedKey: key,
                attachmentIndexedKey: "PDF",
                itemIndexedKey: "PAPER",
                values: { comment: key },
              })),
            },
          ],
          totalCount: 2,
        },
      };
    };
    return { run, release: (word: string) => gate(word).resolve() };
  }

  it("drops the search of the keystroke before, and the live one as it closes", async () => {
    const query = gatedQuery();
    using h = setup({}, query.run);
    const context = stubService<EditorSuggestContext>("EditorSuggestContext", {
      file: undefined,
      editor: editor(""),
      start: { line: 0, ch: 0 },
      end: { line: 0, ch: 2 },
    });
    const keys = async (hits: Promise<{ key: string }[] | null>) =>
      (await hits)?.map(({ key }) => key) ?? null;

    // The next keystroke's search starts while the first is still running.
    const before = keys(h.suggest.getSuggestions({ ...context, query: "fi" }));
    const typed = keys(h.suggest.getSuggestions({ ...context, query: "fig" }));
    query.release("fig");
    query.release("fi");

    await expect(typed).resolves.toEqual(["fig-1", "fig-2"]);
    // A dropped search answers `null`, which Obsidian skips; `[]` would close
    // the popup while the typed query's answer is pending (#1665).
    await expect(before).resolves.toBeNull();

    const closing = keys(
      h.suggest.getSuggestions({ ...context, query: "figure" }),
    );
    h.suggest.close();
    query.release("figure");

    await expect(closing).resolves.toBeNull();
  });

  /**
   * The suggester over {@link gatedQuery}, drawing each row it finds. Obsidian's
   * Markdown renderer, which draws a row's comment, stands outside the test:
   * `live` holds every comment drawn and not yet let go.
   */
  function drawing() {
    const query = gatedQuery();
    const live = new Set<string>();
    const h = setup({}, query.run, () => (el, html) => {
      live.add(html);
      el.setText(html);
      return () => live.delete(html);
    });
    const show = async (word: string) => {
      query.release(word);
      const hits = await h.suggest.getSuggestions(
        stubService<EditorSuggestContext>("EditorSuggestContext", {
          query: word,
          file: undefined,
          editor: editor(""),
          start: { line: 0, ch: 0 },
          end: { line: 0, ch: 0 },
        }),
      );
      for (const hit of hits)
        h.suggest.renderSuggestion(hit, document.createElement("div"));
    };
    return { ...h, live, show };
  }

  it("lets go of the comments of the rows a new search replaces", async () => {
    using h = drawing();
    await h.show("fig");
    expect([...h.live].toSorted()).toEqual(["fig-1", "fig-2"]);

    await h.show("table");

    expect([...h.live].toSorted()).toEqual(["table-1", "table-2"]);
  });

  it("lets go of every drawn comment as it closes", async () => {
    using h = drawing();
    await h.show("fig");

    h.suggest.close();

    expect([...h.live]).toEqual([]);
  });
});

describe("annotationTriggerProblem", () => {
  it.each(["[>", "[!q"])("accepts %j", (trigger) => {
    expect(annotationTriggerProblem(trigger)).toBeNull();
  });

  it.each([
    ["", "empty"],
    ["a b", "whitespace"],
    ["@", "citation"],
    ["[", "citation"],
    ["[[x", "citation"],
  ] as const)("rejects %j as %s", (trigger, problem) => {
    expect(annotationTriggerProblem(trigger)).toBe(problem);
  });

  it("explains a rejected trigger in settings, and lets empty turn it off", () => {
    expect(annotationTriggerError("[@")).toBe(
      m.settings_citation_annotation_trigger_citation(),
    );
    expect(annotationTriggerError("a b")).toBe(
      m.settings_citation_annotation_trigger_whitespace(),
    );
    expect(annotationTriggerError("")).toBeUndefined();
    expect(annotationTriggerError("[>")).toBeUndefined();
  });
});
