// @vitest-environment happy-dom
import { ButtonComponent, controlsOf } from "@mock/obsidian";
import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { MissingTemplateError } from "@zotlit/templates/facade";

import { MissingPartialError } from "@/services/template/errors";

import * as m from "./i18n/generated/messages";
import { missingPartialNotice } from "./workbench-recovery";

/** The workspace seam `requestTemplateWorkbench` triggers, with the call
 *  recorded so a test can assert the action button reaches it. */
function makeApp(): { app: App; trigger: ReturnType<typeof vi.fn> } {
  const trigger = vi.fn();
  return { app: { workspace: { trigger } } as unknown as App, trigger };
}

describe("missingPartialNotice", () => {
  it("names the missing partial as a plain string when no app is given", () => {
    const error = new MissingTemplateError("venue-line");

    expect(missingPartialNotice(error)).toBe(
      m.notice_note_missing_partial({ name: "venue-line" }),
    );
  });

  it("names the missing partial and offers the Template Workbench action when given an app", () => {
    const { app, trigger } = makeApp();
    const error = new MissingTemplateError("venue-line");

    const notice = missingPartialNotice(error, { app });

    expect(notice).toBeInstanceOf(DocumentFragment);
    const fragment = notice as DocumentFragment;
    expect(fragment.textContent).toContain("venue-line");

    const actionsEl =
      fragment.querySelector<HTMLElement>(".zt-notice-actions")!;
    const [button] = controlsOf(actionsEl);
    expect(button).toBeInstanceOf(ButtonComponent);
    expect((button as ButtonComponent).text).toBe(
      m.template_workbench_open_layout(),
    );

    (button as ButtonComponent).click();
    // The route carries the refusal itself, so the Workbench explains this
    // failure rather than whichever problem its own check happens to select.
    expect(trigger).toHaveBeenCalledExactlyOnceWith(
      "zotlit:open-template-workbench",
      expect.objectContaining({
        problem: expect.objectContaining({
          diagnostic: expect.objectContaining({
            code: "missing-partial",
            params: { name: "venue-line" },
          }),
        }),
      }),
    );
  });

  it("routes the action to the document whose call named the missing partial", () => {
    const { app, trigger } = makeApp();
    const error = new MissingPartialError(
      "templates/zotlit-profile.reading.md",
      "venue-line",
      new Error("Template not found"),
    );

    const fragment = missingPartialNotice(error, { app }) as DocumentFragment;
    const [button] = controlsOf(
      fragment.querySelector<HTMLElement>(".zt-notice-actions")!,
    );
    (button as ButtonComponent).click();

    expect(trigger).toHaveBeenCalledExactlyOnceWith(
      "zotlit:open-template-workbench",
      {
        document: "templates/zotlit-profile.reading.md",
        problem: expect.objectContaining({
          diagnostic: expect.objectContaining({
            code: "missing-partial",
            params: { name: "venue-line" },
          }),
        }),
      },
    );
  });

  it("carries refused engine evidence in the Workbench arrival", () => {
    const { app, trigger } = makeApp();
    const error = new MissingPartialError(
      "templates/zotlit-profile.reading.md",
      "venue-line",
      new Error("the note render refused this attempt"),
    );

    const fragment = missingPartialNotice(error, { app }) as DocumentFragment;
    const [button] = controlsOf(
      fragment.querySelector<HTMLElement>(".zt-notice-actions")!,
    );
    (button as ButtonComponent).click();

    const request = trigger.mock.calls[0]?.[1] as {
      problem: {
        diagnostic: {
          evidence?: { message?: string; causes?: readonly string[] };
          report?: {
            evidence?: { message?: string; causes?: readonly string[] };
          };
        };
      };
    };
    expect(request.problem.diagnostic.evidence).toMatchObject({
      message: 'Template "venue-line" not found',
      causes: ["the note render refused this attempt"],
    });
    expect(request.problem.diagnostic.report).toMatchObject({
      code: "missing-partial",
      evidence: {
        message: 'Template "venue-line" not found',
        causes: ["the note render refused this attempt"],
      },
      context: { document: "templates/zotlit-profile.reading.md" },
    });
  });

  it("returns undefined for every other failure, which the caller words itself", () => {
    expect(missingPartialNotice(new Error("boom"))).toBeUndefined();
  });
});
