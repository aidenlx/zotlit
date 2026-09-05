// One Profile Selection Rule editor: Library scope, flat item-type
// conditions, and the target Profile.
import { customAlphabet } from "nanoid";
import { Modal, Setting } from "obsidian";

import { ITEM_TYPES } from "@zotlit/zotero-types/item-types";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { libraryLabel, selectorLabel } from "@/services/library-scope/label";
import { compareSelectors, selectorKey } from "@/services/library-scope/scope";
import type {
  LibraryScope,
  LibrarySelector,
} from "@/services/library-scope/scope";
import {
  compileCondition,
  describeProblem,
  flatConditions,
  formatCondition,
  itemTypeLabel,
  MATCH_ALL_EXPRESSION,
} from "@/services/profile-selection";
import type {
  ConditionProblem,
  ProfileSelectionRule,
  RuleCondition,
} from "@/services/profile-selection";

import type { SettingTabContext } from "./context";

const mintId = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  12,
);

type FlatCondition = Extract<RuleCondition, { kind: "item-type" }>;

/** What a fresh condition tests: the type the ticketed example starts from. */
const DEFAULT_ITEM_TYPE = "book";

/** The editor's mutable draft, rebuilt into a row set on every change. */
interface RuleDraft {
  profile: ProfileSelector;
  scope: LibraryScope;
  /** `false` when the expression carries structure the flat editor cannot show. */
  flat: boolean;
  conditions: FlatCondition[];
  /** The stored expression, unchanged when `flat` is `false`. */
  rawExpression: string;
  rawProblem: ConditionProblem | null;
}

/**
 * Open the rule editor. Resolves the edited (or newly created) rule, or
 * `undefined` when the dialog is cancelled.
 */
export function editProfileSelectionRule(
  ctx: SettingTabContext,
  rule?: ProfileSelectionRule,
): Promise<ProfileSelectionRule | undefined> {
  const modal = new ProfileSelectionRuleModal(ctx, rule);
  modal.open();
  return modal.result;
}

export class ProfileSelectionRuleModal extends Modal {
  readonly #ctx: SettingTabContext;
  readonly #rule: ProfileSelectionRule | undefined;
  readonly #decision = Promise.withResolvers<
    ProfileSelectionRule | undefined
  >();
  readonly result = this.#decision.promise;
  #draft: RuleDraft;

  constructor(ctx: SettingTabContext, rule?: ProfileSelectionRule) {
    super(ctx.app);
    this.#ctx = ctx;
    this.#rule = rule;
    this.#draft = initialDraft(rule);
  }

  override onOpen(): void {
    this.contentEl.addClass("zt-root");
    this.setTitle(
      this.#rule
        ? m.settings_profile_rule_title_edit()
        : m.settings_profile_rule_title_new(),
    );
    this.#render();
  }

  override onClose(): void {
    this.#decision.resolve(undefined);
    this.contentEl.empty();
  }

