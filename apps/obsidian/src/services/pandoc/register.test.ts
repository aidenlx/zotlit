import type { Plugin } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { PANDOC_FILES_COMMAND, PANDOC_GUIDE_COMMAND } from "./integration";
import {
  CSL_COMMAND,
  registerPandocResolve,
  RESOLVE_COMMAND,
} from "./register";

describe("Pandoc CLI registration", () => {
  it("connects every Pandoc handler to the CLI surface", () => {
    const registerCliHandler = vi.fn();
    const plugin = {
      manifest: { version: "2.0.1-test" },
      registerCliHandler,
    } as unknown as Plugin;

    registerPandocResolve(plugin, {} as never);

    expect(registerCliHandler.mock.calls.map(([command]) => command)).toEqual([
      PANDOC_FILES_COMMAND,
      PANDOC_GUIDE_COMMAND,
      RESOLVE_COMMAND,
      CSL_COMMAND,
    ]);
    expect(
      registerCliHandler.mock.calls.every(
        (call) => typeof call[3] === "function",
      ),
    ).toBe(true);
  });
});
