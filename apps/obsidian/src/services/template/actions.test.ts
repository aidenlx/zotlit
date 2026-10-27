import { expect, it } from "@effect/vitest";
// @vitest-environment happy-dom
import { Effect, Exit, Fiber, Layer } from "effect";
import { TFile } from "obsidian";
import type { App, Command, WorkspaceContainer, WorkspaceLeaf } from "obsidian";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { scopedBridge } from "@/lib/effect-bridge";
import * as m from "@/lib/i18n/generated/messages";
import { Notifier } from "@/lib/notifier";
import type { PluginHostShape } from "@/lib/plugin-host";
import { TEMPLATE_WORKBENCH_VIEW_TYPE } from "@/views/template-workbench/view";

import {
  addCitationTemplateActions,
  openCitationTemplate,
  reportCitationTemplateOpen,
} from "./actions";
import { Template, templateFailure } from "./service";
import type { TemplateFailure } from "./service";

const CITATION = Object.assign(new TFile(), {
  path: "Templates/zotlit-citation.md",
});

/** An App whose workspace records each view state the open sets. */
function workspaceApp() {
  const opened: { type: string; path: unknown }[] = [];
  const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
    setViewState: async (state: { type: string; state: { file: unknown } }) => {
      opened.push({ type: state.type, path: state.state.file });
    },
    getContainer: () =>
      stubService<WorkspaceContainer>("WorkspaceContainer", {
        focus: () => {},
      }),
    view: stubService<WorkspaceLeaf["view"]>("View", {}),
  });
  const app = stubService<App>("App", {
    workspace: stubService<App["workspace"]>("Workspace", {
      getLeavesOfType: () => [],
      getLeaf: () => leaf,
      revealLeaf: async () => {},
    }),
  });
  return { app, opened };
}

/** The Template and Notifier the open reads. */
const servicesOver = (
  materializeCitationTemplate: Effect.Effect<TFile, TemplateFailure>,
  notifier: Notifier["Service"] = testNotifier().service,
) =>
  Layer.merge(
    Layer.mock(Template, { materializeCitationTemplate }),
    Layer.succeed(Notifier, notifier),
  );

const failure = templateFailure(new Error("the template folder is a file"));

it.effect("registers Customize citation text as a command", () =>
  Effect.gen(function* () {
    const commands: Command[] = [];
    const host = stubService<Pick<PluginHostShape, "addCommand" | "app">>(
      "PluginHost",
      {
        addCommand: (command: Command) =>
          Effect.sync(() => {
            commands.push(command);
            return command;
          }),
        app: workspaceApp().app,
      },
    );
    const context = yield* Effect.context<Template | Notifier>().pipe(
      Effect.provide(servicesOver(Effect.succeed(CITATION))),
    );
    yield* addCitationTemplateActions(host, {
      context,
      bridge: yield* scopedBridge,
    });
    expect(commands).toMatchObject([
      {
        id: "customize-citation-text",
        name: m.command_customize_citation_text_name(),
      },
    ]);
  }),
);

it.effect(
  "materializes the document, then opens it in the Template Workbench View",
  () =>
    Effect.gen(function* () {
      const { app, opened } = workspaceApp();

      yield* openCitationTemplate(app).pipe(
        Effect.provide(servicesOver(Effect.succeed(CITATION))),
      );

      expect(opened).toEqual([
        { type: TEMPLATE_WORKBENCH_VIEW_TYPE, path: CITATION.path },
      ]);
    }),
);

it.effect("fails with the Template failure and opens nothing", () =>
  Effect.gen(function* () {
    const { app, opened } = workspaceApp();

    const error = yield* openCitationTemplate(app).pipe(
      Effect.provide(servicesOver(Effect.fail(failure))),
      Effect.flip,
    );

    expect(error).toBe(failure);
    expect(opened).toEqual([]);
  }),
);

it.effect("opens nothing once interrupted", () =>
  Effect.gen(function* () {
    const { app, opened } = workspaceApp();

    const fiber = yield* openCitationTemplate(app).pipe(
      Effect.provide(servicesOver(Effect.never)),
      Effect.forkChild,
    );
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(fiber);
    const exit = yield* Fiber.await(fiber);

    expect(Exit.hasInterrupts(exit)).toBe(true);
    expect(opened).toEqual([]);
  }),
);

it.effect(
  "reports a failed open as a notice, and an interrupted one as none",
  () =>
    Effect.gen(function* () {
      const notifier = testNotifier();
      const report = (materialize: Effect.Effect<TFile, TemplateFailure>) =>
        reportCitationTemplateOpen(workspaceApp().app).pipe(
          Effect.provide(servicesOver(materialize, notifier.service)),
        );

      yield* report(Effect.fail(failure));
      const interrupted = yield* Effect.exit(report(Effect.interrupt));

      expect(notifier.notices.map((notice) => notice.messages)).toEqual([
        [m.notice_citation_text_open_failed()],
      ]);
      expect(Exit.hasInterrupts(interrupted)).toBe(true);
    }),
);
