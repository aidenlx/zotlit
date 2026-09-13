// The route back to the Template Workbench from a note operation that refused:
// one notice, shared by every surface that reports one.
import type { App } from "obsidian";

import { MissingTemplateError } from "@zotlit/templates/facade";
import {
  captureRenderReport,
  engineEvidence,
  renderFailureDiagnostic,
} from "@zotlit/workbench/render";
import type { RenderDiagnostic } from "@zotlit/workbench/render";

import { MissingPartialError } from "@/services/template/errors";

import * as m from "./i18n/generated/messages";
import { getLogger } from "./log";
import { BaseNotice } from "./notice";

const logger = getLogger("workbench-recovery");

/**
 * The failure a refused note operation asks the Workbench to explain: the
 * diagnostic the refused render reported, including the report already
 * captured at the refusal boundary. The Workbench can explain it even when a
 * later check does not reproduce the failure.
 */
export interface ArrivingProblem {
  readonly diagnostic: RenderDiagnostic;
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
    problem: request.problem?.diagnostic.code ?? null,
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
  const classified = {
    ...renderFailureDiagnostic(error, { source: "", language: "liquid" }),
    evidence: engineEvidence(error),
    part: "render" as const,
  };
  const captured = captureRenderReport({
    diagnostic: classified,
    identity: { sourceRevision: "", snapshotRevision: "" },
    trigger: "explicit",
    sequence: 0,
    capturedAt: Temporal.Now.instant().toString(),
    context: document === undefined ? {} : { document },
  });
  const { sequence: _sequence, ...report } = captured;
  const problem: ArrivingProblem = {
    diagnostic: { ...classified, report },
  };
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
