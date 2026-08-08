import type { Plugin } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

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
      m.cli_pandoc_files_desc(),
      null,
      expect.any(Function),
    );
    expect(registerCliHandler).toHaveBeenCalledWith(
      PANDOC_GUIDE_COMMAND,
      m.cli_pandoc_guide_desc(),
      null,
      expect.any(Function),
    );
  });
});
