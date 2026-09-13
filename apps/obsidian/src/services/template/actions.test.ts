// @vitest-environment happy-dom
import { TFile } from "@mock/obsidian";
import type { Command, TFile as ObsidianFile } from "obsidian";
import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import { TEMPLATE_WORKBENCH_VIEW_TYPE } from "@/views/template-workbench/view";

import { addCitationTemplateActions } from "./actions";

interface Harness {
  command: Command;
  /** The view states the flow opened, in order. */
  opened: { type: string; path: unknown }[];
  materialize: ReturnType<typeof vi.fn>;
}

function harness(
  materialize = vi.fn(
    async () =>
      Object.assign(new TFile(), {
        path: "Templates/zotlit-citation.md",
      }) as unknown as ObsidianFile,
  ),
): Harness {
  const commands: Command[] = [];
  const opened: { type: string; path: unknown }[] = [];
  const leaf = {
    setViewState: async (state: { type: string; state: { file: unknown } }) => {
      opened.push({ type: state.type, path: state.state.file });
    },
    getContainer: () => ({ focus: () => {} }),
  };
  const plugin = {
    addCommand: (command: Command) => commands.push(command),
    app: {
      workspace: {
        getLeavesOfType: () => [],
        getLeaf: () => leaf,
        revealLeaf: async () => {},
      },
    },
  };

  addCitationTemplateActions(
    plugin as never,
    { template: { materializeCitationTemplate: materialize } } as never,
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
