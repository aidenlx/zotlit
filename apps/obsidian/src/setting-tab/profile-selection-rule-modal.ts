// One Profile Selection Rule editor: Library scope, grouped item-type,
// Collection, and Tag conditions, and the target Profile. The stored Filter
// Expression is the one source; the visual editor and the expression editor
// are two surfaces over it.
import { customAlphabet } from "nanoid";
import { Modal, Setting } from "obsidian";
import type { ButtonComponent } from "obsidian";

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
  formatCondition,
  itemTypeLabel,
  listCollectionChoices,
} from "@/services/profile-selection";
import type {
  CollectionChoice,
  DescribeOptions,
  FlatCondition,
  ProfileSelectionRule,
  RuleCondition,
} from "@/services/profile-selection";

import type { SettingTabContext } from "./context";

const mintId = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  12,
);

/** What a fresh condition tests: the type the ticketed example starts from. */
const DEFAULT_ITEM_TYPE = "book";

type ConditionKind = FlatCondition["kind"];
type ConditionGroup = Extract<RuleCondition, { kind: "group" }>;
type GroupMatch = ConditionGroup["match"];

/** The row indent of each nesting depth; deeper groups share the last. */
const NESTED_ROW_CLASSES = ["zt:ml-6", "zt:ml-12", "zt:ml-18", "zt:ml-24"];

/**
 * The editor's mutable draft. `expression` is what the rule stores; the
 * visual surface edits `root` and writes the canonical expression back on
 * every change, so an expression the user has not touched stays as written.
 */