  #update(patch: Partial<RuleDraft>): void {
    this.#draft = { ...this.#draft, ...patch };
    this.#render();
  }

  /**
   * Rebuild from state: a fresh row container replaces the previous one, so
   * a stale row from before this change is never mistaken for the current
   * one.
   */
  #render(): void {
    this.contentEl.empty();
    const body = this.contentEl.createDiv();
    this.#renderProfileRow(body);
    this.#renderScopeRow(body);
    this.#renderConditionsRows(body);
    this.#renderButtons(body);
  }

  #renderProfileRow(body: HTMLElement): void {
    const draft = this.#draft;
    const known = new Set<ProfileSelector>([
      "default",
      ...this.#ctx.profile.profiles.map((profile) => profile.id),
    ]);
    const unavailable = !known.has(draft.profile);
    const setting = new Setting(body)
      .setName(m.settings_profile_rule_target())
      .setDesc(m.settings_profile_rule_target_desc());
    setting.setErrorMessage(
      unavailable ? m.settings_profile_rule_target_unavailable() : null,
    );
    setting.addDropdown((dropdown) => {
      dropdown.addOption("default", m.settings_profile_default_name());
      for (const profile of this.#ctx.profile.profiles)
        dropdown.addOption(profile.id, profile.label);
      if (unavailable) dropdown.addOption(draft.profile, draft.profile);
      dropdown
        .setValue(draft.profile)
        .onChange((value) =>
          this.#update({ profile: value as ProfileSelector }),
        );
    });
  }

  #renderScopeRow(body: HTMLElement): void {
    const draft = this.#draft;
    const invalid =
      draft.scope.mode === "selected" && draft.scope.libraries.length === 0;
    const setting = new Setting(body)
      .setName(m.settings_profile_rule_scope())
      .setDesc(m.settings_profile_rule_scope_desc());
    setting.setErrorMessage(
      invalid ? m.settings_profile_rule_scope_empty() : null,
    );
    setting.addDropdown((dropdown) => {
      dropdown
        .addOption("all", m.settings_library_scope_all())
        .addOption("selected", m.settings_library_scope_selected())
        .setValue(draft.scope.mode)
        .onChange((value) => {
          this.#update({
            scope:
              value === "all"
                ? { mode: "all" }
                : { mode: "selected", libraries: startingLibraries(this.#ctx) },
          });
        });
    });
    if (draft.scope.mode !== "selected") return;
    const scope = draft.scope;
    for (const row of libraryRows(this.#ctx, scope)) {
      new Setting(body)
        .setName(row.label)
        .setDesc(row.unavailable ? m.settings_library_scope_unavailable() : "")
        .addToggle((toggle) =>
          toggle.setValue(true).onChange((checked) => {
            if (checked) return;
            this.#update({
              scope: {
                mode: "selected",
                libraries: scope.libraries.filter(
                  (selector) =>
                    selectorKey(selector) !== selectorKey(row.selector),
                ),
              },
            });
          }),
        );
    }
    for (const library of addableLibraries(this.#ctx, scope)) {
      new Setting(body).setName(libraryLabel(library)).addToggle((toggle) =>
        toggle.setValue(false).onChange((checked) => {
          if (!checked) return;
          this.#update({
            scope: {
              mode: "selected",
              libraries: [...scope.libraries, library.selector].sort(
                compareSelectors,
              ),
            },
          });
        }),
      );
    }
  }

  #renderConditionsRows(body: HTMLElement): void {
    const draft = this.#draft;
    new Setting(body)
      .setName(m.settings_profile_rule_conditions())
      .setDesc(m.settings_profile_rule_conditions_desc())
      .setHeading();
    if (!draft.flat) {
      new Setting(body)
        .setName(m.settings_profile_rule_expression())
        .setDesc(expressionDesc(draft.rawProblem))
        .addTextArea((text) => text.setValue(draft.rawExpression));
      return;
    }
    draft.conditions.forEach((condition, index) => {
      const setting = new Setting(body);
      setting.addDropdown((dropdown) =>
        dropdown
          .addOption("itemType", m.settings_profile_rule_condition_item_type())
          .setValue("itemType"),
      );
      setting.addDropdown((dropdown) =>
        dropdown
          .addOption("is", m.settings_profile_rule_operator_is())
          .addOption("is-not", m.settings_profile_rule_operator_is_not())
          .setValue(condition.negated ? "is-not" : "is")
          .onChange((value) =>
            this.#updateCondition(index, { negated: value === "is-not" }),
          ),
      );
      setting.addDropdown((dropdown) => {
        for (const itemType of ITEM_TYPES)
          dropdown.addOption(itemType.name, itemTypeLabel(itemType.name));
        dropdown.setValue(condition.itemType).onChange((value) => {
          this.#updateCondition(index, { itemType: value });
        });
      });
      setting.addExtraButton((button) =>
        button
          .setIcon("x")
          .setTooltip(m.settings_profile_rule_remove_condition())
          .onClick(() =>
            this.#update({
              conditions: draft.conditions.filter((_, at) => at !== index),
            }),
          ),
      );
    });
    new Setting(body).addButton((button) =>
      button
        .setButtonText(m.settings_profile_rule_add_condition())
        .onClick(() =>
          this.#update({
            conditions: [
              ...draft.conditions,
              {
                kind: "item-type",
                negated: false,
                itemType: DEFAULT_ITEM_TYPE,
              },
            ],
          }),
        ),
    );
  }

  #updateCondition(index: number, patch: Partial<FlatCondition>): void {
    this.#update({
      conditions: this.#draft.conditions.map((condition, at) =>
        at === index ? { ...condition, ...patch } : condition,
      ),
    });
  }

  #renderButtons(body: HTMLElement): void {
    const draft = this.#draft;
    const invalid =
      draft.scope.mode === "selected" && draft.scope.libraries.length === 0;
    new Setting(body)
      .addButton((button) =>
        button
          .setButtonText(m.settings_profile_rule_save())
          .setCta()
          .setDisabled(invalid)
          .onClick(() => {
            if (invalid) return;
            this.#decision.resolve(this.#toRule());
            this.close();
          }),
      )
      .addButton((button) =>
        button.setButtonText(m.modal_cancel()).onClick(() => {
          this.#decision.resolve(undefined);
          this.close();
        }),
      );
  }

  #toRule(): ProfileSelectionRule {
    const draft = this.#draft;
    return {
      id: this.#rule?.id ?? mintId(),
      scope: draft.scope,
      expression: draft.flat
        ? formatCondition({
            kind: "group",
            match: "all",
            conditions: draft.conditions,
          })
        : this.#rule!.expression,
      profile: draft.profile,
    };
  }
}

