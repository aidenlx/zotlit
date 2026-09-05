// @vitest-environment happy-dom
import {
  ButtonComponent,
  DropdownComponent,
  ExtraButtonComponent,
  settingsOf,
  TextAreaComponent,
  TextComponent,
  ToggleComponent,
} from "@mock/obsidian";
import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import type { ProfileSelectionRule } from "@/services/profile-selection";

import type { SettingTabContext } from "./context";
import { ProfileSelectionRuleModal } from "./profile-selection-rule-modal";

const profileAId = "profileAAAAA" as ProfileId;

const myLibrary = { selector: { type: "personal" }, libraryID: 1, name: null };
const team = {
  selector: { type: "group", groupID: 5 },
  libraryID: 2,
  name: "Team",
};

/**
 * A Zotero database with two Libraries holding a Collection of the same name
 * and key: My Library's "Project" has a "Drafts" child; Team's stands alone.
 */
function fixtureDb() {
  const client = createClient(":memory:");
  createFixtureSchema(client.$client);
  client.$client.exec(`
    insert into libraries (libraryID, type) values (1, 'user'), (2, 'group');
    insert into groups (groupID, libraryID, name) values (5, 2, 'Team');
    insert into collections (collectionID, collectionName, parentCollectionID, libraryID, key)
      values
        (100, 'Project', null, 1, 'PROJ0001'),
        (101, 'Drafts', 100, 1, 'DRFT0001'),
        (200, 'Project', null, 2, 'PROJ0001');
  `);
  return { state: "ready", client };
}

