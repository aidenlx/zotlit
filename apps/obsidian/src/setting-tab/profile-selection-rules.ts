// The ordered Profile Selection Rules list on the Literature note profiles page.
import type { SettingDefinitionItem, SettingDefinitionList } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileSelector } from "@/lib/profile-stamp";
import {
  describeProblem,
  describeRule,
  diagnoseRule,
} from "@/services/profile-selection";
import type {
  DescribeOptions,
  ProfileSelectionRule,
} from "@/services/profile-selection";

import type { SettingsControlKey, SettingTabContext } from "./context";
import { editProfileSelectionRule } from "./profile-selection-rule-modal";

/**
 * The Profile Selection Rules rows: an info row naming the feature, then the
 * ordered list itself. List order is priority order — {@link
 * SettingDefinitionList.onReorder} and `onDelete` persist it directly, since
 * the DOM (and Obsidian's own reorder) already reflects the new order.
 */
export function profileSelectionRuleItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsControlKey>[] {
  return [
    {
      name: m.settings_profile_rules_name(),
      desc: m.settings_profile_rules_desc(),
    },
    rulesList(ctx),
  ];
}

function rulesList(
  ctx: SettingTabContext,
): SettingDefinitionList<SettingsControlKey> {
  const rules = ctx.settings.current?.["profile.selection-rules"] ?? [];
  // Library names are read only when a row needs them.
  const display = rules.length > 0 ? displayOptions(ctx) : {};
  return {
    type: "list",
    heading: m.settings_profile_rules_heading(),
    emptyState: m.settings_profile_rules_empty(),
    addItem: {
      name: m.settings_profile_rules_add(),
      action: () => void openEditor(ctx, rules),
    },
    onReorder: (oldIndex, newIndex) => {
      const next = [...rules];
      const [moved] = next.splice(oldIndex, 1);
      if (moved) next.splice(newIndex, 0, moved);
      persist(ctx, next);
    },
    onDelete: (index) => {
      persist(
        ctx,
        rules.filter((_, at) => at !== index),
      );
    },
    items: rules.map((rule) => ({
      name: targetLabel(ctx, rule.profile),
      desc: ruleDesc(ctx, rule, display),
      searchable: false,
      render: (setting) => {
        setting.addExtraButton((button) =>
          button
            .setIcon("pencil")
            .setTooltip(m.settings_profile_rules_edit())
            .onClick(() => void openEditor(ctx, rules, rule)),
        );
      },
    })),
  };
}

async function openEditor(
  ctx: SettingTabContext,
  rules: readonly ProfileSelectionRule[],
  rule?: ProfileSelectionRule,
): Promise<void> {
  const edited = await editProfileSelectionRule(ctx, rule);
  if (!edited) return;
  const index = rule ? rules.findIndex(({ id }) => id === rule.id) : -1;
  const next =
    index === -1
      ? [...rules, edited]
      : rules.map((entry, at) => (at === index ? edited : entry));
  persist(ctx, next);
}

function persist(
  ctx: SettingTabContext,
  next: readonly ProfileSelectionRule[],
): void {
  ctx.settings.update({ "profile.selection-rules": next });
  ctx.requestUpdate();
}

/** The Profile a rule targets, by the same label the Profiles page uses. */
function targetLabel(
  ctx: SettingTabContext,
  selector: ProfileSelector,
): string {
  if (selector === "default") return m.settings_profile_default_name();
  const profile = ctx.profile.profiles.find(({ id }) => id === selector);
  return profile ? profile.label : selector;
}

/** Library names, read once per render of the rows. */
function displayOptions(ctx: SettingTabContext): DescribeOptions {
  return { libraries: ctx.libraryScope.libraries };
}

function ruleDesc(
  ctx: SettingTabContext,
  rule: ProfileSelectionRule,
  display: DescribeOptions,
): DocumentFragment {
  const desc = createFragment();
  desc.append(describeRule(rule, display));
  const targetAvailable =
    rule.profile === "default" ||
    ctx.profile.profiles.some(({ id }) => id === rule.profile);
  if (!targetAvailable) {
    desc.append(createEl("br"));
    desc.append(
      createSpan({
        cls: "mod-warning",
        text: m.settings_profile_rule_target_unavailable(),
      }),
    );
  }
  const { problem } = diagnoseRule(rule, display.libraries ?? []);
  if (problem) {
    desc.append(createEl("br"));
    desc.append(
      createSpan({
        cls: "mod-warning",
        text: m.settings_profile_rule_broken({
          problem: describeProblem(problem),
        }),
      }),
    );
  }
  return desc;
}
