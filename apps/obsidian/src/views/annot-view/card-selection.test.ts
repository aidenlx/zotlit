import { describe, expect, it } from "vitest";

import { NO_SELECTION, nextCardSelection } from "./card-selection";
import type { CardSelection } from "./card-selection";

/** Five cards, in the order the list shows them. */
const LIST = ["AAAA1111", "BBBB2222", "CCCC3333", "DDDD4444", "EEEE5555"];

const group: CardSelection = {
  selected: ["BBBB2222", "DDDD4444"],
  anchor: "DDDD4444",
  focus: "DDDD4444",
};

describe("click", () => {
  it("selects the card alone and sets the anchor on it", () => {
    expect(
      nextCardSelection(NO_SELECTION, LIST, { kind: "click", key: "CCCC3333" }),
    ).toEqual({
      selected: ["CCCC3333"],
      anchor: "CCCC3333",
      focus: "CCCC3333",
    });
  });

  it("selects a card of a group alone", () => {
    expect(
      nextCardSelection(group, LIST, { kind: "click", key: "BBBB2222" }),
    ).toEqual({
      selected: ["BBBB2222"],
      anchor: "BBBB2222",
      focus: "BBBB2222",
    });
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
    const alone: CardSelection = {
      selected: ["CCCC3333"],
      anchor: "CCCC3333",
      focus: "CCCC3333",
    };
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
      focus: null,
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
      focus: "DDDD4444",
    });
    expect(
      nextCardSelection(group, ["AAAA1111", "BBBB2222"], { kind: "prune" }),
    ).toEqual({
      selected: ["BBBB2222"],
      anchor: "DDDD4444",
      focus: "DDDD4444",
    });
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
    ).toEqual({
      selected: ["AAAA1111", "EEEE5555"],
      anchor: "AAAA1111",
      focus: "AAAA1111",
    });
  });

  it("leaves out a pushed card the list does not show", () => {
    expect(
      nextCardSelection(NO_SELECTION, ["AAAA1111", "CCCC3333"], {
        kind: "replace",
        keys: ["CCCC3333", "ZZZZ9999", "BBBB2222"],
      }),
    ).toEqual({
      selected: ["CCCC3333"],
      anchor: "CCCC3333",
      focus: "CCCC3333",
    });
  });

  it("clears the selection for a push of no cards", () => {
    expect(
      nextCardSelection(group, LIST, { kind: "replace", keys: [] }),
    ).toEqual(NO_SELECTION);
  });

  it("answers the selection itself for a push that echoes it", () => {
    const alone: CardSelection = {
      selected: ["CCCC3333"],
      anchor: "CCCC3333",
      focus: "CCCC3333",
    };
    expect(
      nextCardSelection(alone, LIST, { kind: "replace", keys: ["CCCC3333"] }),
    ).toBe(alone);
  });
});

describe("replace, of the cards already selected", () => {
  it("puts the anchor on the first pushed card in list order", () => {
    // A Zotero push of the group the view already holds, in another order.
    expect(
      nextCardSelection(group, LIST, {
        kind: "replace",
        keys: ["DDDD4444", "BBBB2222"],
      }),
    ).toEqual({
      selected: ["BBBB2222", "DDDD4444"],
      anchor: "BBBB2222",
      focus: "BBBB2222",
    });
  });
});

