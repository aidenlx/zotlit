// @vitest-environment happy-dom
import type { App } from "obsidian";
import { afterEach, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

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
  const migration = { prepare: vi.fn(async () => review), activate: vi.fn() };
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
