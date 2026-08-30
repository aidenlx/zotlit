// @vitest-environment happy-dom
import { ButtonComponent } from "obsidian";
import type { App } from "obsidian";
import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import { BatchModal } from "./index";
import type { BatchRunResult } from "./index";

it("offers note recovery in both the live failure panel and the completed summary", async () => {
  using clicked = vi.spyOn(ButtonComponent.prototype, "onClick");
  const trigger = vi.fn();
  const finished = Promise.withResolvers<BatchRunResult>();
  const modal = new BatchModal({ workspace: { trigger } } as unknown as App, {
    total: 1,
    text: {
      title: m.batch_update_title(),
      loadingLabel: m.batch_update_loading_label(),
      loadFailed: m.batch_update_load_failed(),
      runFailed: m.batch_update_run_failed(),
      progressLabel: m.batch_update_progress_label(),
      confirmIntro: ({ actionable }) =>
        m.batch_update_confirm_intro({ count: actionable }),
      confirmButton: m.batch_update_confirm_button(),
      runSummary: m.batch_update_summary,
    },
    onClassify: async () => ({
      counts: { actionable: 1, notFound: 0 },
      renderList: () => {},
      setRowStatus: () => {},
      renderSummary: () => {},
    }),
    onRun: async (controls) => {
      controls.onItemSettled({
        id: 1,
        status: "failed",
        failure: {
          label: "Paper",
          message: m.notice_literature_note_profile_unknown({
            stamp: "Missing",
          }),
          recovery: { action: "switch-profile", path: "Reading/Paper.md" },
        },
      });
      return finished.promise;
    },
  });
  modal.contentEl = document.createElement("div");
  modal.onOpen();
  await vi.waitFor(() => expect(clicked).toHaveBeenCalledTimes(3));
  clicked.mock.calls[2]![0]({} as MouseEvent);
  const liveButton = modal.contentEl.querySelector<HTMLButtonElement>(
    "[data-profile-recovery]",
  )!;
  expect(liveButton.textContent).toBe(m.profile_switch_recovery());
  liveButton.click();
  expect(trigger).toHaveBeenLastCalledWith("zotlit:switch-profile", {
    path: "Reading/Paper.md",
  });
  finished.resolve({
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 1,
    cancelled: false,
  });
  await vi.waitFor(() =>
    expect(modal.contentEl.querySelector("[data-profile-recovery]")).not.toBe(
      liveButton,
    ),
  );
  const summaryButton = modal.contentEl.querySelector<HTMLButtonElement>(
    "[data-profile-recovery]",
  )!;
  expect(summaryButton).not.toBe(liveButton);
  summaryButton.click();
  expect(trigger).toHaveBeenCalledTimes(2);
});
