import type { Plugin } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import { CITED_BY_COMMAND } from "./commands";
import { registerCitationsCli } from "./register";

describe("Citations CLI registration", () => {
  it("publishes cited-by with localized command and flag help", () => {
    const registerCliHandler = vi.fn();
    const plugin = { registerCliHandler } as unknown as Plugin;

    registerCitationsCli(plugin, {} as never);

    expect(registerCliHandler).toHaveBeenCalledWith(
      CITED_BY_COMMAND,
      m.cli_cited_by_desc(),
      {
        key: {
          value: "<zotero-key>",
          description: m.cli_flag_cited_by_key_desc(),
        },
        citekey: {
          value: "<citation-key>",
          description: m.cli_flag_cited_by_citekey_desc(),
        },
        "expect-source": {
          value: "<source-id>",
          description: m.cli_flag_expect_source_desc(),
        },
      },
      expect.any(Function),
    );
  });
});
