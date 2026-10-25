// The Citation text entry points: the command, and the open flow the Citations
// settings row shares with it. Both materialize `zotlit-citation.md` from the
// built-in citation text when the vault holds none, so a first edit starts
// from the text ZotLit actually renders.

import { Effect, Layer } from "effect";
import type { Scope } from "effect";
import type { App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { PluginHost } from "@/lib/plugin-host";
import type { PluginHostShape } from "@/lib/plugin-host";
import { openTemplateWorkbench } from "@/views/template-workbench/register";

import { Template } from "./service";
import type { TemplateOperations } from "./service";

const logger = getLogger(["template", "actions"]);

/** The template surface the Citation text entry points read. */
export type CitationTemplateActions = Pick<
  TemplateOperations,
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
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    yield* addCitationTemplateActions(host, {
      template: {
        materializeCitationTemplate: () =>
          runPromise(template.materializeCitationTemplate),
      },
    });
  }),
);

export function addCitationTemplateActions(
  host: Pick<PluginHostShape, "addCommand" | "app">,
  deps: { template: CitationTemplateActions },
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.asVoid(
    host.addCommand({
      id: "customize-citation-text",
      name: m.command_customize_citation_text_name(),
      callback: () => void openCitationTemplate(host.app, deps.template),
    }),
  );
}

/**
 * Open the Citation Template in the Template Workbench View, creating its
 * document from the built-in citation text when the vault holds none. The
 * "profile uses Eta" notice belongs to a Profile document, so it is not
 * offered here.
 */
export async function openCitationTemplate(
  app: App,
  template: CitationTemplateActions,
): Promise<void> {
  try {
    const file = await template.materializeCitationTemplate();
    await openTemplateWorkbench(app, file, { explainUnsupported: false });
  } catch (error) {
    logger.error("Failed to open the citation text", { error });
    new BaseNotice(m.notice_citation_text_open_failed());
  }
}
