import type { CliFlags } from "obsidian";
import { describe, expect, vi } from "vitest";

import { fakeCliHost } from "@/lib/__fixtures__/cli-host";
import { testRuntime } from "@/lib/__fixtures__/runtime";
import { Effect } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { TEMPLATE_DATA_COMMAND } from "./cli";
import { registerTemplateWorkbench } from "./register";

/**
 * The flags each command declares. Obsidian checks its own `required` list
 * before it calls the handler, so a parser test cannot see what a real call
 * would be rejected for; this reads the registration itself.
 */
function declaredFlags(): Map<string, CliFlags | null> {
  const { host, commands } = fakeCliHost();
  registerTemplateWorkbench({ ...host, manifest: { version: "1.2.3" } }, {
    runtime: testRuntime(),
    app: { vault: { getName: () => "Test Vault" } },
    settings: {},
    bridge: { runSync: Effect.runSync },
    profile: {},
    templates: {},
    zoteroPref: {},
    noteIndex: {},
  } as never);
  return new Map([...commands].map(([command, { flags }]) => [command, flags]));
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

  it.effect.each([
    "template-source",
    "template-schema",
    "template-render",
    "template-document-render",
    "frontmatter-status",
    "frontmatter-eval",
    "frontmatter-set",
    "frontmatter-remove",
    "frontmatter-reorder",
  ])("retires %s before reading or writing legacy settings", (name) =>
    Effect.gen(function* () {
      const { host, command } = fakeCliHost();
      const update = vi.fn();
      registerTemplateWorkbench({ ...host, manifest: { version: "test" } }, {
        runtime: testRuntime(),
        app: {},
        settings: { update },
        bridge: { runSync: Effect.runSync },
        templates: {},
        profile: {},
        zoteroPref: {},
      } as never);
      const retired = command(`zotlit:${name}`);
      expect(
        Object.values(retired.flags ?? {}).every((flag) => !flag.required),
      ).toBe(true);
      const result = JSON.parse(
        yield* retired.handler({ field: "title", expr: "zt.title" }),
      );
      expect(result).toMatchObject({
        ok: false,
        contractVersion: 8,
        diagnostic: { code: "COMMAND_RETIRED" },
      });
      expect(result.diagnostic.hint).toContain(
        "legacy template conversion in settings",
      );
      expect(result.diagnostic.hint).toContain("template-check");
      expect(update).not.toHaveBeenCalled();
    }),
  );
});
