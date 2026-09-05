// @vitest-environment happy-dom
import { ExtraButtonComponent, Setting } from "@mock/obsidian";
import type {
  ExtraButtonComponent as ObsidianExtraButton,
  Setting as ObsidianSetting,
  SettingDefinitionItem,
  SettingDefinitionList,
} from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import type { ProfileSelectionRule } from "@/services/profile-selection";
import { defaults } from "@/services/settings/schema";

import type { SettingsControlKey, SettingTabContext } from "./context";
import { editProfileSelectionRule } from "./profile-selection-rule-modal";
import { profileSelectionRuleItems } from "./profile-selection-rules";

vi.mock("./profile-selection-rule-modal", () => ({
  editProfileSelectionRule: vi.fn(),
}));

const profileAId = "profileAAAAA" as ProfileId;
const missingId = "missingXXXXX" as ProfileId;

const groupRule: ProfileSelectionRule = {
  id: "rule-1",
  scope: { mode: "all" },
  expression: 'itemType == "book"',
  profile: profileAId,
};

const brokenRule: ProfileSelectionRule = {
  id: "rule-2",
  scope: { mode: "all" },
  expression: "itemType == ",
  profile: "default",
};

const unavailableRule: ProfileSelectionRule = {
  id: "rule-3",
  scope: { mode: "all" },
  expression: "true",
  profile: missingId,
};

const collectionRule: ProfileSelectionRule = {
  id: "rule-4",
  scope: { mode: "all" },
  expression: 'inCollection("personal", "DRFT0001") && hasTag("Read")',
  profile: profileAId,
};

const staleCollectionRule: ProfileSelectionRule = {
  id: "rule-5",
  scope: { mode: "all" },
  expression: 'inCollection("personal", "GONE0000")',
  profile: profileAId,
};

/** My Library with "Project" and its "Drafts" child. */
function fixtureDb() {
  const client = createClient(":memory:");
  createFixtureSchema(client.$client);
  client.$client.exec(`
    insert into libraries (libraryID, type) values (1, 'user');
    insert into collections (collectionID, collectionName, parentCollectionID, libraryID, key)
      values (100, 'Project', null, 1, 'PROJ0001'), (101, 'Drafts', 100, 1, 'DRFT0001');
  `);
  return { state: "ready", client };
}

function context(
  rules: readonly ProfileSelectionRule[] = [],
): SettingTabContext {
  return {
    settings: {
      current: { ...defaults, "profile.selection-rules": rules },
      update: vi.fn(),
    },
    profile: {
      profiles: [{ id: profileAId, label: "Reading", document: "" }],
    },
    libraryScope: {
      libraries: [{ selector: { type: "personal" }, libraryID: 1, name: null }],
    },
    db: fixtureDb(),
    requestUpdate: vi.fn(),
  } as unknown as SettingTabContext;
}

function list(
  ctx: SettingTabContext,
): SettingDefinitionList<SettingsControlKey> {
  const found = profileSelectionRuleItems(ctx).find(
    (row): row is SettingDefinitionList<SettingsControlKey> =>
      "type" in row && row.type === "list",
  );
  if (!found) throw new Error("Expected a list row");
  return found;
}

function render(row: SettingDefinitionItem<SettingsControlKey>): Setting {
  if (!("render" in row) || !row.render)
    throw new Error("Expected a render row");
  const setting = new Setting(document.createElement("div"));
  row.render(setting as unknown as ObsidianSetting, {} as never);
  return setting;
}

beforeEach(() => {
  vi.mocked(editProfileSelectionRule).mockReset();
});

