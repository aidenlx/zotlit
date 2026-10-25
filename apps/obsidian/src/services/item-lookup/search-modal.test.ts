// Regression tests for #1650: Enter in an Item picker chose a row of an
// earlier query's answer while the typed query's answer was pending.
import { Effect } from "effect";
import { SuggestModal } from "obsidian";
import type { App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { defaults as defaultSettings } from "@/services/settings/schema";
import type { PluginSettings } from "@/services/settings/service";

import { ItemSearchModal, pickItem } from "./search-modal";
import type { ItemSearchDeps } from "./search-modal";
import type { SearchHit, SearchSession } from "./service";

/** Two Items with one title: their rows read the same. */
const figures = hit("DMRGRART");
const rules = hit("RUGIER24");

function hit(indexedKey: string): SearchHit {
  return { item: { indexedKey } } as unknown as SearchHit;
}

const enterEvent = {
  key: "Enter",
  type: "keydown",
  isComposing: false,
} as KeyboardEvent;
const click = { button: 0, type: "click" } as MouseEvent;

class TestModal extends ItemSearchModal {
  readonly chosen: string[] = [];

  override onChooseSuggestion(chosen: SearchHit): void {
    this.chosen.push(chosen.item.indexedKey);
  }
}

/** Searches that answer when the test resolves them. */
function searches() {
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
  const deps: ItemSearchDeps = {
    app: stubService<App>("App", {}),
    lookup: { openSession: () => session },
    settings: stubService<Pick<PluginSettings["Service"], "current">>(
      "PluginSettings",
      {
        current: Effect.succeed(defaultSettings),
      },
    ),
    bridge: { runSync: Effect.runSync },
  };
  return { answers, deps };
}

/** Drives an open modal as Obsidian does. */
function driver(
  modal: ItemSearchModal,
  answers: Map<string, PromiseWithResolvers<SearchHit[]>>,
) {
  const shown = new Map<string, Promise<SearchHit[]>>();
  return {
    /** Types `query`; Obsidian shows the rows once its answer settles. */
    type: (query: string) => {
      shown.set(query, Promise.resolve(modal.getSuggestions(query)));
    },
    /** Answers `query` and waits until its rows show. */
    answer: async (query: string, hits: SearchHit[]) => {
      answers.get(query)!.resolve(hits);
      await shown.get(query);
    },
    /** Presses Enter through the modal's key scope. */
    enter: () => {
      const { handlers } = modal.scope as unknown as {
        handlers: {
          modifiers: string[] | null;
          key: string | null;
          func: (evt: KeyboardEvent) => unknown;
        }[];
      };
      const handler = handlers.find(
        (h) => h.key === "Enter" && h.modifiers?.length === 0,
      );
      handler!.func(enterEvent);
    },
  };
}

function setup() {
  const { answers, deps } = searches();
  const modal = new TestModal(deps);
  modal.onOpen();
  return { modal, ...driver(modal, answers) };
}

describe("ItemSearchModal", () => {
  it("chooses a row at once when its answer is the typed query's", async () => {
    const { modal, type, answer } = setup();
    type("ten simple");
    await answer("ten simple", [rules, figures]);

    modal.selectSuggestion(figures, click);

    expect(modal.chosen).toEqual(["DMRGRART"]);
  });

  it("chooses the first row of the typed query's answer when Enter comes before it", async () => {
    const { modal, type, answer, enter } = setup();
    type("");
    await answer("", [figures, rules]);
    type("ten simple");

    // The empty query's rows are still on screen, DMRGRART first.
    enter();
    expect(modal.chosen).toEqual([]);

    await answer("ten simple", [rules, figures]);
    expect(modal.chosen).toEqual(["RUGIER24"]);
  });

  it("waits on Enter before the first answer, while the list has no row", async () => {
    const { modal, type, answer, enter } = setup();
    type("ten simple");

    enter();
    await answer("ten simple", [rules, figures]);

    expect(modal.chosen).toEqual(["RUGIER24"]);
  });

  it("waits on Enter after an answer with no hits, while the list has no row", async () => {
    const { modal, type, answer, enter } = setup();
    type("ten simpl");
    await answer("ten simpl", []);
    type("ten simple");

    enter();
    await answer("ten simple", [rules, figures]);

    expect(modal.chosen).toEqual(["RUGIER24"]);
  });

  it("waits for the last query typed before the answer", async () => {
    const { modal, type, answer, enter } = setup();
    type("");
    await answer("", [figures, rules]);
    type("ten");
    enter();
    type("ten simple");

    await answer("ten", [figures, rules]);
    await answer("ten simple", [rules, figures]);

    expect(modal.chosen).toEqual(["RUGIER24"]);
  });

  it("drops a click on a row of an earlier query's answer", async () => {
    const { modal, type, answer } = setup();
    type("");
    await answer("", [figures, rules]);
    type("ten simple");

    modal.selectSuggestion(figures, click);
    await answer("ten simple", [rules, figures]);

    expect(modal.chosen).toEqual([]);
  });

  it("chooses nothing when the modal closes before the answer", async () => {
    const { modal, type, answer, enter } = setup();
    type("");
    await answer("", [figures, rules]);
    type("ten simple");
    enter();

    modal.close();
    await answer("ten simple", [rules, figures]);

    expect(modal.chosen).toEqual([]);
  });
});

describe("pickItem", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Opens the picker and hands back the modal it opened. */
  function openPicker() {
    const { answers, deps } = searches();
    let opened: ItemSearchModal | undefined;
    vi.spyOn(SuggestModal.prototype, "open").mockImplementation(function (
      this: SuggestModal<SearchHit>,
    ) {
      opened = this as unknown as ItemSearchModal;
      opened.onOpen();
    });
    const picked = pickItem(deps, "Pick an Item");
    return { picked, modal: opened!, ...driver(opened!, answers) };
  }

  it("resolves to the first row of the typed query's answer after Enter waited for it", async () => {
    const { picked, type, answer, enter } = openPicker();
    type("");
    await answer("", [figures, rules]);
    type("ten simple");
    enter();

    await answer("ten simple", [rules, figures]);

    await expect(picked).resolves.toBe(rules);
  });

  it("resolves to null when the picker closes while Enter waits", async () => {
    const { picked, modal, type, answer, enter } = openPicker();
    type("ten simple");
    enter();

    modal.close();
    await answer("ten simple", [rules, figures]);

    await expect(picked).resolves.toBeNull();
  });

  it("resolves to null when a click on a row of an earlier answer is dropped and the picker closes", async () => {
    const { picked, modal, type, answer } = openPicker();
    type("");
    await answer("", [figures, rules]);
    type("ten simple");

    modal.selectSuggestion(figures, click);
    modal.close();

    await expect(picked).resolves.toBeNull();
  });
});
