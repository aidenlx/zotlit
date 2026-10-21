import type { App, Editor, EditorSuggestContext } from "obsidian";
import { describe, expect, it } from "vitest";

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
  ) {
    const suggest = new AnnotationEditorSuggest({
      app: {} as App,
      settings: { current: settings as Settings | undefined },
      query: { run },
    } as AnnotationSuggestDeps);
    return { suggest, [Symbol.dispose]: () => suggest.close() };
  }
  const editor = (line: string) =>
    ({ getLine: () => line }) as unknown as Editor;
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

  it("stops the search of the keystroke before", async () => {
    const signals: AbortSignal[] = [];
    using h = setup({}, async (_request, signal) => {
      signals.push(signal);
      return { kind: "cancelled" };
    });
    const context = {
      file: null,
      editor: editor(""),
      start: { line: 0, ch: 0 },
      end: { line: 0, ch: 2 },
    } as unknown as EditorSuggestContext;
    await h.suggest.getSuggestions({ ...context, query: "fi" });
    await h.suggest.getSuggestions({ ...context, query: "fig" });
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    h.suggest.close();
    expect(signals[1]!.aborted).toBe(true);
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
