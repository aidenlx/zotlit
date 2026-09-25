import { describe, expect, it } from "vitest";

import { NO_SELECTION, nextCardSelection } from "./card-selection";
import type { CardSelection } from "./card-selection";

/** Five cards, in the order the list shows them. */
const LIST = ["AAAA1111", "BBBB2222", "CCCC3333", "DDDD4444", "EEEE5555"];

const group: CardSelection = {
  selected: ["BBBB2222", "DDDD4444"],
  anchor: "DDDD4444",
};

describe("click", () => {
  it("selects the card alone and sets the anchor on it", () => {
    expect(
      nextCardSelection(NO_SELECTION, LIST, { kind: "click", key: "CCCC3333" }),
    ).toEqual({ selected: ["CCCC3333"], anchor: "CCCC3333" });
  });

  it("selects a card of a group alone", () => {
    expect(
      nextCardSelection(group, LIST, { kind: "click", key: "BBBB2222" }),
    ).toEqual({ selected: ["BBBB2222"], anchor: "BBBB2222" });
  });

  it("leaves the selection where the list does not show the card", () => {
    expect(
      nextCardSelection(group, ["AAAA1111", "BBBB2222", "DDDD4444"], {
        kind: "click",
        key: "CCCC3333",
      }),
    ).toBe(group);
  });

  it("answers the selection itself for a click on the card already selected alone", () => {
    const alone: CardSelection = { selected: ["CCCC3333"], anchor: "CCCC3333" };
    expect(
      nextCardSelection(alone, LIST, { kind: "click", key: "CCCC3333" }),
    ).toBe(alone);
  });
});

describe("clear", () => {
  it("drops every card and the anchor", () => {
    expect(nextCardSelection(group, LIST, { kind: "clear" })).toEqual({
      selected: [],
      anchor: null,
    });
  });

  it("answers the selection itself when nothing is selected", () => {
    expect(nextCardSelection(NO_SELECTION, LIST, { kind: "clear" })).toBe(
      NO_SELECTION,
    );
  });
});

describe("prune", () => {
  it("drops the cards a filter hides and keeps the anchor where it was", () => {
    const filtered = ["AAAA1111", "DDDD4444", "EEEE5555"];
    expect(nextCardSelection(group, filtered, { kind: "prune" })).toEqual({
      selected: ["DDDD4444"],
      anchor: "DDDD4444",
    });
    expect(
      nextCardSelection(group, ["AAAA1111", "BBBB2222"], { kind: "prune" }),
    ).toEqual({ selected: ["BBBB2222"], anchor: "DDDD4444" });
  });

  it("answers the selection itself when the list still shows every card", () => {
    expect(
      nextCardSelection(group, ["BBBB2222", "DDDD4444"], { kind: "prune" }),
    ).toBe(group);
  });
});

describe("replace", () => {
  it("takes every pushed card the list shows, in list order, anchored on the first", () => {
    expect(
      nextCardSelection(group, LIST, {
        kind: "replace",
        keys: ["EEEE5555", "AAAA1111"],
      }),
    ).toEqual({ selected: ["AAAA1111", "EEEE5555"], anchor: "AAAA1111" });
  });

  it("leaves out a pushed card the list does not show", () => {
    expect(
      nextCardSelection(NO_SELECTION, ["AAAA1111", "CCCC3333"], {
        kind: "replace",
        keys: ["CCCC3333", "ZZZZ9999", "BBBB2222"],
      }),
    ).toEqual({ selected: ["CCCC3333"], anchor: "CCCC3333" });
  });

  it("clears the selection for a push of no cards", () => {
    expect(
      nextCardSelection(group, LIST, { kind: "replace", keys: [] }),
    ).toEqual(NO_SELECTION);
  });

  it("answers the selection itself for a push that echoes it", () => {
    const alone: CardSelection = { selected: ["CCCC3333"], anchor: "CCCC3333" };
    expect(
      nextCardSelection(alone, LIST, { kind: "replace", keys: ["CCCC3333"] }),
    ).toBe(alone);
  });
});