interface RuleDraft {
  profile: ProfileSelector;
  scope: LibraryScope;
  expression: string;
  /** The tree the visual surface shows; `null` on the expression surface. */
  root: ConditionGroup | null;
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
  /** The Save button of the current render, refreshed on keystrokes. */
  #saveButton: ButtonComponent | null = null;

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
   * Change the draft under a text control without rebuilding the rows, so
   * the control keeps focus while the user types; only the Save button and
   * the row's own message follow the keystroke.
   */
  #patch(patch: Partial<RuleDraft>): void {
    this.#draft = { ...this.#draft, ...patch };
    this.#saveButton?.setDisabled(this.#invalid());
  }

  /** Replace the condition tree and write its canonical expression. */
  #updateRoot(root: ConditionGroup, options: { render: boolean }): void {
    const patch = { root, expression: formatCondition(root) };
    if (options.render) this.#update(patch);
    else this.#patch(patch);
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
    const { root } = this.#draft;
    new Setting(body)
      .setName(m.settings_profile_rule_conditions())
      .setDesc(conditionsDesc())
      .setHeading();
    if (root === null) {
      this.#renderExpressionEditor(body);
      return;
    }
    this.#renderGroup(body, root, []);
    new Setting(body)
      .setName(m.settings_profile_rule_expression())
      .setDesc(m.settings_profile_rule_expression_desc())
      .addButton((button) =>
        button
          .setButtonText(m.settings_profile_rule_edit_as_expression())
          // The expression is already current: every visual edit wrote it.
          .onClick(() => this.#update({ root: null })),
      );
  }

  /**
   * The expression surface: the stored expression as text, validated on
   * every keystroke. The rule cannot be saved, or shown visually, until the
   * expression is inside the supported contract, and it stays as written
   * until the user changes it.
   */
  #renderExpressionEditor(body: HTMLElement): void {
    const setting = new Setting(body)
      .setName(m.settings_profile_rule_expression())
      .setDesc(m.settings_profile_rule_expression_help());
    let visualButton: ButtonComponent | null = null;
    const refresh = (): void => {
      const issue = this.#expressionIssue();
      setting.setErrorMessage(issue);
      visualButton?.setDisabled(issue !== null);
    };
    setting.addTextArea((text) =>
      text.setValue(this.#draft.expression).onChange((value) => {
        this.#patch({ expression: value });
        refresh();
      }),
    );
    setting.addButton((button) => {
      visualButton = button
        .setButtonText(m.settings_profile_rule_edit_visually())
        .onClick(() => {
          if (this.#expressionIssue() !== null) return;
          const { condition } = compileCondition(this.#draft.expression);
          this.#update({ root: asGroup(condition!) });
        });
    });
    refresh();
  }

  /** Rows of the group at `path`, indented by their depth (the path length). */
  #renderGroup(body: HTMLElement, group: ConditionGroup, path: number[]): void {
    const nested = path.length > 0;
    const header = new Setting(body).setName(
      nested
        ? m.settings_profile_rule_group()
        : m.settings_profile_rule_match(),
    );
    indent(header, path.length);
    header.setErrorMessage(
      vacuous(group, !nested) ? m.settings_profile_rule_group_empty() : null,
    );
    header.addDropdown((dropdown) =>
      dropdown
        .addOption("all", m.settings_profile_rule_match_all())
        .addOption("any", m.settings_profile_rule_match_any())
        .setValue(group.match)
        .onChange((value) =>
          this.#updateRoot(
            updateGroup(this.#draft.root!, path, (target) => ({
              ...target,
              match: value as GroupMatch,
            })),
            { render: true },
          ),
        ),
    );
    if (nested)
      header.addExtraButton((button) =>
        button
          .setIcon("x")
          .setTooltip(m.settings_profile_rule_remove_group())
          .onClick(() => this.#removeAt(path)),
      );
    group.conditions.forEach((condition, index) => {
      const childPath = [...path, index];
      if (condition.kind === "group")
        this.#renderGroup(body, condition, childPath);
      else this.#renderConditionRow(body, condition, childPath);
    });
    const footer = new Setting(body);
    indent(footer, path.length + 1);
    footer
      .addButton((button) =>
        button
          .setButtonText(m.settings_profile_rule_add_condition())
          .onClick(() =>
            this.#appendAt(path, this.#freshCondition("item-type", false)),
          ),
      )
      .addButton((button) =>
        button
          .setButtonText(m.settings_profile_rule_add_group())
          // A new group takes the other match and one condition, so it
          // starts as the alternative or exception the user reached for.
          .onClick(() =>
            this.#appendAt(path, {
              kind: "group",
              match: group.match === "all" ? "any" : "all",
              conditions: [this.#freshCondition("item-type", false)],
            }),
          ),
      );
  }

  #renderConditionRow(
    body: HTMLElement,
    condition: FlatCondition,
    path: number[],
  ): void {
    const setting = new Setting(body);
    indent(setting, path.length);
    setting.addDropdown((dropdown) =>
      dropdown
        .addOption("item-type", m.settings_profile_rule_condition_item_type())
        .addOption("collection", m.settings_profile_rule_condition_collection())
        .addOption("tag", m.settings_profile_rule_condition_tag())
        .setValue(condition.kind)
        .onChange((value) => {
          this.#replaceAt(
            path,
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
          this.#replaceAt(path, { ...condition, negated: value === "is-not" }),
        ),
    );
    switch (condition.kind) {
      case "item-type":
        this.#renderItemTypeValue(setting, path, condition);
        break;
      case "collection":
        this.#renderCollectionValue(setting, path, condition);
        break;
      case "tag":
        this.#renderTagValue(setting, path, condition);
        break;
    }
    setting.addExtraButton((button) =>
      button
        .setIcon("x")
        .setTooltip(m.settings_profile_rule_remove_condition())
        .onClick(() => this.#removeAt(path)),
    );
  }

  #renderItemTypeValue(
    setting: Setting,
    path: number[],
    condition: Extract<FlatCondition, { kind: "item-type" }>,
  ): void {
    setting.addDropdown((dropdown) => {
      for (const itemType of ITEM_TYPES)
        dropdown.addOption(itemType.name, itemTypeLabel(itemType.name));
      dropdown.setValue(condition.itemType).onChange((value) => {
        this.#replaceAt(path, { ...condition, itemType: value });
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
    path: number[],
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
          collectionLabel(choice, this.#describeOptions()),
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
        this.#replaceAt(path, {
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
          this.#replaceAt(path, {
            ...condition,
            descendants: value === "descendants",
          }),
        ),
    );
  }

  #renderTagValue(
    setting: Setting,
    path: number[],
    condition: Extract<FlatCondition, { kind: "tag" }>,
  ): void {
    const refresh = (name: string): void => {
      setting.setErrorMessage(
        name === "" ? m.settings_profile_rule_tag_empty() : null,
      );
    };
    refresh(condition.name);
    setting.addText((text) =>
      text
        .setPlaceholder(m.settings_profile_rule_tag_placeholder())
        .setValue(condition.name)
        .onChange((value) => {
          this.#updateRoot(
            replaceAt(this.#draft.root!, path, { ...condition, name: value }),
            { render: false },
          );
          refresh(value);
        }),
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

  #replaceAt(path: number[], next: RuleCondition): void {
    this.#updateRoot(replaceAt(this.#draft.root!, path, next), {
      render: true,
    });
  }

  #removeAt(path: number[]): void {
    const index = path.at(-1)!;
    this.#updateRoot(
      updateGroup(this.#draft.root!, path.slice(0, -1), (group) => ({
        ...group,
        conditions: group.conditions.filter((_, at) => at !== index),
      })),
      { render: true },
    );
  }

  #appendAt(path: number[], child: RuleCondition): void {
    this.#updateRoot(
      updateGroup(this.#draft.root!, path, (group) => ({
        ...group,
        conditions: [...group.conditions, child],
      })),
      { render: true },
    );
  }

  #renderButtons(body: HTMLElement): void {
    new Setting(body)
      .addButton((button) => {
        this.#saveButton = button
          .setButtonText(m.settings_profile_rule_save())
          .setCta()
          .setDisabled(this.#invalid())
          .onClick(() => {
            if (this.#invalid()) return;
            this.#decision.resolve(this.#toRule());
            this.close();
          });
      })
      .addButton((button) =>
        button.setButtonText(m.modal_cancel()).onClick(() => {
          this.#decision.resolve(undefined);
          this.close();
        }),
      );
  }

  /** Whether anything keeps the rule from being saved. */
  #invalid(): boolean {
    const { scope } = this.#draft;
    return (
      (scope.mode === "selected" && scope.libraries.length === 0) ||
      this.#expressionIssue() !== null
    );
  }

  /**
   * What keeps the current expression from being a rule: a contract problem
   * in the text, or a condition the tree cannot be saved with. `null` when
   * the expression is complete. Both surfaces answer through the same tree
   * checks, so the expression editor refuses what the visual editor flags.
   */
  #expressionIssue(): string | null {
    const { root, expression } = this.#draft;
    if (root) return this.#treeIssue(root, true);
    const { condition, problem } = compileCondition(expression);
    if (problem) return describeProblem(problem, this.#describeOptions());
    return this.#treeIssue(asGroup(condition), true);
  }

  /** The first incomplete condition or vacuous group, as the user reads it. */
  #treeIssue(group: ConditionGroup, isRoot: boolean): string | null {
    if (vacuous(group, isRoot)) return m.settings_profile_rule_group_empty();
    for (const condition of group.conditions) {
      const issue =
        condition.kind === "group"
          ? this.#treeIssue(condition, false)
          : this.#conditionIssue(condition);
      if (issue) return issue;
    }
    return null;
  }

  #conditionIssue(condition: FlatCondition): string | null {
    switch (condition.kind) {
      case "item-type":
        return null;
      case "collection":
        return this.#collections.some(
          (choice) => collectionValue(choice) === collectionValue(condition),
        )
          ? null
          : describeProblem(
              { code: "missing-collection", ...condition },
              this.#describeOptions(),
            );
      case "tag":
        return condition.name === ""
          ? m.settings_profile_rule_tag_empty()
          : null;
    }
  }

  #describeOptions(): DescribeOptions {
    return {
      libraries: this.#ctx.libraryScope.libraries,
      collections: this.#collections,
    };
  }

  #toRule(): ProfileSelectionRule {
    const draft = this.#draft;
    return {
      id: this.#rule?.id ?? mintId(),
      scope: draft.scope,
      expression: draft.expression,
      profile: draft.profile,
    };
  }
}