function context(overrides: Record<string, unknown> = {}): SettingTabContext {
  return {
    app: {} as App,
    profile: { profiles: [{ id: profileAId, label: "Books", document: "" }] },
    libraryScope: { libraries: [] },
    db: fixtureDb(),
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

/**
 * The condition rows carry no name: they are the rows whose first dropdown
 * offers the condition kinds, in the order the groups list them.
 */
function conditionRows(modal: ProfileSelectionRuleModal) {
  return rows(modal).filter((row) => {
    const [kind] = row.components;
    return (
      kind instanceof DropdownComponent &&
      kind.options.some((option) => option.value === "collection")
    );
  });
}

function conditionRow(modal: ProfileSelectionRuleModal) {
  return conditionRows(modal)[0]!;
}

/** The root group's footer button: nested groups list theirs first. */
function rootButton(
  modal: ProfileSelectionRuleModal,
  text: string,
): ButtonComponent {
  return rows(modal)
    .flatMap((row) => row.components)
    .filter(
      (component): component is ButtonComponent =>
        component instanceof ButtonComponent && component.text === text,
    )
    .at(-1)!;
}

function dropdowns(modal: ProfileSelectionRuleModal): DropdownComponent[] {
  return conditionRow(modal).components.filter(
    (component) => component instanceof DropdownComponent,
  );
}

/** Whether the button named `text` was last locked, from the spy's calls. */
function buttonState(
  spy: MockInstance<ButtonComponent["setDisabled"]>,
  text: string,
): boolean | undefined {
  return spy.mock.calls.findLast((_, index) => {
    const button = spy.mock.instances[index];
    return button instanceof ButtonComponent && button.text === text;
  })?.[0];
}

/** Whether Save is enabled, from the last render's button. */
function saveEnabled(
  spy: MockInstance<ButtonComponent["setDisabled"]>,
): boolean {
  return buttonState(spy, m.settings_profile_rule_save()) === false;
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

  it("starts with Match all and writes alternatives once switched to Match any", async () => {
    const modal = open(context());
    expect(dropdownOf(modal, m.settings_profile_rule_match()).getValue()).toBe(
      "all",
    );
    rootButton(modal, m.settings_profile_rule_add_condition()).click();
    const [, second] = conditionRows(modal);
    (second!.components[0] as DropdownComponent).choose("tag");
    (
      conditionRows(modal)[1]!.components.find(
        (component) => component instanceof TextComponent,
      ) as TextComponent
    ).type("Read");
    dropdownOf(modal, m.settings_profile_rule_match()).choose("any");
    buttonNamed(modal, m.settings_profile_rule_save()).click();
    await expect(modal.result).resolves.toMatchObject({
      expression: 'itemType == "book" || hasTag("Read")',
    });
  });

  it("nests a group with its own match beside an exclusion, and reads it back", async () => {
    const modal = open(context());
    // The root condition becomes the exclusion: not tagged "Read".
    const [root] = conditionRows(modal);
    (root!.components[0] as DropdownComponent).choose("tag");
    (conditionRows(modal)[0]!.components[1] as DropdownComponent).choose(
      "is-not",
    );
    (
      conditionRows(modal)[0]!.components.find(
        (component) => component instanceof TextComponent,
      ) as TextComponent
    ).type("Read");
    // A group under a "Match all" root starts as "Match any" with one row.
    rootButton(modal, m.settings_profile_rule_add_group()).click();
    const group = () =>
      rows(modal).find((row) => row.name === m.settings_profile_rule_group())!;
    expect((group().components[0] as DropdownComponent).getValue()).toBe("any");
    // The nested footer comes before the root footer.
    buttonNamed(modal, m.settings_profile_rule_add_condition()).click();
    const nested = conditionRows(modal).slice(1);
    expect(nested).toHaveLength(2);
    (nested[1]!.components[2] as DropdownComponent).choose("thesis");
    buttonNamed(modal, m.settings_profile_rule_save()).click();
    const expression =
      '!hasTag("Read") && (itemType == "book" || itemType == "thesis")';
    await expect(modal.result).resolves.toMatchObject({ expression });

    const reopened = open(context(), {
      id: "nested",
      scope: { mode: "all" },
      expression,
      profile: "default",
    });
    expect(
      dropdownOf(reopened, m.settings_profile_rule_match()).getValue(),
    ).toBe("all");
    expect(
      (
        rows(reopened).find(
          (row) => row.name === m.settings_profile_rule_group(),
        )!.components[0] as DropdownComponent
      ).getValue(),
    ).toBe("any");
    expect(
      conditionRows(reopened).map((row) =>
        row.components
          .filter((component) => component instanceof DropdownComponent)
          .slice(0, 2)
          .map((dropdown) => dropdown.getValue()),
      ),
    ).toEqual([
      ["tag", "is-not"],
      ["item-type", "is"],
      ["item-type", "is"],
    ]);
    // Removing the group leaves the exclusion on its own.
    (
      rows(reopened)
        .find((row) => row.name === m.settings_profile_rule_group())!
        .components.find(
          (component) => component instanceof ExtraButtonComponent,
        ) as ExtraButtonComponent
    ).click();
    buttonNamed(reopened, m.settings_profile_rule_save()).click();
    await expect(reopened.result).resolves.toMatchObject({
      id: "nested",
      expression: '!hasTag("Read")',
    });
  });

  it("refuses an empty nested group until it has a condition or is removed", () => {
    using disabled = vi.spyOn(ButtonComponent.prototype, "setDisabled");
    const modal = open(context());
    rootButton(modal, m.settings_profile_rule_add_group()).click();
    const group = () =>
      rows(modal).find((row) => row.name === m.settings_profile_rule_group())!;
    expect(group().errorMessage).toBeNull();
    // Remove the group's only condition.
    (
      conditionRows(modal)[1]!.components.find(
        (component) => component instanceof ExtraButtonComponent,
      ) as ExtraButtonComponent
    ).click();
    expect(group().errorMessage).toBe(m.settings_profile_rule_group_empty());
    expect(saveEnabled(disabled)).toBe(false);
    buttonNamed(modal, m.settings_profile_rule_add_condition()).click();
    expect(group().errorMessage).toBeNull();
    expect(saveEnabled(disabled)).toBe(true);
  });

  it("keeps an expression outside the contract intact in the expression editor until it is corrected", async () => {
    using disabled = vi.spyOn(ButtonComponent.prototype, "setDisabled");
    const ctx = context();
    const rule: ProfileSelectionRule = {
      id: "rule-2",
      scope: { mode: "all" },
      expression: 'title == "Zotero"',
      profile: "default",
    };
    const modal = open(ctx, rule);
    expect(
      rows(modal).find((row) => row.name === m.settings_profile_rule_match()),
    ).toBeUndefined();
    const expressionRow = () =>
      rows(modal).find(
        (row) => row.name === m.settings_profile_rule_expression(),
      )!;
    const editor = () =>
      expressionRow().components.find(
        (component) => component instanceof TextAreaComponent,
      ) as TextAreaComponent;
    expect(editor().getValue()).toBe('title == "Zotero"');
    expect(expressionRow().errorMessage).toBe(
      m.profile_rule_problem_unsupported({ text: 'title == "Zotero"' }),
    );
    expect(saveEnabled(disabled)).toBe(false);
    expect(buttonState(disabled, m.settings_profile_rule_edit_visually())).toBe(
      true,
    );
    // Editing the target alone cannot save the rule around the bad expression.
    dropdownOf(modal, m.settings_profile_rule_target()).choose(profileAId);
    expect(saveEnabled(disabled)).toBe(false);
    expect(editor().getValue()).toBe('title == "Zotero"');
    // Each keystroke is checked; a half-typed expression names the gap.
    editor().type('hasTag("Read") &&');
    expect(expressionRow().errorMessage).toBe(
      m.profile_rule_problem_syntax({ text: "" }),
    );
    expect(saveEnabled(disabled)).toBe(false);
    editor().type('hasTag("Read") && itemType == "novel"');
    expect(expressionRow().errorMessage).toBe(
      m.profile_rule_problem_unknown_item_type({ text: '"novel"' }),
    );
    editor().type('hasTag("Read") && itemType == "book"');
    expect(expressionRow().errorMessage).toBeNull();
    expect(saveEnabled(disabled)).toBe(true);
    expect(buttonState(disabled, m.settings_profile_rule_edit_visually())).toBe(
      false,
    );
    buttonNamed(modal, m.settings_profile_rule_save()).click();
    await expect(modal.result).resolves.toEqual({
      id: "rule-2",
      scope: { mode: "all" },
      expression: 'hasTag("Read") && itemType == "book"',
      profile: profileAId,
    });
  });

  it("round-trips between the visual and expression editors without changing meaning", async () => {
    const ctx = context();
    const written = '!(itemType == "book" || hasTag("Read"))';
    const modal = open(ctx, {
      id: "rule-3",
      scope: { mode: "all" },
      expression: written,
      profile: "default",
    });
    // The negated alternative reads as two exclusions under "Match all".
    expect(dropdownOf(modal, m.settings_profile_rule_match()).getValue()).toBe(
      "all",
    );
    expect(
      conditionRows(modal).map((row) =>
        (row.components[1] as DropdownComponent).getValue(),
      ),
    ).toEqual(["is-not", "is-not"]);
    // Untouched, the expression editor shows the text as written.
    buttonNamed(modal, m.settings_profile_rule_edit_as_expression()).click();
    const editor = () =>
      rows(modal)
        .find((row) => row.name === m.settings_profile_rule_expression())!
        .components.find(
          (component) => component instanceof TextAreaComponent,
        ) as TextAreaComponent;
    expect(editor().getValue()).toBe(written);
    buttonNamed(modal, m.settings_profile_rule_edit_visually()).click();
    // A visual edit writes the canonical expression.
    (conditionRows(modal)[0]!.components[1] as DropdownComponent).choose("is");
    buttonNamed(modal, m.settings_profile_rule_edit_as_expression()).click();
    expect(editor().getValue()).toBe('itemType == "book" && !hasTag("Read")');
    // A typed group comes back as a nested "Match any" group.
    editor().type(
      'itemType == "book" && (hasTag("Read") || hasTag("Read Later"))',
    );
    buttonNamed(modal, m.settings_profile_rule_edit_visually()).click();
    expect(
      (
        rows(modal).find((row) => row.name === m.settings_profile_rule_group())!
          .components[0] as DropdownComponent
      ).getValue(),
    ).toBe("any");
    expect(
      conditionRows(modal).map((row) =>
        (row.components[0] as DropdownComponent).getValue(),
      ),
    ).toEqual(["item-type", "tag", "tag"]);
    buttonNamed(modal, m.settings_profile_rule_save()).click();
    await expect(modal.result).resolves.toMatchObject({
      id: "rule-3",
      expression:
        'itemType == "book" && (hasTag("Read") || hasTag("Read Later"))',
    });
  });

  it("offers every Collection by Library and path and saves its portable reference", async () => {
    const ctx = context({ libraryScope: { libraries: [myLibrary, team] } });
    const modal = open(ctx);
    dropdowns(modal)[0]!.choose("collection");
    const [, , collection, membership] = dropdowns(modal);
    expect(collection!.options.map(({ label }) => label)).toEqual([
      "My Library: Project",
      "My Library: Project / Drafts",
      "Team: Project",
    ]);
    // Descendants are included until the user asks for direct membership.
    expect(membership!.getValue()).toBe("descendants");
    collection!.choose("personal/DRFT0001");
    dropdowns(modal)[1]!.choose("is-not");
    buttonNamed(modal, m.settings_profile_rule_save()).click();
    await expect(modal.result).resolves.toMatchObject({
      expression: '!inCollection("personal", "DRFT0001")',
    });
  });

  it("writes the direct-membership form and tells same-key Collections apart by Library", async () => {
    const ctx = context({ libraryScope: { libraries: [myLibrary, team] } });
    const modal = open(ctx);
    dropdowns(modal)[0]!.choose("collection");
    dropdowns(modal)[2]!.choose("group:5/PROJ0001");
    dropdowns(modal)[3]!.choose("direct");
    buttonNamed(modal, m.settings_profile_rule_save()).click();
    await expect(modal.result).resolves.toMatchObject({
      expression: 'inCollectionDirectly("group:5", "PROJ0001")',
    });
  });

  it("preselects an existing Collection condition and flags one the database lacks", async () => {
    using disabled = vi.spyOn(ButtonComponent.prototype, "setDisabled");
    const ctx = context({ libraryScope: { libraries: [myLibrary, team] } });
    const kept = open(ctx, {
      id: "kept",
      scope: { mode: "all" },
      expression: 'inCollectionDirectly("personal", "DRFT0001")',
      profile: "default",
    });
    expect(dropdowns(kept).map((dropdown) => dropdown.getValue())).toEqual([
      "collection",
      "is",
      "personal/DRFT0001",
      "direct",
    ]);
    expect(conditionRow(kept).errorMessage).toBeNull();
    expect(saveEnabled(disabled)).toBe(true);

    const stale = open(ctx, {
      id: "stale",
      scope: { mode: "all" },
      expression: 'inCollection("group:5", "GONE0000")',
      profile: "default",
    });
    expect(conditionRow(stale).errorMessage).toBe(
      m.settings_profile_rule_collection_missing(),
    );
    // The stale reference stays visible by its Library and key.
    expect(dropdowns(stale)[2]!.getValue()).toBe("group:5/GONE0000");
    expect(
      dropdowns(stale)[2]!.options.find(
        ({ value }) => value === "group:5/GONE0000",
      )?.label,
    ).toBe("Team: GONE0000");
    expect(saveEnabled(disabled)).toBe(false);
    dropdowns(stale)[2]!.choose("personal/PROJ0001");
    expect(conditionRow(stale).errorMessage).toBeNull();
    expect(saveEnabled(disabled)).toBe(true);
    buttonNamed(stale, m.settings_profile_rule_save()).click();
    await expect(stale.result).resolves.toMatchObject({
      id: "stale",
      expression: 'inCollection("personal", "PROJ0001")',
    });
  });

  it("saves a Tag condition as typed and refuses an empty name", async () => {
    using disabled = vi.spyOn(ButtonComponent.prototype, "setDisabled");
    const ctx = context();
    const modal = open(ctx);
    dropdowns(modal)[0]!.choose("tag");
    expect(conditionRow(modal).errorMessage).toBe(
      m.settings_profile_rule_tag_empty(),
    );
    expect(saveEnabled(disabled)).toBe(false);
    const tagInput = () =>
      conditionRow(modal).components.find(
        (component) => component instanceof TextComponent,
      ) as TextComponent;
    tagInput().type("Read Later");
    expect(conditionRow(modal).errorMessage).toBeNull();
    expect(saveEnabled(disabled)).toBe(true);
    buttonNamed(modal, m.settings_profile_rule_save()).click();
    await expect(modal.result).resolves.toMatchObject({
      expression: 'hasTag("Read Later")',
    });
  });

  it("explains grouping, descendant, and exact-Tag matching beside the conditions", () => {
    const modal = open(context());
    const heading = rows(modal).find(
      (row) => row.name === m.settings_profile_rule_conditions(),
    )!;
    const help = (heading.desc as unknown as DocumentFragment).textContent;
    expect(help).toContain(m.settings_profile_rule_group_help());
    expect(help).toContain(m.settings_profile_rule_collection_help());
    expect(help).toContain(m.settings_profile_rule_tag_help());
  });

  it("resolves undefined on cancel", async () => {
    const ctx = context();
    const modal = open(ctx);
    buttonNamed(modal, m.modal_cancel()).click();
    await expect(modal.result).resolves.toBeUndefined();
  });
});
