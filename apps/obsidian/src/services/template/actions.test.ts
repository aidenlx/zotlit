import { expect, it, vi } from "@effect/vitest";
// @vitest-environment happy-dom
import { Effect } from "effect";
import { TFile } from "obsidian";
import type { App, Command, WorkspaceContainer, WorkspaceLeaf } from "obsidian";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { scopedBridge } from "@/lib/effect-bridge";
import * as m from "@/lib/i18n/generated/messages";
import type { PluginHostShape } from "@/lib/plugin-host";
import { TEMPLATE_WORKBENCH_VIEW_TYPE } from "@/views/template-workbench/view";

import { addCitationTemplateActions } from "./actions";
import { templateFailure } from "./service";

interface Harness {
  command: Command;
  /** The view states the flow opened, in order. */
  opened: { type: string; path: unknown }[];
  materialize: ReturnType<typeof vi.fn>;
}

const harness = Effect.fnUntraced(function* (
  materialize = vi.fn(async () =>
    Object.assign(new TFile(), {
      path: "Templates/zotlit-citation.md",
    }),
  ),
): Effect.fn.Return<Harness, never, import("effect").Scope.Scope> {
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

  yield* addCitationTemplateActions(plugin, {
    template: {
      materializeCitationTemplate: Effect.tryPromise({
        try: () => materialize(),
        catch: templateFailure,
      }),
    },
    bridge: yield* scopedBridge,
  });
  return { command: commands[0]!, opened, materialize };
});

it.effect("registers Customize citation text as a command", () =>
  Effect.gen(function* () {
    expect((yield* harness()).command).toMatchObject({
      id: "customize-citation-text",
      name: m.command_customize_citation_text_name(),
    });
  }),
);

it.effect(
  "materializes the document, then opens it in the Template Workbench View",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();

      h.command.callback!();
      yield* Effect.promise(() =>
        vi.waitFor(() => expect(h.opened).toHaveLength(1)),
      );

      expect(h.materialize).toHaveBeenCalledTimes(1);
      expect(h.opened[0]).toEqual({
        type: TEMPLATE_WORKBENCH_VIEW_TYPE,
        path: "Templates/zotlit-citation.md",
      });
    }),
);

it.effect(
  "reports a failure as a notice instead of opening nothing silently",
  () =>
    Effect.gen(function* () {
      const h = yield* harness(
        vi.fn(async () => {
          throw new Error("the template folder is a file");
        }),
      );

      h.command.callback!();
      yield* Effect.promise(() =>
        vi.waitFor(() => expect(h.materialize).toHaveBeenCalled()),
      );

      expect(h.opened).toEqual([]);
    }),
);
