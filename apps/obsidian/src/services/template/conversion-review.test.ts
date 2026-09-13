// @vitest-environment happy-dom
import type { App } from "obsidian";
import { afterEach, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import type { ConversionCopy, ConversionRepairReview } from "./conversion-copy";
import { TemplateConversionReviewModal } from "./conversion-review";
import type { LiteratureNoteTemplateConversionReview } from "./migration";

vi.mock("obsidian", async (importOriginal) => {
  const original = await importOriginal<typeof import("obsidian")>();
  return {
    ...original,
    Modal: class extends original.Modal {
      override open(): void {
        this.modalEl.append(this.contentEl);
        super.open();
        void this.onOpen();
      }
      override close(): void {
        super.close();
        this.onClose();
      }
    },
  };
});

afterEach(() => document.body.replaceChildren());

it("renders source and verification evidence before the explicit activation action", async () => {
  const review: LiteratureNoteTemplateConversionReview = {
    inputs: [
      {
        kind: "profile",
        path: "templates/zotlit-note.liquid.md",
        source: "# Research",
        destination: "templates/zotlit-profile.default.md",
      },
    ],
    kept: [],
    fields: [
      { key: "title", expr: "zt.title", language: "liquid", merge: "replace" },
    ],
    annotation: false,
    selected: {
      item: "Research paper",
      annotation: null,
      citation: ["smith2024"],
    },
    preparation: {
      outcome: "prepared",
      documents: [
        {
          path: "templates/zotlit-profile.default.md",
          source: "# Converted research",
        },
      ],
    },
  };
  const migration = {
    resumeRepair: async () => null,
    startRepair: vi.fn(),
    reviewRepair: vi.fn(),
    acceptRepair: vi.fn(),
    discardRepair: vi.fn(),
    refreshRepairOriginals: vi.fn(),
    prepare: vi.fn(async () => review),
    activate: vi.fn(async () => ({
      outcome: "converted" as const,
      document: "zotlit-profile.default.md",
      documents: ["templates/zotlit-profile.default.md"],
      pendingCleanup: [],
      trashed: [],
      kept: [],
    })),
  };
  const completed = vi.fn();
  const modal = new TemplateConversionReviewModal({} as App, {
    migration,
    completed,
  });
  modal.open();
  await vi.waitFor(() =>
    expect(modal.contentEl.textContent).toContain(
      m.conversion_review_matching(),
    ),
  );
  expect(modal.contentEl.textContent).toContain(
    "templates/zotlit-note.liquid.md → templates/zotlit-profile.default.md",
  );
  expect(modal.contentEl.textContent).toContain('"key": "title"');
  expect(modal.contentEl.textContent).toContain(
    m.conversion_review_frontmatter_scope(),
  );
  expect(migration.activate).not.toHaveBeenCalled();
  expect(modal.modalEl.classList.contains("mod-scrollable-content")).toBe(true);
  expect(
    modal.contentEl.nextElementSibling?.classList.contains(
      "modal-button-container",
    ),
  ).toBe(true);
  expect(modal.contentEl.querySelector("button")).toBeNull();
  const accept = [...modal.modalEl.querySelectorAll("button")].find(
    (button) => button.textContent === m.conversion_review_activate(),
  );
  accept!.click();
  await vi.waitFor(() => expect(completed).toHaveBeenCalledOnce());
  expect(migration.activate).toHaveBeenCalledWith(review);
});

it("shows a refusal with original source evidence and keeps activation unavailable", async () => {
  const review: LiteratureNoteTemplateConversionReview = {
    inputs: [
      {
        kind: "citation",
        path: "templates/zotlit-cite.liquid.md",
        source: '{% render "cite" %}',
        destination: "templates/zotlit-citation.md",
      },
    ],
    kept: [],
    fields: [],
    annotation: false,
    selected: {
      item: "Research paper",
      annotation: null,
      citation: ["smith2024"],
    },
    preparation: {
      outcome: "refused",
      diagnostic: {
        code: "unsupported-legacy-template",
        message: "Citation calls a retired source",
        difference: "cite",
        hint: "Use the copied citation source.",
      },
    },
  };
  const migration = {
    resumeRepair: async () => null,
    startRepair: vi.fn(),
    reviewRepair: vi.fn(),
    acceptRepair: vi.fn(),
    discardRepair: vi.fn(),
    refreshRepairOriginals: vi.fn(),
    prepare: vi.fn(async () => review),
    activate: vi.fn(),
  };
  const modal = new TemplateConversionReviewModal({} as App, {
    migration,
    completed: vi.fn(),
  });
  modal.open();
  await vi.waitFor(() =>
    expect(modal.contentEl.textContent).toContain(
      "Citation calls a retired source",
    ),
  );
  expect(modal.contentEl.textContent).toContain('{% render "cite" %}');
  expect(
    [...modal.modalEl.querySelectorAll("button")].map(
      (button) => button.textContent,
    ),
  ).toEqual([m.conversion_review_retry(), m.conversion_review_later()]);
  modal.close();
  expect(migration.activate).not.toHaveBeenCalled();
});

it("distinguishes unavailable original evaluation and sends explicit repaired acceptance", async () => {
  const review: ConversionRepairReview = {
    copy: "templates/conversion-copy-review/conversion.json",
    itemKey: "TYY6Z6ZF",
    comparisons: [
      {
        output: "create",
        outcome: "matching",
        original: "Original body",
        candidate: "Original body",
      },
      {
        output: "frontmatter",
        outcome: "original-unavailable",
        original: null,
        candidate: '{"repair-field":"reviewed-1098"}',
        error: {
          code: "evaluation-failed",
          detail: "Original expression could not evaluate",
        },
      },
    ],
    valid: true,
    requiresAcceptance: true,
    diagnostic: null,
    documents: [],
  };
  const migration = {
    prepare: vi.fn(),
    activate: vi.fn(),
    startRepair: vi.fn(),
    resumeRepair: async () => ({}) as ConversionCopy,
    reviewRepair: async () => review,
    acceptRepair: vi.fn(async () => ({
      outcome: "converted" as const,
      document: "zotlit-profile.default.md",
      documents: [],
      pendingCleanup: [],
      trashed: [],
      kept: [],
    })),
    discardRepair: vi.fn(),
    refreshRepairOriginals: vi.fn(),
  };
  const completed = vi.fn();
  const modal = new TemplateConversionReviewModal({} as App, {
    migration,
    completed,
  });
  modal.open();
  await vi.waitFor(() =>
    expect(modal.contentEl.textContent).toContain(
      m.conversion_repair_unavailable(),
    ),
  );
  expect(modal.contentEl.textContent).toContain(m.conversion_repair_matching());
  expect(modal.contentEl.textContent).toContain("reviewed-1098");
  expect(modal.contentEl.textContent).toContain(
    "Original expression could not evaluate",
  );
  const buttons = [...modal.modalEl.querySelectorAll("button")];
  expect(
    buttons.some(
      (button) => button.textContent === m.conversion_review_activate(),
    ),
  ).toBe(false);
  buttons
    .find(
      (button) => button.textContent === m.conversion_repair_accept_changes(),
    )!
    .click();
  await vi.waitFor(() => expect(completed).toHaveBeenCalledOnce());
  expect(migration.acceptRepair).toHaveBeenCalledWith(
    review,
    "reviewed-changes",
  );
});

it.each([
  [
    { code: "no-verification-item" as const },
    () => m.notice_literature_note_template_conversion_no_item(),
  ],
  [
    { code: "javascript-required" as const, fields: ["repair-marker"] },
    () => m.conversion_repair_javascript_required({ fields: "repair-marker" }),
  ],
  [
    { code: "managed-block-missing" as const },
    () => m.conversion_repair_managed_block_missing(),
  ],
])("shows localized repair guidance for %j", async (diagnostic, message) => {
  const review: ConversionRepairReview = {
    copy: "templates/conversion-copy-guidance/conversion.json",
    comparisons: [],
    valid: false,
    requiresAcceptance: false,
    diagnostic,
    documents: [],
  };
  const migration = {
    prepare: vi.fn(),
    activate: vi.fn(),
    startRepair: vi.fn(),
    resumeRepair: async () => ({}) as ConversionCopy,
    reviewRepair: async () => review,
    acceptRepair: vi.fn(),
    discardRepair: vi.fn(),
    refreshRepairOriginals: vi.fn(),
  };
  const modal = new TemplateConversionReviewModal({} as App, {
    migration,
    completed: vi.fn(),
  });
  modal.open();
  await vi.waitFor(() =>
    expect(modal.contentEl.textContent).toContain(message()),
  );
  expect(
    [...modal.modalEl.querySelectorAll("button")].some(
      (button) => button.textContent === m.conversion_review_activate(),
    ),
  ).toBe(false);
  modal.close();
});
