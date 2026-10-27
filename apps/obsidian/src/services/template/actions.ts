// The Citation text entry points: the command, and the open flow the Citations
// settings row shares with it. Both materialize `zotlit-citation.md` from the
// built-in citation text when the vault holds none, so a first edit starts
// from the text ZotLit actually renders.

import { Effect, Layer } from "effect";
import type { Scope } from "effect";
import type { App } from "obsidian";

import { scopedBridge } from "@/lib/effect-bridge";
import type { EffectBridge } from "@/lib/effect-bridge";
import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log";
import * as m from "@/lib/i18n/generated/messages";
import { portCall } from "@/lib/legacy-port";
import { BaseNotice } from "@/lib/notice";
import { PluginHost } from "@/lib/plugin-host";
import type { PluginHostShape } from "@/lib/plugin-host";
import { openTemplateWorkbench } from "@/views/template-workbench/register";

import { Template } from "./service";

/** The template surface the Citation text entry points read. */
export type CitationTemplateActions = Pick<
  Template["Service"],
  "materializeCitationTemplate"
>;

/**
 * The "Customize citation text" command. Its callback is a plain Obsidian
 * entry point, so the Template service answers it through the layer's own
 * context, as the setting row and the Workbench View reach it.
 */
export const layerCitationTemplateActions: Layer.Layer<
  never,
  never,
  PluginHost | Template
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const template = yield* Template;
    const bridge = yield* scopedBridge;
    yield* addCitationTemplateActions(host, { template, bridge });
  }),
);

export function addCitationTemplateActions(
  host: Pick<PluginHostShape, "addCommand" | "app">,
  deps: {
    template: CitationTemplateActions;
    bridge: Pick<EffectBridge, "runAndForget">;
  },
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.asVoid(
    host.addCommand({
      id: "customize-citation-text",
      name: m.command_customize_citation_text_name(),
      callback: () =>
        deps.bridge.runAndForget(openCitationTemplate(host.app, deps.template)),
    }),
  );
}

/**
 * Open the Citation Template in the Template Workbench View, creating its
 * document from the built-in citation text when the vault holds none. The
 * "profile uses Eta" notice belongs to a Profile document, so it is not
 * offered here.
 */
export const openCitationTemplate = Effect.fn("openCitationTemplate")(
  function* (app: App, template: CitationTemplateActions) {
    const file = yield* template.materializeCitationTemplate;
    yield* portCall("open-template-workbench", () =>
      openTemplateWorkbench(app, file, { explainUnsupported: false }),
    );
  },
  (effect) =>
    effect.pipe(
      recover(
        (cause) =>
          Effect.logError("Failed to open the citation text").pipe(
            Effect.annotateLogs({ cause }),
            withLogCategory("template", "actions"),
          ),
        Effect.sync(() => {
          new BaseNotice(m.notice_citation_text_open_failed());
        }),
      ),
    ),
);
