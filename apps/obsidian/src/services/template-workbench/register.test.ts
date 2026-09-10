import type { CliFlags, Plugin } from "obsidian";
import { describe, expect, it } from "vitest";

import {
  TEMPLATE_DATA_COMMAND,
  TEMPLATE_DOCUMENT_RENDER_COMMAND,
  TEMPLATE_RENDER_COMMAND,
} from "./cli";
import { registerTemplateWorkbench } from "./register";

/**
 * The flags each command declares. Obsidian checks its own `required` list
 * before it calls the handler, so a parser test cannot see what a real call
 * would be rejected for; this reads the registration itself.
 */
function declaredFlags(): Map<string, CliFlags | null> {
  const flags = new Map<string, CliFlags | null>();
  const plugin = {
    manifest: { version: "1.2.3" },
    registerCliHandler: (
      command: string,
      _text: string,
      cli: CliFlags | null,
    ) => {
      flags.set(command, cli);
    },
  } as unknown as Plugin;
  registerTemplateWorkbench(plugin, {
    app: { vault: { getName: () => "Test Vault" } },
    settings: {},
    profile: {},
    templates: {},
    zoteroPref: {},
    db: {},
    noteIndex: {},
  } as never);
  return flags;
}

describe("Template Workbench CLI registration", () => {
  it.each([TEMPLATE_DATA_COMMAND, TEMPLATE_RENDER_COMMAND])(
    "leaves key optional on %s, where an example set selects the object instead",
    (command) => {
      const cli = declaredFlags().get(command);
      expect(cli?.key).toBeDefined();
      expect(cli?.key?.required ?? false).toBe(false);
      expect(cli?.example).toBeDefined();
    },
  );

  it("keeps key required on the commands no example set reaches", () => {
    const flags = declaredFlags();
    const cli = flags.get(TEMPLATE_DOCUMENT_RENDER_COMMAND);
    expect(cli?.key?.required).toBe(true);
    expect(cli?.example).toBeUndefined();
  });
});
