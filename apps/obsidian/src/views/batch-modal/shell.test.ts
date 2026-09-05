// @vitest-environment happy-dom
import { ButtonComponent } from "obsidian";
import type { App } from "obsidian";
import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import { BatchModal, FlatManifest } from "./index";
import type { BatchProfileChoice } from "./index";
import type { BatchRunResult } from "./index";

function observeButtons() {
  using stack = new DisposableStack();
  const labels = stack.use(
    vi.spyOn(ButtonComponent.prototype, "setButtonText"),
  );
  const clicks = stack.use(vi.spyOn(ButtonComponent.prototype, "onClick"));
  const cleanup = stack.move();
  const instance = (label: string) =>
    labels.mock.instances[
      labels.mock.calls.findLastIndex(([text]) => text === label)
    ];
  return {
    has: (label: string) => instance(label) !== undefined,
    click(label: string) {
      clicks.mock.calls[clicks.mock.instances.lastIndexOf(instance(label))]![0](
        {} as MouseEvent,
      );
    },
    [Symbol.dispose]: () => cleanup.dispose(),
  };
}

it.each([
  ["headless", () => m.batch_profile_source_companion()],
  ["asked", () => m.batch_profile_source_chosen()],
] as const)(
  "shows a %s Profile chip with row path and a read-only stamp",
  (source, caption) => {
    const choice: BatchProfileChoice = {
      label: "Articles",
      source,
      choose: vi.fn(),
    };
    const chooseProfile = vi.fn();
    const manifest = new FlatManifest({
      tasks: [
        {
          id: 1,
          label: "New paper",
          kind: "create",
          path: "Articles/New.md",
          profile: "Articles",
        },
        { id: 2, label: "Existing paper", kind: "update", profile: "Books" },
      ],
      groups: [
        {
          kind: "create",
          header: m.batch_update_group_create,
          profileChoice: choice,
        },
        { kind: "update", header: m.batch_update_group_update },
      ],
      notFound: [],
      notFoundHeader: m.batch_update_group_not_found,
      abortedHeader: m.batch_update_group_aborted,
    });
    const container = document.createElement("div");
    manifest.renderList(container, { chooseProfile });
    const chip = container.querySelector<HTMLButtonElement>(
      "[data-profile-choice]",
    )!;
    expect(chip.textContent).toBe(
      m.batch_profile_destination({ label: "Articles" }),
    );
    expect(container.textContent).toContain(caption());
    expect(container.textContent).toContain("Articles/New.md");
    expect(container.querySelector("[data-profile-stamp]")?.textContent).toBe(
      "Articles",
    );
    chip.click();
    expect(chooseProfile).toHaveBeenCalledExactlyOnceWith(choice);
  },
);

it("names completed Profile groups with their own counts and retains kept rows", () => {
  const manifest = new FlatManifest({
    tasks: [
      { id: 1, kind: "update", label: "Book one", profile: "Books" },
      { id: 2, kind: "update", label: "Book failed", profile: "Books" },
      { id: 3, kind: "update", label: "Article", profile: "Articles" },
    ],
    groups: [{ kind: "update", header: m.batch_update_group_update }],
    kept: [{ label: "Kept paper", profile: "Books", reason: "Existing stamp" }],
    keptHeader: m.batch_profile_kept_header,
    notFound: [],
    notFoundHeader: m.batch_update_group_not_found,
    abortedHeader: m.batch_update_group_aborted,
  });
  const container = document.createElement("div");
  manifest.renderSummary(
    container,
    new Map([
      [1, "done"],
      [2, "failed"],
      [3, "done"],
    ]),
  );
  expect(
    [...container.querySelectorAll("summary")].map((el) => el.textContent),
  ).toEqual([
    m.batch_profile_group({
      group: m.batch_update_group_update({ count: 1 }),
      profile: "Books",
    }),
    m.batch_profile_group({
      group: m.batch_update_group_update({ count: 1 }),
      profile: "Articles",
    }),
    m.batch_profile_kept_header({ count: 1 }),
  ]);
  expect(container.textContent).toContain("Kept paper");
  expect(container.textContent).not.toContain("Book failed");
  expect(container.querySelector("[data-profile-choice]")).toBeNull();
});

it("refreshes the chip and every path after choosing, and blocks Run while previews are pending", async () => {
  using buttons = observeButtons();
  const pending = Promise.withResolvers<void>();
  const task = {
    id: 1,
    label: "Paper",
    kind: "create",
    path: "Articles/Paper.md",
    profile: "Articles",
  };
  const choice: BatchProfileChoice = {
    label: "Articles",
    source: "bound",
    choose: async () => {
      await pending.promise;
      Object.assign(task, { path: "Books/Paper.md", profile: "Books" });
      Object.assign(choice, { label: "Books", source: "asked" });
    },
  };
  const onRun = vi.fn(
    async (): Promise<BatchRunResult> => ({
      created: 1,
      updated: 0,
      skipped: 0,
      failed: 0,
      cancelled: false,
    }),
  );
  const modal = new BatchModal({} as App, {
    total: 1,
    text: {
      title: m.batch_update_title(),
      loadingLabel: m.batch_update_loading_label(),
      loadFailed: m.batch_update_load_failed(),
      runFailed: m.batch_update_run_failed(),
      progressLabel: m.batch_update_progress_label(),
      confirmIntro: () => "",
      confirmButton: m.batch_update_confirm_button(),
      runSummary: m.batch_update_summary,
    },
    onClassify: async () =>
      new FlatManifest({
        tasks: [task],
        groups: [
          {
            kind: "create",
            header: m.batch_update_group_create,
            profileChoice: choice,
          },
        ],
        notFound: [],
        notFoundHeader: m.batch_update_group_not_found,
        abortedHeader: m.batch_update_group_aborted,
      }),
    onRun,
  });
  modal.contentEl = document.createElement("div");
  modal.onOpen();
  await vi.waitFor(() =>
    expect(
      modal.contentEl.querySelector("[data-profile-choice]"),
    ).not.toBeNull(),
  );
  modal.contentEl
    .querySelector<HTMLButtonElement>("[data-profile-choice]")!
    .click();
  buttons.click(m.batch_update_confirm_button());
  expect(onRun).not.toHaveBeenCalled();
  pending.resolve();
  await vi.waitFor(() =>
    expect(modal.contentEl.textContent).toContain("Books/Paper.md"),
  );
  expect(modal.contentEl.textContent).toContain(
    m.batch_profile_source_chosen(),
  );
  expect(modal.contentEl.textContent).not.toContain("Articles/Paper.md");
  modal.onClose();
});

it("offers note recovery in both the live failure panel and the completed summary", async () => {
  using buttons = observeButtons();
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
  await vi.waitFor(() =>
    expect(buttons.has(m.batch_update_confirm_button())).toBe(true),
  );
  buttons.click(m.batch_update_confirm_button());
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
