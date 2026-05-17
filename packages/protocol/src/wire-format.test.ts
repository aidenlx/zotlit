import { describe, expect, it } from "vitest";

import { parseQuery, stringifyQuery } from "./index";

// Placeholder test suite. The wire-format implementation is deferred (see
// AGENTS.md), so there's nothing concrete to assert yet. Replace these
// todo-stubs with real snapshot / round-trip cases when stringifyQuery and
// parseQuery land.

describe("@zotlit/protocol — wire format", () => {
  it.todo("stringifyQuery produces the agreed v2 wire shape");
  it.todo("parseQuery round-trips every stringifyQuery output");
  it.todo("parseQuery rejects malformed inputs");

  it("stub stringifyQuery throws until implemented", () => {
    expect(() =>
      stringifyQuery("open", { type: "item", version: "0", items: [] }),
    ).toThrow(/not implemented/);
  });

  it("stub parseQuery throws until implemented", () => {
    expect(() => parseQuery("obsidian://zotero/open")).toThrow(
      /not implemented/,
    );
  });
});
