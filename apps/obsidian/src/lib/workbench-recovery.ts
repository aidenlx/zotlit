// The route back to the Template Workbench from a note operation that refused:
// one notice, shared by every surface that reports one.
import type { App } from "obsidian";

import { MissingTemplateError } from "@zotlit/templates/facade";
import type { RenderDiagnosticCode } from "@zotlit/workbench/render";

import { MissingPartialError } from "@/services/template/errors";

import * as m from "./i18n/generated/messages";
import { getLogger } from "./log";
import { BaseNotice } from "./notice";

const logger = getLogger("workbench-recovery");

/**
 * The failure a refused note operation asks the Workbench to explain: the
 * diagnostic code the render reported and the object it named. The Workbench
 * explains it once its own check finds the same problem, so the reader reads
 * an explanation of a failure that is still there rather than a recorded
 * message about one that may already be repaired.
 */
export interface ArrivingProblem {
  readonly code: RenderDiagnosticCode;
  /** The object the failure named — the partial a call could not resolve. */
  readonly subject?: string;
}

/** What brought the reader to the Template Workbench, and what to explain. */
export interface TemplateWorkbenchRequest {
  /**
   * The vault path of the Template Document holding the call that refused, so
   * the reader lands on it; the Default Profile stands in when the failure
   * names no document.
   */
  readonly document?: string;
  readonly problem?: ArrivingProblem;
}

/**
 * Ask the workspace to open the Template Workbench, where a template is
 * repaired.
 */
function requestTemplateWorkbench(
  app: App,
  request: TemplateWorkbenchRequest,
): void {
  logger.debug("Requested the Template Workbench from a refused operation", {
    document: request.document ?? null,
    problem: request.problem?.code ?? null,
  });
  app.workspace.trigger("zotlit:open-template-workbench", request);
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
  // The Workbench opens the explanation for this very failure, so the reader
  // reads what refused rather than hunting for it among the editor's checks.
  const problem = {
    code: "missing-partial",
    subject: error.templateName,
  } as const;
  return BaseNotice.render((renderer) => {
    renderer.setTitle(message).addAction((button) => {
      button.setButtonText(m.template_workbench_open_layout()).onClick(() =>
        requestTemplateWorkbench(app, {
          ...(document === undefined ? {} : { document }),
          problem,
        }),
      );
    });
  });
}
