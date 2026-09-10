// The route back to the Template Workbench from a note operation that refused,
// shared by every surface that reports one.
import type { App } from "obsidian";

import { MissingTemplateError } from "@zotlit/templates/facade";

import { MissingPartialError } from "@/services/template/errors";

import * as m from "./i18n/generated/messages";
import { getLogger } from "./log";
import { BaseNotice } from "./notice";

const logger = getLogger("workbench-recovery");

/**
 * Ask the workspace to open the Template Workbench, where a template is
 * repaired.
 *
 * @param document - the vault path of the Template Document holding the call
 *   that refused, so the reader lands on it; the Default Profile stands in
 *   when the failure names no document.
 */
export function requestTemplateWorkbench(app: App, document?: string): void {
  logger.debug("Requested the Template Workbench from a refused operation", {
    document: document ?? null,
  });
  app.workspace.trigger("zotlit:open-template-workbench", document);
}

/**
 * The notice a note operation refuses with when the engine reached a Shared
 * Partial the vault holds no document for: the partial is named, and nothing
 * was written, because the render raised before any byte reached the vault.
 *
 * @returns undefined for every other failure, which the caller words itself.
 */
export function missingPartialNotice(
  error: unknown,
  options: { app?: App } = {},
): string | DocumentFragment | undefined {
  if (!(error instanceof MissingTemplateError)) return undefined;
  const message = m.notice_note_missing_partial({
    name: error.templateName,
  });
  const { app } = options;
  if (!app) return message;
  // The render names the document its call sits in, so the action opens that
  // Profile rather than whichever one the Workbench would default to.
  const document =
    error instanceof MissingPartialError ? error.documentPath : undefined;
  return BaseNotice.render((renderer) => {
    renderer.setTitle(message).addAction((button) => {
      button
        .setButtonText(m.template_workbench_open_layout())
        .onClick(() => requestTemplateWorkbench(app, document));
    });
  });
}
