// @vitest-environment happy-dom
import { ButtonComponent, ConfirmationModal } from "obsidian";
import type { App, TFile } from "obsidian";
import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import type { ProfileDeletionPlan } from "@/services/profile/service";
import { defaults } from "@/services/settings/schema";

import { confirmProfileDeletion } from "./profiles";

const books = "Bk3Qn7XvT2Lp" as ProfileId;
const papers = "Rz9Wm4YfH6Kd" as ProfileId;
const booksRule = {
  id: "books",
  scope: { mode: "all" },
  expression: 'itemType == "book"',
  profile: books,
} as const;
function plan(
  used = false,
  rules: ProfileDeletionPlan["rules"] = [],
): ProfileDeletionPlan {
  const reader = profileReader({
    ...defaults,
    profiles: [
      {
        id: papers,
        label: "Papers",
        bindings: {
          "note.literature-folder": "Books",
          "note.import-folder": "Imports",
        },
      },
    ],
  });
  const literature = {
    path: "Books/My title.md",
    name: "My title.md",
  } as TFile;
  const imported = { path: "Imports/Child.md", name: "Child.md" } as TFile;
  return {
    source: {
      id: books,
      label: "Books",
      document: "zotlit-profile.books.md",
      path: "templates/zotlit-profile.books.md",
      bindings: {},
    },
    literatureNotes: used ? [literature] : [],
    importedNotes: used ? [imported] : [],
    targets: [
      {
        profile: reader.resolveProfile("default")!,
        files: used
          ? [
              { file: literature, path: "literatures/My title.md" },
              { file: imported, path: "zotero_notes/Child.md" },
            ]
          : [],
      },
      {
        profile: reader.resolveProfile(papers)!,
        files: used
          ? [
              { file: literature, path: literature.path },
              { file: imported, path: imported.path },
            ]
          : [],
      },
    ],
    rules,
  };
}

it("confirms an unused Profile with configured trash and no target control", async () => {
  using opened = vi.spyOn(ConfirmationModal.prototype, "open");
  using content = vi.spyOn(ConfirmationModal.prototype, "setContent");
  using action = vi.spyOn(ButtonComponent.prototype, "setButtonText");
  const decision = confirmProfileDeletion({} as App, { plan: plan() });
  const modal = opened.mock.instances[0] as ConfirmationModal;
  expect(content).toHaveBeenCalledWith(
    `${m.settings_profile_delete_unused()}\n\n${m.settings_profile_delete_confirm_body()}`,
  );
  expect(modal.contentEl.querySelector("input")).toBeNull();
  expect(modal.contentEl.textContent).not.toContain(
    m.settings_profile_delete_rules_repair(),
  );
  expect(action).toHaveBeenCalledWith(m.settings_profile_delete());
  modal.close();
  await expect(decision).resolves.toBeUndefined();
});

it("warns about referencing rules without a target control when no notes use the Profile, and still deletes", async () => {
  using opened = vi.spyOn(ConfirmationModal.prototype, "open");
  using action = vi.spyOn(ButtonComponent.prototype, "setButtonText");
  using clicked = vi.spyOn(ButtonComponent.prototype, "onClick");
  const decision = confirmProfileDeletion({} as App, {
    plan: plan(false, [booksRule]),
  });
  const modal = opened.mock.instances[0] as ConfirmationModal;
  expect(modal.contentEl.querySelector("input")).toBeNull();
  const text = modal.contentEl.textContent;
  expect(text).toContain(m.settings_profile_delete_rules_count({ count: 1 }));
  expect(text).toContain(
    m.settings_profile_rule_summary({
      conditions: m.settings_profile_rule_item_type_is({ type: "Book" }),
      libraries: m.settings_library_scope_all(),
    }),
  );
  expect(text).toContain(m.settings_profile_delete_rules_repair());
  // The warning is not a gate: the delete action resolves as before.
  expect(action).toHaveBeenCalledWith(m.settings_profile_delete());
  clicked.mock.calls[0]![0]({} as MouseEvent);
  await expect(decision).resolves.toEqual({ target: "default", move: false });
});

it("lists every referencing rule below the note target chooser", async () => {
  using opened = vi.spyOn(ConfirmationModal.prototype, "open");
  const thesisRule = {
    ...booksRule,
    id: "thesis",
    expression: 'itemType == "thesis"',
  };
  void confirmProfileDeletion({} as App, {
    plan: plan(true, [booksRule, thesisRule]),
  });
  const modal = opened.mock.instances[0] as ConfirmationModal;
  expect(modal.contentEl.querySelectorAll('input[type="radio"]')).toHaveLength(
    2,
  );
  const text = modal.contentEl.textContent;
  expect(text).toContain(m.settings_profile_delete_rules_count({ count: 2 }));
  expect(
    Array.from(modal.contentEl.querySelectorAll("li"), (li) => li.textContent),
  ).toEqual([
    m.settings_profile_rule_summary({
      conditions: m.settings_profile_rule_item_type_is({ type: "Book" }),
      libraries: m.settings_library_scope_all(),
    }),
    m.settings_profile_rule_summary({
      conditions: m.settings_profile_rule_item_type_is({ type: "Thesis" }),
      libraries: m.settings_library_scope_all(),
    }),
  ]);
  expect(text).toContain(m.settings_profile_delete_rules_repair());
  modal.close();
});

it("shows both counts and informed Default target, changing the move option with the target folders", async () => {
  using opened = vi.spyOn(ConfirmationModal.prototype, "open");
  using content = vi.spyOn(ConfirmationModal.prototype, "setContent");
  using action = vi.spyOn(ButtonComponent.prototype, "setButtonText");
  using clicked = vi.spyOn(ButtonComponent.prototype, "onClick");
  const decision = confirmProfileDeletion({} as App, { plan: plan(true) });
  const modal = opened.mock.instances[0] as ConfirmationModal;
  expect(content.mock.calls[0]![0]).toContain(
    m.settings_profile_delete_literature_count({ count: 1 }),
  );
  expect(content.mock.calls[0]![0]).toContain(
    m.settings_profile_delete_imported_count({ count: 1 }),
  );
  expect(content.mock.calls[0]![0]).toContain(
    m.settings_profile_delete_move_desc(),
  );
  expect(modal.contentEl.textContent).toContain(
    m.modal_profile_switch_effects(),
  );
  expect(modal.contentEl.textContent).toContain("literatures/My title.md");
  expect(modal.contentEl.textContent).toContain("zotero_notes/Child.md");
  const radios = modal.contentEl.querySelectorAll<HTMLInputElement>(
    'input[type="radio"]',
  );
  expect(radios).toHaveLength(2);
  expect(radios[0]!.checked).toBe(true);
  const checkbox = modal.contentEl.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  )!;
  expect(checkbox.checked).toBe(false);
  expect(checkbox.parentElement!.hidden).toBe(false);
  expect(action).toHaveBeenCalledWith(
    m.settings_profile_delete_move_confirm({ count: 2 }),
  );
  radios[1]!.checked = true;
  radios[1]!.dispatchEvent(new Event("change"));
  expect(checkbox.parentElement!.hidden).toBe(true);
  clicked.mock.calls[0]![0]({} as MouseEvent);
  await expect(decision).resolves.toEqual({ target: papers, move: false });
});
