import type { Plugin } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { PANDOC_FILES_COMMAND, PANDOC_GUIDE_COMMAND } from "./integration";
import { registerPandocResolve } from "./register";

describe("Pandoc CLI registration", () => {
  it("publishes parameter-free integration commands with command help", () => {
    const registerCliHandler = vi.fn();
    const plugin = {
      manifest: { version: "2.0.1-test" },
      registerCliHandler,
    } as unknown as Plugin;

    registerPandocResolve(plugin, {} as never);

    expect(registerCliHandler).toHaveBeenCalledWith(
      PANDOC_FILES_COMMAND,
      "Return the version-matched ZotLit Pandoc integration pair",
      null,
      expect.any(Function),
    );
    expect(registerCliHandler).toHaveBeenCalledWith(
      PANDOC_GUIDE_COMMAND,
      "Print the ZotLit Pandoc CLI guide",
      null,
      expect.any(Function),
    );
  });
});
