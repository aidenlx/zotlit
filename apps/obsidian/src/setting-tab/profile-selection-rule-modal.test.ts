// @vitest-environment happy-dom
import {
  ButtonComponent,
  DropdownComponent,
  settingsOf,
  ToggleComponent,
} from "@mock/obsidian";
import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import type { ProfileSelectionRule } from "@/services/profile-selection";

import type { SettingTabContext } from "./context";
import { ProfileSelectionRuleModal } from "./profile-selection-rule-modal";

const profileAId = "profileAAAAA" as ProfileId;

function context(overrides: Record<string, unknown> = {}): SettingTabContext {
  return {
    app: {} as App,
    profile: { profiles: [{ id: profileAId, label: "Books", document: "" }] },
    libraryScope: { libraries: [] },
    ...overrides,
  } as unknown as SettingTabContext;
}

/** The current render's rows — the child container is fresh on every change. */
function rows(modal: ProfileSelectionRuleModal) {
  return settingsOf(modal.contentEl.firstElementChild as HTMLElement);
}

function open(
  ctx: SettingTabContext,
  rule?: ProfileSelectionRule,
): ProfileSelectionRuleModal {
  const modal = new ProfileSelectionRuleModal(ctx, rule);
  modal.contentEl = document.createElement("div");
  modal.onOpen();
  return modal;
}

function dropdownOf(modal: ProfileSelectionRuleModal, name: string) {
  const setting = rows(modal).find((row) => row.name === name)!;
  return setting.components.find(
    (component) => component instanceof DropdownComponent,
  ) as DropdownComponent;
}

function buttonNamed(
  modal: ProfileSelectionRuleModal,
  text: string,
): ButtonComponent {
  return rows(modal)
    .flatMap((row) => row.components)
    .find(
      (component): component is ButtonComponent =>
        component instanceof ButtonComponent && component.text === text,
    )!;
}

describe("ProfileSelectionRuleModal", () => {
  it("saves a new rule after choosing a target Profile and an item type", async () => {
    const ctx = context();
    const modal = open(ctx);
    dropdownOf(modal, m.settings_profile_rule_target()).choose(profileAId);
    // The condition dropdowns carry no row name; find the item-type dropdown
    // by its options, which only that dropdown offers.
    const itemTypeDropdown = rows(modal)
      .flatMap((row) => row.components)
      .find(
        (component): component is DropdownComponent =>
          component instanceof DropdownComponent &&
          component.options.some((option) => option.value === "book"),
      )!;
    itemTypeDropdown.choose("book");
    buttonNamed(modal, m.settings_profile_rule_save()).click();
    await expect(modal.result).resolves.toMatchObject({
      scope: { mode: "all" },
      expression: 'itemType == "book"',
      profile: profileAId,
    });
  });

  it("disables Save with no library checked, then persists canonical order once checked", async () => {
    using disabled = vi.spyOn(ButtonComponent.prototype, "setDisabled");
    const saveDisabled = () =>
      disabled.mock.calls.findLast((_, index) => {
        const button = disabled.mock.instances[index];
        return (
          button instanceof ButtonComponent &&
          button.text === m.settings_profile_rule_save()
        );
      })?.[0];
    const ctx = context({
      libraryScope: {
        libraries: [
          { selector: { type: "personal" }, libraryID: 1, name: null },
          {
            selector: { type: "group", groupID: 5 },
            libraryID: 2,
            name: "Team",
          },
        ],
      },
    });
    const modal = open(ctx);
    dropdownOf(modal, m.settings_profile_rule_scope()).choose("selected");
    // Switching to Selected starts with My Library checked.
    const myLibraryToggle = () =>
      rows(modal)
        .find((row) => row.name === m.settings_library_scope_personal())!
        .components.find(
          (component) => component instanceof ToggleComponent,
        ) as ToggleComponent;
    expect(myLibraryToggle().getValue()).toBe(true);
    myLibraryToggle().toggle(false);
    expect(
      rows(modal).find((row) => row.name === m.settings_profile_rule_scope())!
        .errorMessage,
    ).toBe(m.settings_profile_rule_scope_empty());
    expect(saveDisabled()).toBe(true);
    // Re-check My Library and add the group.
    const availableMyLibrary = () =>
      rows(modal)
        .find((row) => row.name === m.settings_library_scope_personal())!
        .components.find(
          (component) => component instanceof ToggleComponent,
        ) as ToggleComponent;
    availableMyLibrary().toggle(true);
    const groupToggle = () =>
      rows(modal)
        .find((row) => row.name === "Team")!
        .components.find(
          (component) => component instanceof ToggleComponent,
        ) as ToggleComponent;
    groupToggle().toggle(true);
    expect(
      rows(modal).find((row) => row.name === m.settings_profile_rule_scope())!
        .errorMessage,
    ).toBeNull();
    expect(saveDisabled()).toBe(false);
    buttonNamed(modal, m.settings_profile_rule_save()).click();
    await expect(modal.result).resolves.toMatchObject({
      scope: {
        mode: "selected",
        libraries: [{ type: "personal" }, { type: "group", groupID: 5 }],
      },
    });
  });

  it("preselects the target Profile, libraries, and conditions of an existing rule", () => {
    const ctx = context({
      libraryScope: {
        libraries: [
          {
            selector: { type: "group", groupID: 5 },
            libraryID: 2,
            name: "Team",
          },
        ],
      },
    });
    const rule: ProfileSelectionRule = {
      id: "rule-1",
      scope: { mode: "selected", libraries: [{ type: "group", groupID: 5 }] },
      expression: 'itemType != "thesis"',
      profile: profileAId,
    };
    const modal = open(ctx, rule);
    expect(dropdownOf(modal, m.settings_profile_rule_target()).getValue()).toBe(
      profileAId,
    );
    expect(dropdownOf(modal, m.settings_profile_rule_scope()).getValue()).toBe(
      "selected",
    );
    const teamToggle = rows(modal)
      .find((row) => row.name === "Team")!
      .components.find(
        (component) => component instanceof ToggleComponent,
      ) as ToggleComponent;
    expect(teamToggle.getValue()).toBe(true);
    const operatorDropdown = rows(modal)
      .flatMap((row) => row.components)
      .find(
        (component): component is DropdownComponent =>
          component instanceof DropdownComponent &&
          component.getValue() === "is-not",
      );
    expect(operatorDropdown).toBeDefined();
  });

  it("shows an unrepresentable expression read-only and saves it unchanged", async () => {
    const ctx = context();
    const rule: ProfileSelectionRule = {
      id: "rule-2",
      scope: { mode: "all" },
      expression: 'itemType == "book" || itemType == "thesis"',
      profile: "default",
    };
    const modal = open(ctx, rule);
    const expressionRow = rows(modal).find(
      (row) => row.name === m.settings_profile_rule_expression(),
    );
    expect(expressionRow).toBeDefined();
    buttonNamed(modal, m.settings_profile_rule_save()).click();
    await expect(modal.result).resolves.toMatchObject({
      id: "rule-2",
      expression: 'itemType == "book" || itemType == "thesis"',
      profile: "default",
    });
  });

  it("resolves undefined on cancel", async () => {
    const ctx = context();
    const modal = open(ctx);
    buttonNamed(modal, m.modal_cancel()).click();
    await expect(modal.result).resolves.toBeUndefined();
  });
});
