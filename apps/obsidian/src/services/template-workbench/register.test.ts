import type { CliFlags, CliHandler, Plugin } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { TEMPLATE_DATA_COMMAND } from "./cli";
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
  it("teaches optional focused discovery and explicit broad output", () => {
    const flags = declaredFlags().get(TEMPLATE_DATA_COMMAND)!;
    expect(flags.query?.description).toContain("Optional focused discovery");
    expect(flags.path?.description).toContain("zt.creators[0].family");
    expect(flags.full?.description).toContain("complete zt object");
    expect(flags.note?.description).toContain("template-inspect");
    expect(flags.query?.required).not.toBe(true);
  });
  it.each([TEMPLATE_DATA_COMMAND])(
    "leaves key optional on %s, where an example set selects the object instead",
    (command) => {
      const cli = declaredFlags().get(command);
      expect(cli?.key).toBeDefined();
      expect(cli?.key?.required ?? false).toBe(false);
      expect(cli?.example).toBeDefined();
    },
  );

  it.each([
    "template-source",
    "template-schema",
    "template-render",
    "template-document-render",
    "frontmatter-status",
    "frontmatter-eval",
    "frontmatter-set",
    "frontmatter-remove",
    "frontmatter-reorder",
  ])("retires %s before reading or writing legacy settings", async (name) => {
    const registered = new Map<
      string,
      { flags: CliFlags | null; handler: CliHandler }
    >();
    const update = vi.fn();
    registerTemplateWorkbench(
      {
        manifest: { version: "test" },
        registerCliHandler: (
          ...[command, , flags, handler]: Parameters<
            Plugin["registerCliHandler"]
          >
        ) => {
          registered.set(command, { flags, handler });
        },
      } as unknown as Plugin,
      {
        app: {},
        settings: { update },
        templates: {},
        profile: {},
        zoteroPref: {},
      } as never,
    );
    const command = registered.get(`zotlit:${name}`)!;
    expect(
      Object.values(command.flags ?? {}).every((flag) => !flag.required),
    ).toBe(true);
    const result = JSON.parse(
      (await command.handler({ field: "title", expr: "zt.title" })) as string,
    );
    expect(result).toMatchObject({
      ok: false,
      contractVersion: 7,
      diagnostic: { code: "COMMAND_RETIRED" },
    });
    expect(result.diagnostic.hint).toContain(
      "legacy template conversion in settings",
    );
    expect(result.diagnostic.hint).toContain("template-check");
    expect(update).not.toHaveBeenCalled();
  });
});
