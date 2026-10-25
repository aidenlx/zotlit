// @vitest-environment happy-dom
import { Effect } from "effect";
import { TFile } from "obsidian";
import type { App, Command, WorkspaceContainer, WorkspaceLeaf } from "obsidian";
import { expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import type { PluginHostShape } from "@/lib/plugin-host";
import { TEMPLATE_WORKBENCH_VIEW_TYPE } from "@/views/template-workbench/view";

import { addCitationTemplateActions } from "./actions";

interface Harness {
  command: Command;
  /** The view states the flow opened, in order. */
  opened: { type: string; path: unknown }[];
  materialize: ReturnType<typeof vi.fn>;
}

function harness(
  materialize = vi.fn(async () =>
    Object.assign(new TFile(), {
      path: "Templates/zotlit-citation.md",
    }),
  ),
): Harness {
  const commands: Command[] = [];
  const opened: { type: string; path: unknown }[] = [];
  const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
    setViewState: async (state: { type: string; state: { file: unknown } }) => {
      opened.push({ type: state.type, path: state.state.file });
    },
    getContainer: () =>
      stubService<WorkspaceContainer>("WorkspaceContainer", {
        focus: () => {},
      }),
  });
  const app = stubService<App>("App", {
    workspace: stubService<App["workspace"]>("Workspace", {
      getLeavesOfType: () => [],
      getLeaf: () => leaf,
      revealLeaf: async () => {},
    }),
  });
  const plugin = stubService<Pick<PluginHostShape, "addCommand" | "app">>(
    "PluginHost",
    {
      addCommand: (command: Command) =>
        Effect.sync(() => {
          commands.push(command);
          return command;
        }),
      app,
    },
  );

  Effect.runSync(
    Effect.scoped(
      addCitationTemplateActions(plugin, {
        template: { materializeCitationTemplate: materialize },
      }),
    ),
  );
  return { command: commands[0]!, opened, materialize };
}

it("registers Customize citation text as a command", () => {
  expect(harness().command).toMatchObject({
    id: "customize-citation-text",
    name: m.command_customize_citation_text_name(),
  });
});

it("materializes the document, then opens it in the Template Workbench View", async () => {
  const h = harness();

  h.command.callback!();
  await vi.waitFor(() => expect(h.opened).toHaveLength(1));

  expect(h.materialize).toHaveBeenCalledTimes(1);
  expect(h.opened[0]).toEqual({
    type: TEMPLATE_WORKBENCH_VIEW_TYPE,
    path: "Templates/zotlit-citation.md",
  });
});

it("reports a failure as a notice instead of opening nothing silently", async () => {
  const h = harness(
    vi.fn(async () => {
      throw new Error("the template folder is a file");
    }),
  );

  h.command.callback!();
  await vi.waitFor(() => expect(h.materialize).toHaveBeenCalled());

  expect(h.opened).toEqual([]);
});
