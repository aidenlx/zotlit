// The Citation text entry points: the command, the Citations settings row and
// the Template Workbench View all open the citation text through
// `openCitationTemplate`. It materializes `zotlit-citation.md` from the
// built-in citation text when the vault holds none, so a first edit starts
// from the text ZotLit actually renders.

import { Effect, Layer } from "effect";
import type { Context, Scope } from "effect";
import type { App } from "obsidian";

import { scopedBridge } from "@/lib/effect-bridge";
import type { EffectBridge } from "@/lib/effect-bridge";
import { withLogCategory } from "@/lib/effect-log";
import * as m from "@/lib/i18n/generated/messages";
import { reportOutcome } from "@/lib/notifier";
import type { Notifier } from "@/lib/notifier";
import type { Vault } from "@/lib/obsidian-vault";
import type { Workspace } from "@/lib/obsidian-workspace";
import { PluginHost } from "@/lib/plugin-host";
import type { PluginHostShape } from "@/lib/plugin-host";
import { openTemplateWorkbench } from "@/views/template-workbench/open";

import { Template } from "./service";

/**
 * The "Customize citation text" command. Its callback is a plain Obsidian
 * entry point, so it runs the open on the layer's own bridge, over the
 * services the layer was built with.
 */
/** The services the Citation Template open runs with. */
type CitationTemplateServices = Template | Notifier | Vault | Workspace;

export const layerCitationTemplateActions: Layer.Layer<
  never,
  never,
  PluginHost | CitationTemplateServices
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const context = yield* Effect.context<CitationTemplateServices>();
    const bridge = yield* scopedBridge;
    yield* addCitationTemplateActions(host, { context, bridge });
  }),
);

export function addCitationTemplateActions(
  host: Pick<PluginHostShape, "addCommand" | "app">,
  deps: {
    context: Context.Context<CitationTemplateServices>;
    bridge: Pick<EffectBridge, "runAndForget">;
  },
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.asVoid(
    host.addCommand({
      id: "customize-citation-text",
      name: m.command_customize_citation_text_name(),
      callback: () =>
        deps.bridge.runAndForget(
          reportCitationTemplateOpen(host.app).pipe(
            Effect.provideContext(deps.context),
          ),
        ),
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
  function* (app: App) {
    const file = yield* (yield* Template).materializeCitationTemplate;
    yield* openTemplateWorkbench(app, file, { explainUnsupported: false });
  },
);

/**
 * {@link openCitationTemplate} for an entry point: a failure is logged and a
 * notice tells the user; an interrupt passes on with no notice.
 */
export const reportCitationTemplateOpen = Effect.fn(
  "CitationTemplate.reportOpen",
)(
  function* (app: App) {
    yield* reportOutcome(openCitationTemplate(app), {
      success: () => undefined,
      error: () => m.notice_citation_text_open_failed(),
    });
  },
  withLogCategory("template", "actions"),
);