describe("Profile Selection Rules settings", () => {
  it("names the info row and the list heading", () => {
    const ctx = context();
    const items = profileSelectionRuleItems(ctx);
    expect(items[0]).toMatchObject({
      name: m.settings_profile_rules_name(),
      desc: m.settings_profile_rules_desc(),
    });
    expect(list(ctx).heading).toBe(m.settings_profile_rules_heading());
    expect(list(ctx).emptyState).toBe(m.settings_profile_rules_empty());
  });

  it("names each row by its target Profile and summarizes the rule", () => {
    const ctx = context([groupRule]);
    const rows = list(ctx).items!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Reading");
    expect((rows[0] as { desc: DocumentFragment }).desc.textContent).toContain(
      m.settings_profile_rule_item_type_is({
        type: "Book",
      }),
    );
  });

  it("uses the Default label for the built-in Profile", () => {
    const ctx = context([brokenRule]);
    const rows = list(ctx).items!;
    expect(rows[0]!.name).toBe(m.settings_profile_default_name());
  });

  it("flags a broken expression as a warning", () => {
    const ctx = context([brokenRule]);
    const rows = list(ctx).items!;
    const desc = (rows[0] as { desc: DocumentFragment }).desc;
    const warning = desc.querySelector(".mod-warning");
    expect(warning?.textContent).toBeTruthy();
    expect(desc.textContent).toContain("This rule cannot be evaluated");
  });

  it("names a Collection condition by its Library and path, and a Tag by its exact name", () => {
    const ctx = context([collectionRule]);
    const desc = (list(ctx).items![0] as { desc: DocumentFragment }).desc;
    expect(desc.textContent).toContain(
      m.settings_profile_rule_in_collection({
        collection: "My Library: Project / Drafts",
      }),
    );
    expect(desc.textContent).toContain(
      m.settings_profile_rule_has_tag({ tag: "Read" }),
    );
    expect(desc.querySelector(".mod-warning")).toBeNull();
  });

  it("flags a Collection reference the database lacks as a broken rule", () => {
    const ctx = context([staleCollectionRule]);
    const desc = (list(ctx).items![0] as { desc: DocumentFragment }).desc;
    expect(desc.querySelector(".mod-warning")?.textContent).toBe(
      m.settings_profile_rule_broken({
        problem: m.profile_rule_problem_missing_collection({
          collection: "My Library: GONE0000",
        }),
      }),
    );
  });

  it("flags an unavailable target Profile as a warning", () => {
    const ctx = context([unavailableRule]);
    const rows = list(ctx).items!;
    const desc = (rows[0] as { desc: DocumentFragment }).desc;
    const warning = desc.querySelector(".mod-warning");
    expect(warning?.textContent).toBe(
      m.settings_profile_rule_target_unavailable(),
    );
  });

  it("opens the editor for a new rule from the add action, then persists it", async () => {
    const ctx = context([groupRule]);
    vi.mocked(editProfileSelectionRule).mockResolvedValue(brokenRule);
    list(ctx).addItem!.action(document.createElement("div"));
    expect(editProfileSelectionRule).toHaveBeenCalledWith(ctx, undefined);
    await vi.waitFor(() =>
      expect(ctx.settings.update).toHaveBeenCalledWith({
        "profile.selection-rules": [groupRule, brokenRule],
      }),
    );
    expect(ctx.requestUpdate).toHaveBeenCalledOnce();
  });

  it("opens the editor for an existing rule from its pencil button, then persists the edit in place", async () => {
    const ctx = context([groupRule, brokenRule]);
    const edited: ProfileSelectionRule = { ...brokenRule, expression: "true" };
    vi.mocked(editProfileSelectionRule).mockResolvedValue(edited);
    const rows = list(ctx).items!;
    const setting = render(rows[1]!);
    const button = setting.components.find(
      (component) => component instanceof ExtraButtonComponent,
    ) as ObsidianExtraButton & ExtraButtonComponent;
    expect(button.icon).toBe("pencil");
    expect(button.tooltip).toBe(m.settings_profile_rules_edit());
    button.click();
    await vi.waitFor(() =>
      expect(ctx.settings.update).toHaveBeenCalledWith({
        "profile.selection-rules": [groupRule, edited],
      }),
    );
    expect(editProfileSelectionRule).toHaveBeenCalledWith(ctx, brokenRule);
    expect(ctx.requestUpdate).toHaveBeenCalledOnce();
  });

  it("does not persist when the editor is cancelled", async () => {
    const ctx = context([groupRule]);
    const modal = Promise.resolve<ProfileSelectionRule | undefined>(undefined);
    vi.mocked(editProfileSelectionRule).mockReturnValue(modal);
    list(ctx).addItem!.action(document.createElement("div"));
    await modal;
    await Promise.resolve();
    expect(ctx.settings.update).not.toHaveBeenCalled();
    expect(ctx.requestUpdate).not.toHaveBeenCalled();
  });

  it("reorders by index and persists the new order", () => {
    const ctx = context([groupRule, brokenRule, unavailableRule]);
    list(ctx).onReorder!(0, 2);
    expect(ctx.settings.update).toHaveBeenCalledWith({
      "profile.selection-rules": [brokenRule, unavailableRule, groupRule],
    });
    expect(ctx.requestUpdate).toHaveBeenCalledOnce();
  });

  it("deletes by index and persists the removal", () => {
    const ctx = context([groupRule, brokenRule, unavailableRule]);
    list(ctx).onDelete!(1);
    expect(ctx.settings.update).toHaveBeenCalledWith({
      "profile.selection-rules": [groupRule, unavailableRule],
    });
    expect(ctx.requestUpdate).toHaveBeenCalledOnce();
  });
});
