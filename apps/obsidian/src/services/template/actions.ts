// The Citation text entry points: the command, and the open flow the Citations
// settings row shares with it. Both materialize `zotlit-citation.md` from the
// built-in citation text when the vault holds none, so a first edit starts
// from the text ZotLit actually renders.

import type { App, Plugin } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";

import type { TemplateService } from "./service";

const logger = getLogger(["template", "actions"]);

/** The template surface the Citation text entry points read. */
export type CitationTemplateActions = Pick<
  TemplateService,
  "materializeCitationTemplate"
>;

export function addCitationTemplateActions(
  plugin: Pick<Plugin, "addCommand" | "app">,
  deps: { template: CitationTemplateActions },
): void {
  plugin.addCommand({
    id: "customize-citation-text",
    name: m.command_customize_citation_text_name(),
    callback: () => void openCitationTemplate(plugin.app, deps.template),
  });
}

/** Open the Citation Template for editing, creating its document when absent. */
export async function openCitationTemplate(
  app: Pick<App, "workspace">,
  template: CitationTemplateActions,
): Promise<void> {
  try {
    const file = await template.materializeCitationTemplate();
    await app.workspace.getLeaf(true).openFile(file);
  } catch (error) {
    logger.error("Failed to open the citation text", { error });
    new BaseNotice(m.notice_citation_text_open_failed());
  }
}