/**
 * A new rule opens on the visual surface with one item-type condition. An
 * existing rule opens there when its expression is inside the contract, and
 * on the expression surface — text intact, problem shown — otherwise.
 */
function initialDraft(rule?: ProfileSelectionRule): RuleDraft {
  if (!rule) {
    const root: ConditionGroup = {
      kind: "group",
      match: "all",
      conditions: [
        { kind: "item-type", negated: false, itemType: DEFAULT_ITEM_TYPE },
      ],
    };
    return {
      profile: "default",
      scope: { mode: "all" },
      expression: formatCondition(root),
      root,
    };
  }
  const { condition } = compileCondition(rule.expression);
  return {
    profile: rule.profile,
    scope: rule.scope,
    expression: rule.expression,
    root: condition && asGroup(condition),
  };
}

/** The tree the visual surface edits: a lone condition sits in a "Match all" group. */
function asGroup(condition: RuleCondition): ConditionGroup {
  return condition.kind === "group"
    ? condition
    : { kind: "group", match: "all", conditions: [condition] };
}

/**
 * Whether a group holds nothing to judge. An empty root "Match all" group
 * is the deliberate catch-all; an empty "Match any" group or an empty nested
 * group has no expression form and is refused.
 */
function vacuous(group: ConditionGroup, isRoot: boolean): boolean {
  return group.conditions.length === 0 && (!isRoot || group.match === "any");
}

/** `root` with the group at `path` (a list of child indexes) replaced by `fn`'s result. */
function updateGroup(
  root: ConditionGroup,
  path: readonly number[],
  fn: (group: ConditionGroup) => ConditionGroup,
): ConditionGroup {
  if (path.length === 0) return fn(root);
  const [index, ...rest] = path;
  return {
    ...root,
    conditions: root.conditions.map((child, at) =>
      at === index && child.kind === "group"
        ? updateGroup(child, rest, fn)
        : child,
    ),
  };
}

/** `root` with the condition at `path` replaced by `next`. */
function replaceAt(
  root: ConditionGroup,
  path: readonly number[],
  next: RuleCondition,
): ConditionGroup {
  const index = path.at(-1)!;
  return updateGroup(root, path.slice(0, -1), (group) => ({
    ...group,
    conditions: group.conditions.map((child, at) =>
      at === index ? next : child,
    ),
  }));
}

/** Push a row in under its group; the root's own rows sit flush. */
function indent(setting: Setting, depth: number): void {
  if (depth === 0) return;
  setting.settingEl.addClass(
    NESTED_ROW_CLASSES[Math.min(depth, NESTED_ROW_CLASSES.length) - 1]!,
  );
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
  desc.append(m.settings_profile_rule_group_help());
  desc.append(createEl("br"));
  desc.append(m.settings_profile_rule_collection_help());
  desc.append(createEl("br"));
  desc.append(m.settings_profile_rule_tag_help());
  return desc;
}