describe("move", () => {
  const down = { kind: "move", step: 1 } as const;
  const up = { kind: "move", step: -1 } as const;
  const alone = (key: string): CardSelection => ({
    selected: [key],
    anchor: key,
    focus: key,
  });

  it("takes the next or the previous card in list order alone", () => {
    expect(nextCardSelection(alone("BBBB2222"), LIST, down)).toEqual(
      alone("CCCC3333"),
    );
    expect(nextCardSelection(alone("BBBB2222"), LIST, up)).toEqual(
      alone("AAAA1111"),
    );
  });

  it("stays on the card at either end of the list", () => {
    const last = alone("EEEE5555");
    expect(nextCardSelection(last, LIST, down)).toBe(last);
    const first = alone("AAAA1111");
    expect(nextCardSelection(first, LIST, up)).toBe(first);
  });

  it("reduces a group to the card at the end it cannot pass", () => {
    const toEnd: CardSelection = {
      selected: ["BBBB2222", "EEEE5555"],
      anchor: "EEEE5555",
      focus: "EEEE5555",
    };
    expect(nextCardSelection(toEnd, LIST, down)).toEqual(alone("EEEE5555"));
  });

  it("steps from the anchor of a group, not from its first card", () => {
    expect(nextCardSelection(group, LIST, down)).toEqual(alone("EEEE5555"));
    expect(nextCardSelection(group, LIST, up)).toEqual(alone("CCCC3333"));
  });

  it("enters the list at the first card on ↓ and the last on ↑", () => {
    expect(nextCardSelection(NO_SELECTION, LIST, down)).toEqual(
      alone("AAAA1111"),
    );
    expect(nextCardSelection(NO_SELECTION, LIST, up)).toEqual(
      alone("EEEE5555"),
    );
  });

  it("answers the selection itself for an empty list", () => {
    expect(nextCardSelection(NO_SELECTION, [], down)).toBe(NO_SELECTION);
  });

  it("passes over the cards a filter hides", () => {
    const filtered = ["AAAA1111", "BBBB2222", "EEEE5555"];
    expect(nextCardSelection(alone("BBBB2222"), filtered, down)).toEqual(
      alone("EEEE5555"),
    );
    expect(nextCardSelection(alone("EEEE5555"), filtered, up)).toEqual(
      alone("BBBB2222"),
    );
  });

  it("steps from the first Selected Card where a filter hides the anchor", () => {
    // A prune keeps the anchor on a card the list no longer shows.
    const pruned: CardSelection = {
      selected: ["DDDD4444"],
      anchor: "BBBB2222",
      focus: "BBBB2222",
    };
    const filtered = ["AAAA1111", "CCCC3333", "DDDD4444", "EEEE5555"];
    expect(nextCardSelection(pruned, filtered, down)).toEqual(
      alone("EEEE5555"),
    );
    expect(nextCardSelection(pruned, filtered, up)).toEqual(alone("CCCC3333"));
  });

  it("enters the list afresh where a filter hides the anchor and every Selected Card", () => {
    const hidden: CardSelection = {
      selected: [],
      anchor: "BBBB2222",
      focus: "BBBB2222",
    };
    const filtered = ["AAAA1111", "CCCC3333"];
    expect(nextCardSelection(hidden, filtered, down)).toEqual(
      alone("AAAA1111"),
    );
    expect(nextCardSelection(hidden, filtered, up)).toEqual(alone("CCCC3333"));
  });
});

describe("toggle", () => {
  it("adds a card in list order and sets the anchor on it", () => {
    expect(
      nextCardSelection(group, LIST, { kind: "toggle", key: "AAAA1111" }),
    ).toEqual({
      selected: ["AAAA1111", "BBBB2222", "DDDD4444"],
      anchor: "AAAA1111",
      focus: "AAAA1111",
    });
  });

  it("removes a Selected Card and sets the anchor on it", () => {
    expect(
      nextCardSelection(group, LIST, { kind: "toggle", key: "BBBB2222" }),
    ).toEqual({
      selected: ["DDDD4444"],
      anchor: "BBBB2222",
      focus: "BBBB2222",
    });
  });

  it("leaves the selection where the list does not show the card", () => {
    expect(
      nextCardSelection(group, ["BBBB2222", "DDDD4444"], {
        kind: "toggle",
        key: "CCCC3333",
      }),
    ).toBe(group);
  });
});

