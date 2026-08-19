import type { CliHandler, Plugin } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import {
  LIBRARY_SCOPE_COMMAND,
  LIBRARY_SCOPE_GUIDE_COMMAND,
  registerLibraryScopeCli,
} from "./cli";
import type { ResolvedLibraryScope } from "./scope";

function setup(current: ResolvedLibraryScope | null) {
  const registerCliHandler = vi.fn();
  const plugin = { registerCliHandler } as unknown as Plugin;

  registerLibraryScopeCli(plugin, {
    libraryScope: { ready: Promise.resolve(), current },
  });

  const handlerFor = (command: string) =>
    registerCliHandler.mock.calls.find(
      ([registered]) => registered === command,
    )![3] as CliHandler;

  return {
    registerCliHandler,
    handler: handlerFor(LIBRARY_SCOPE_COMMAND),
    guideHandler: handlerFor(LIBRARY_SCOPE_GUIDE_COMMAND),
  };
}

describe("Library Scope CLI registration", () => {
  it("publishes both commands with description and no flags", () => {
    const { registerCliHandler } = setup(null);

    expect(registerCliHandler).toHaveBeenCalledWith(
      LIBRARY_SCOPE_COMMAND,
      "Report the resolved Library Scope: mode, available Libraries, and unavailable selectors",
      null,
      expect.any(Function),
    );
    expect(registerCliHandler).toHaveBeenCalledWith(
      LIBRARY_SCOPE_GUIDE_COMMAND,
      "Print the zotlit:library-scope CLI guide",
      null,
      expect.any(Function),
    );
  });

  it("reports an all-scope resolution", async () => {
    const { handler } = setup({
      mode: "all",
      invalid: false,
      available: [{ selector: { type: "personal" }, libraryID: 1, name: null }],
      unavailable: [],
    });

    expect(JSON.parse(await handler({}))).toEqual({
      contractVersion: 1,
      command: LIBRARY_SCOPE_COMMAND,
      ok: true,
      mode: "all",
      invalid: false,
      available: [{ selector: { type: "personal" }, libraryID: 1, name: null }],
      unavailable: [],
    });
  });

  it("reports a selected-scope resolution with available and unavailable selectors", async () => {
    const { handler } = setup({
      mode: "selected",
      invalid: false,
      available: [
        { selector: { type: "personal" }, libraryID: 1, name: null },
        {
          selector: { type: "group", groupID: 5 },
          libraryID: 7,
          name: "Lab Group",
        },
      ],
      unavailable: [{ type: "group", groupID: 9 }],
    });

    expect(JSON.parse(await handler({}))).toEqual({
      contractVersion: 1,
      command: LIBRARY_SCOPE_COMMAND,
      ok: true,
      mode: "selected",
      invalid: false,
      available: [
        { selector: { type: "personal" }, libraryID: 1, name: null },
        {
          selector: { type: "group", groupID: 5 },
          libraryID: 7,
          name: "Lab Group",
        },
      ],
      unavailable: [{ type: "group", groupID: 9 }],
    });
  });

  it("reports invalid: true when the saved value failed validation", async () => {
    const { handler } = setup({
      mode: "selected",
      invalid: true,
      available: [{ selector: { type: "personal" }, libraryID: 1, name: null }],
      unavailable: [],
    });

    const output = JSON.parse(await handler({}));
    expect(output.ok).toBe(true);
    expect(output.invalid).toBe(true);
  });

  it("reports the database as unreadable when current is null", async () => {
    const { handler } = setup(null);

    expect(JSON.parse(await handler({}))).toEqual({
      contractVersion: 1,
      command: LIBRARY_SCOPE_COMMAND,
      ok: false,
      diagnostic: {
        code: "DATABASE_UNREADABLE",
        message: "The connected Zotero source is not currently readable.",
        hint: "Run the command again once the connected Zotero source is readable.",
      },
    });
  });

  it("rejects an unknown parameter before reading the database", async () => {
    const { handler } = setup({
      mode: "all",
      invalid: false,
      available: [],
      unavailable: [],
    });

    const output = JSON.parse(await handler({ bogus: "1" }));
    expect(output).toMatchObject({
      contractVersion: 1,
      command: LIBRARY_SCOPE_COMMAND,
      ok: false,
      diagnostic: { code: "INVALID_SELECTOR", details: { parameter: "bogus" } },
    });
  });

  it("prints the guide, and rejects an unknown parameter the same way", async () => {
    const { guideHandler } = setup(null);

    const guide = await guideHandler({});
    expect(guide).toContain("zotlit:library-scope");
    expect(guide).toContain("zotlit:library-scope-guide");

    const rejected = JSON.parse(await guideHandler({ bogus: "1" }));
    expect(rejected).toMatchObject({
      contractVersion: 1,
      command: LIBRARY_SCOPE_GUIDE_COMMAND,
      ok: false,
      diagnostic: { code: "INVALID_SELECTOR", details: { parameter: "bogus" } },
    });
  });
});
