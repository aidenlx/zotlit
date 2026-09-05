// One Profile Selection Rule editor: Library scope, flat item-type,
// Collection, and Tag conditions, and the target Profile.
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
  collectionLabel,
  compileCondition,
  describeProblem,
  flatConditions,
  formatCondition,
  itemTypeLabel,
  listCollectionChoices,
  MATCH_ALL_EXPRESSION,
} from "@/services/profile-selection";
import type {
  CollectionChoice,
  ConditionProblem,
  FlatCondition,
  ProfileSelectionRule,
} from "@/services/profile-selection";

import type { SettingTabContext } from "./context";

const mintId = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  12,
);

/** What a fresh condition tests: the type the ticketed example starts from. */
const DEFAULT_ITEM_TYPE = "book";

type ConditionKind = FlatCondition["kind"];

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

  /** The Collections the database offers, read once when the dialog opens. */
  readonly #collections: readonly CollectionChoice[];

  constructor(ctx: SettingTabContext, rule?: ProfileSelectionRule) {
    super(ctx.app);
    this.#ctx = ctx;
    this.#rule = rule;
    this.#draft = initialDraft(rule);
    this.#collections = availableCollections(ctx);
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
      .setDesc(conditionsDesc())
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
          .addOption("item-type", m.settings_profile_rule_condition_item_type())
          .addOption(
            "collection",
            m.settings_profile_rule_condition_collection(),
          )
          .addOption("tag", m.settings_profile_rule_condition_tag())
          .setValue(condition.kind)
          .onChange((value) => {
            this.#replaceCondition(
              index,
              this.#freshCondition(value as ConditionKind, condition.negated),
            );
          }),
      );
      setting.addDropdown((dropdown) =>
        dropdown
          .addOption("is", m.settings_profile_rule_operator_is())
          .addOption("is-not", m.settings_profile_rule_operator_is_not())
          .setValue(condition.negated ? "is-not" : "is")
          .onChange((value) =>
            this.#replaceCondition(index, {
              ...condition,
              negated: value === "is-not",
            }),
          ),
      );
      switch (condition.kind) {
        case "item-type":
          this.#renderItemTypeValue(setting, index, condition);
          break;
        case "collection":
          this.#renderCollectionValue(setting, index, condition);
          break;
        case "tag":
          this.#renderTagValue(setting, index, condition);
          break;
      }
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
              this.#freshCondition("item-type", false),
            ],
          }),
        ),
    );
  }

  #renderItemTypeValue(
    setting: Setting,
    index: number,
    condition: Extract<FlatCondition, { kind: "item-type" }>,
  ): void {
    setting.addDropdown((dropdown) => {
      for (const itemType of ITEM_TYPES)
        dropdown.addOption(itemType.name, itemTypeLabel(itemType.name));
      dropdown.setValue(condition.itemType).onChange((value) => {
        this.#replaceCondition(index, { ...condition, itemType: value });
      });
    });
  }

  /**
   * The Collection selector names every Collection by its Library and path.
   * A reference the database no longer holds stays selected, flagged, so
   * the user can see what the rule pointed at before choosing a replacement.
   */
  #renderCollectionValue(
    setting: Setting,
    index: number,
    condition: Extract<FlatCondition, { kind: "collection" }>,
  ): void {
    const choices = this.#collections;
    const current = collectionValue(condition);
    const known = choices.some((choice) => collectionValue(choice) === current);
    setting.setErrorMessage(
      known
        ? null
        : choices.length === 0
          ? m.settings_profile_rule_collection_none()
          : m.settings_profile_rule_collection_missing(),
    );
    setting.addDropdown((dropdown) => {
      for (const choice of choices)
        dropdown.addOption(
          collectionValue(choice),
          collectionLabel(choice, {
            libraries: this.#ctx.libraryScope.libraries,
            collections: choices,
          }),
        );
      if (!known)
        dropdown.addOption(
          current,
          collectionLabel(condition, {
            libraries: this.#ctx.libraryScope.libraries,
          }),
        );
      dropdown.setValue(current).onChange((value) => {
        const choice = choices.find(
          (candidate) => collectionValue(candidate) === value,
        );
        if (!choice) return;
        this.#replaceCondition(index, {
          ...condition,
          library: choice.library,
          key: choice.key,
        });
      });
    });
    setting.addDropdown((dropdown) =>
      dropdown
        .addOption(
          "descendants",
          m.settings_profile_rule_collection_descendants(),
        )
        .addOption("direct", m.settings_profile_rule_collection_direct())
        .setValue(condition.descendants ? "descendants" : "direct")
        .onChange((value) =>
          this.#replaceCondition(index, {
            ...condition,
            descendants: value === "descendants",
          }),
        ),
    );
  }

  #renderTagValue(
    setting: Setting,
    index: number,
    condition: Extract<FlatCondition, { kind: "tag" }>,
  ): void {
    setting.setErrorMessage(
      condition.name === "" ? m.settings_profile_rule_tag_empty() : null,
    );
    setting.addText((text) =>
      text
        .setPlaceholder(m.settings_profile_rule_tag_placeholder())
        .setValue(condition.name)
        .onChange((value) =>
          this.#replaceCondition(index, { ...condition, name: value }),
        ),
    );
  }

  /** A condition of `kind` at its starting value, keeping the operator. */
  #freshCondition(kind: ConditionKind, negated: boolean): FlatCondition {
    switch (kind) {
      case "item-type":
        return { kind, negated, itemType: DEFAULT_ITEM_TYPE };
      case "collection": {
        const first = this.#collections[0];
        return {
          kind,
          negated,
          library: first?.library ?? { type: "personal" },
          key: first?.key ?? "",
          descendants: true,
        };
      }
      case "tag":
        return { kind, negated, name: "" };
    }
  }

  #replaceCondition(index: number, next: FlatCondition): void {
    this.#update({
      conditions: this.#draft.conditions.map((condition, at) =>
        at === index ? next : condition,
      ),
    });
  }

  #renderButtons(body: HTMLElement): void {
    const draft = this.#draft;
    const invalid =
      (draft.scope.mode === "selected" && draft.scope.libraries.length === 0) ||
      draft.conditions.some((condition) => !this.#complete(condition));
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

  /** Whether a row names something the rule can be saved with. */
  #complete(condition: FlatCondition): boolean {
    switch (condition.kind) {
      case "item-type":
        return true;
      case "collection":
        return this.#collections.some(
          (choice) => collectionValue(choice) === collectionValue(condition),
        );
      case "tag":
        return condition.name !== "";
    }
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

/** Every Collection of every available Library; none while the database is unreadable. */
function availableCollections(ctx: SettingTabContext): CollectionChoice[] {
  if (ctx.db.state !== "ready") return [];
  return listCollectionChoices(ctx.db.client, ctx.libraryScope.libraries);
}

/** The dropdown value of a Collection: its portable reference. */
function collectionValue(reference: {
  library: LibrarySelector;
  key: string;
}): string {
  return `${selectorKey(reference.library)}/${reference.key}`;
}

function conditionsDesc(): DocumentFragment {
  const desc = createFragment();
  desc.append(m.settings_profile_rule_conditions_desc());
  desc.append(createEl("br"));
  desc.append(m.settings_profile_rule_collection_help());
  desc.append(createEl("br"));
  desc.append(m.settings_profile_rule_tag_help());
  return desc;
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
