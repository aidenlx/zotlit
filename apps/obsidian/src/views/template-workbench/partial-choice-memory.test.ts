import { describe, expect, it } from "vitest";

import {
  DEFAULT_PARTIAL_CHOICE,
  readPartialChoice,
  writePartialChoice,
} from "./partial-choice-memory";
import type { PartialChoiceStore } from "./partial-choice-memory";

function device(): PartialChoiceStore & { held: Map<string, unknown> } {
  const held = new Map<string, unknown>();
  return {
    held,
    loadLocalStorage: (key: string) => held.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => {
      held.set(key, value);
    },
  };
}

const AUTHORS = "templates/zotlit-partial.authors.md";
const VENUE = "templates/zotlit-partial.venue-line.md";

describe("partial choice memory", () => {
  it("answers the default for a path it holds nothing for", () => {
    expect(readPartialChoice(device(), AUTHORS)).toEqual(
      DEFAULT_PARTIAL_CHOICE,
    );
  });

  it("holds one partial's choice without touching another's", () => {
    const store = device();

    writePartialChoice(store, AUTHORS, {
      context: "citation",
      profile: "reading1",
    });

    expect(readPartialChoice(store, AUTHORS)).toEqual({
      context: "citation",
      profile: "reading1",
    });
    expect(readPartialChoice(store, VENUE)).toEqual(DEFAULT_PARTIAL_CHOICE);
  });

  it("forgets a partial the reader put back on the default caller", () => {
    const store = device();
    writePartialChoice(store, AUTHORS, {
      context: "annotation",
      profile: null,
    });

    writePartialChoice(store, AUTHORS, DEFAULT_PARTIAL_CHOICE);

    expect(readPartialChoice(store, AUTHORS)).toEqual(DEFAULT_PARTIAL_CHOICE);
    expect(store.held.get("zotlit-partial-choice")).toEqual({});
  });

  it("keeps an unsaved document out of the store, which has no path to key on", () => {
    const store = device();

    writePartialChoice(store, null, { context: "citation", profile: null });

    expect(readPartialChoice(store, null)).toEqual(DEFAULT_PARTIAL_CHOICE);
    expect(store.held.size).toBe(0);
  });

  it("answers the default for a stored value it cannot read", () => {
    const store = device();
    store.held.set("zotlit-partial-choice", "not an object");

    expect(readPartialChoice(store, AUTHORS)).toEqual(DEFAULT_PARTIAL_CHOICE);

    store.held.set("zotlit-partial-choice", {
      [AUTHORS]: { context: "note-ish" },
    });

    expect(readPartialChoice(store, AUTHORS)).toEqual(DEFAULT_PARTIAL_CHOICE);
  });
});