describe("range", () => {
  it("takes every card from the anchor to the card, in list order, and keeps the anchor", () => {
    const alone: CardSelection = {
      selected: ["DDDD4444"],
      anchor: "DDDD4444",
      focus: "DDDD4444",
    };
    expect(
      nextCardSelection(alone, LIST, { kind: "range", key: "BBBB2222" }),
    ).toEqual({
      selected: ["BBBB2222", "CCCC3333", "DDDD4444"],
      anchor: "DDDD4444",
      focus: "BBBB2222",
    });
  });

  it("measures from the card a toggle anchored, and drops the cards outside the range", () => {
    const clicked = nextCardSelection(NO_SELECTION, LIST, {
      kind: "click",
      key: "AAAA1111",
    });
    const toggled = nextCardSelection(clicked, LIST, {
      kind: "toggle",
      key: "CCCC3333",
    });
    expect(
      nextCardSelection(toggled, LIST, { kind: "range", key: "EEEE5555" }),
    ).toEqual({
      selected: ["CCCC3333", "DDDD4444", "EEEE5555"],
      anchor: "CCCC3333",
      focus: "EEEE5555",
    });
  });

  it("measures from the first Selected Card where a filter hid the anchor", () => {
    const pruned = nextCardSelection(
      {
        selected: ["BBBB2222", "DDDD4444"],
        anchor: "BBBB2222",
        focus: "BBBB2222",
      },
      ["AAAA1111", "CCCC3333", "DDDD4444", "EEEE5555"],
      { kind: "prune" },
    );
    expect(pruned).toEqual({
      selected: ["DDDD4444"],
      anchor: "BBBB2222",
      focus: "BBBB2222",
    });
    // The range reaches no card between the hidden anchor and the click.
    expect(
      nextCardSelection(
        pruned,
        ["AAAA1111", "CCCC3333", "DDDD4444", "EEEE5555"],
        {
          kind: "range",
          key: "AAAA1111",
        },
      ),
    ).toEqual({
      selected: ["AAAA1111", "CCCC3333", "DDDD4444"],
      anchor: "DDDD4444",
      focus: "AAAA1111",
    });
  });

  it("selects the card alone where a filter hid the anchor and every Selected Card", () => {
    const hidden: CardSelection = {
      selected: [],
      anchor: "BBBB2222",
      focus: "BBBB2222",
    };
    expect(
      nextCardSelection(hidden, ["AAAA1111", "CCCC3333"], {
        kind: "range",
        key: "CCCC3333",
      }),
    ).toEqual({
      selected: ["CCCC3333"],
      anchor: "CCCC3333",
      focus: "CCCC3333",
    });
  });
});

describe("all", () => {
  it("takes every card the list shows and keeps the anchor", () => {
    expect(
      nextCardSelection(group, ["AAAA1111", "DDDD4444"], { kind: "all" }),
    ).toEqual({
      selected: ["AAAA1111", "DDDD4444"],
      anchor: "DDDD4444",
      focus: "DDDD4444",
    });
  });

  it("answers the selection itself where every card is selected", () => {
    const everything: CardSelection = { ...group, selected: LIST };
    expect(nextCardSelection(everything, LIST, { kind: "all" })).toBe(
      everything,
    );
  });
});

describe("extend", () => {
  const down = { kind: "extend", step: 1 } as const;
  const up = { kind: "extend", step: -1 } as const;
  const alone: CardSelection = {
    selected: ["CCCC3333"],
    anchor: "CCCC3333",
    focus: "CCCC3333",
  };

  it("grows the range from the anchor one card at a time", () => {
    const once = nextCardSelection(alone, LIST, down);
    expect(once).toEqual({
      selected: ["CCCC3333", "DDDD4444"],
      anchor: "CCCC3333",
      focus: "DDDD4444",
    });
    expect(nextCardSelection(once, LIST, down)).toEqual({
      selected: ["CCCC3333", "DDDD4444", "EEEE5555"],
      anchor: "CCCC3333",
      focus: "EEEE5555",
    });
  });

  it("shrinks the range back towards the anchor, then grows it past it", () => {
    const grown = nextCardSelection(alone, LIST, down);
    const back = nextCardSelection(grown, LIST, up);
    expect(back).toEqual(alone);
    expect(nextCardSelection(back, LIST, up)).toEqual({
      selected: ["BBBB2222", "CCCC3333"],
      anchor: "CCCC3333",
      focus: "BBBB2222",
    });
  });

  it("leaves a plain move to step from the moving end", () => {
    const grown = nextCardSelection(
      nextCardSelection(alone, LIST, down),
      LIST,
      down,
    );
    expect(nextCardSelection(grown, LIST, { kind: "move", step: -1 })).toEqual({
      selected: ["DDDD4444"],
      anchor: "DDDD4444",
      focus: "DDDD4444",
    });
  });

  it("stays where the moving end cannot pass the end of the list", () => {
    const last: CardSelection = {
      selected: ["DDDD4444", "EEEE5555"],
      anchor: "DDDD4444",
      focus: "EEEE5555",
    };
    expect(nextCardSelection(last, LIST, down)).toBe(last);
  });

  it("enters the list as a move does while nothing is selected", () => {
    expect(nextCardSelection(NO_SELECTION, LIST, down)).toEqual({
      selected: ["AAAA1111"],
      anchor: "AAAA1111",
      focus: "AAAA1111",
    });
  });
});
