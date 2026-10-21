import type { App } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SettingsService } from "@/services/settings/service";

import { ItemSearchModal } from "./search-modal";
import type { SearchHit, SearchSession } from "./service";

/** Two Items with one title: their rows read the same. */
const figures = hit("DMRGRART");
const rules = hit("RUGIER24");

function hit(indexedKey: string): SearchHit {
  return { item: { indexedKey } } as unknown as SearchHit;
}

const enter = { key: "Enter", type: "keydown" } as KeyboardEvent;
const click = { button: 0, type: "click" } as MouseEvent;

class TestModal extends ItemSearchModal {
  readonly chosen: string[] = [];

  override onChooseSuggestion(chosen: SearchHit): void {
    this.chosen.push(chosen.item.indexedKey);
  }
}

/** A modal whose searches answer when the test resolves them. */
function setup() {
  const answers = new Map<string, PromiseWithResolvers<SearchHit[]>>();
  const session: SearchSession = {
    search: (query) => {
      const answer = Promise.withResolvers<SearchHit[]>();
      answers.set(query, answer);
      return answer.promise;
    },
    close: () => undefined,
    [Symbol.dispose]: () => undefined,
  };
  const modal = new TestModal({
    app: {} as App,
    lookup: { openSession: () => session },
    settings: {} as SettingsService,
  });
  modal.onOpen();
  /** Types `query`; Obsidian then shows the rows its answer resolves with. */
  const type = (query: string) => modal.getSuggestions(query);
  const answer = async (query: string, hits: SearchHit[]) => {
    answers.get(query)!.resolve(hits);
    await vi.advanceTimersByTimeAsync(0);
  };
  return { modal, type, answer };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ItemSearchModal", () => {
  it("chooses a row at once when its answer is the typed query's", async () => {
    const { modal, type, answer } = setup();
    void type("ten simple");
    await answer("ten simple", [rules, figures]);

    modal.selectSuggestion(figures, enter);

    expect(modal.chosen).toEqual(["DMRGRART"]);
  });

  it("chooses the first row of the typed query's answer when Enter comes before it", async () => {
    const { modal, type, answer } = setup();
    void type("");
    await answer("", [figures, rules]);
    void type("ten simple");

    // Enter acts on a row of the empty query's answer, still on screen.
    modal.selectSuggestion(figures, enter);
    expect(modal.chosen).toEqual([]);

    await answer("ten simple", [rules, figures]);
    expect(modal.chosen).toEqual(["RUGIER24"]);
  });

  it("waits for the last query typed before Enter", async () => {
    const { modal, type, answer } = setup();
    void type("");
    await answer("", [figures, rules]);
    void type("ten");
    modal.selectSuggestion(figures, enter);
    void type("ten simple");

    await answer("ten", [figures, rules]);
    expect(modal.chosen).toEqual([]);

    await answer("ten simple", [rules, figures]);
    expect(modal.chosen).toEqual(["RUGIER24"]);
  });

  it("ignores a click on a row of an earlier query's answer", async () => {
    const { modal, type, answer } = setup();
    void type("");
    await answer("", [figures, rules]);
    void type("ten simple");

    modal.selectSuggestion(figures, click);
    await answer("ten simple", [rules, figures]);

    expect(modal.chosen).toEqual([]);
  });

  it("chooses nothing when the modal closes before the answer", async () => {
    const { modal, type, answer } = setup();
    void type("");
    await answer("", [figures, rules]);
    void type("ten simple");
    modal.selectSuggestion(figures, enter);

    modal.close();
    await answer("ten simple", [rules, figures]);

    expect(modal.chosen).toEqual([]);
  });
});