function initialDraft(rule?: ProfileSelectionRule): RuleDraft {
  if (!rule) {
    return {
      profile: "default",
      scope: { mode: "all" },
      flat: true,
      conditions: [
        { kind: "item-type", negated: false, itemType: DEFAULT_ITEM_TYPE },
      ],
      rawExpression: MATCH_ALL_EXPRESSION,
      rawProblem: null,
    };
  }
  const { condition, problem } = compileCondition(rule.expression);
  const flatSet = condition && flatConditions(condition);
  if (problem || !flatSet) {
    return {
      profile: rule.profile,
      scope: rule.scope,
      flat: false,
      conditions: [],
      rawExpression: rule.expression,
      rawProblem: problem,
    };
  }
  return {
    profile: rule.profile,
    scope: rule.scope,
    flat: true,
    conditions: flatSet,
    rawExpression: rule.expression,
    rawProblem: null,
  };
}

/** Where switching Libraries to Selected starts: My Library, when available. */
function startingLibraries(ctx: SettingTabContext): LibrarySelector[] {
  const hasPersonal = ctx.libraryScope.libraries.some(
    (library) => library.selector.type === "personal",
  );
  return hasPersonal ? [{ type: "personal" }] : [];
}

interface LibraryRow {
  selector: LibrarySelector;
  label: string;
  unavailable: boolean;
}

/** The checked rows: every selected selector, available or not. */
function libraryRows(
  ctx: SettingTabContext,
  scope: Extract<LibraryScope, { mode: "selected" }>,
): LibraryRow[] {
  const byKey = new Map(
    ctx.libraryScope.libraries.map((library) => [
      selectorKey(library.selector),
      library,
    ]),
  );
  return scope.libraries.map((selector) => {
    const library = byKey.get(selectorKey(selector));
    return {
      selector,
      label: library ? libraryLabel(library) : selectorLabel(selector),
      unavailable: library === undefined,
    };
  });
}

/** The unchecked rows: every available Library this rule does not select. */
function addableLibraries(
  ctx: SettingTabContext,
  scope: Extract<LibraryScope, { mode: "selected" }>,
) {
  const selected = new Set(scope.libraries.map(selectorKey));
  return ctx.libraryScope.libraries.filter(
    (library) => !selected.has(selectorKey(library.selector)),
  );
}

function expressionDesc(problem: ConditionProblem | null): DocumentFragment {
  const desc = createFragment();
  desc.append(m.settings_profile_rule_expression_desc());
  if (problem) {
    desc.append(createEl("br"));
    desc.append(
      createSpan({ cls: "mod-warning", text: describeProblem(problem) }),
    );
  }
  return desc;
}
