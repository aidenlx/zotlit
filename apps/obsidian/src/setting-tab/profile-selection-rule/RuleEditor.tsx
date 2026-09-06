// The rule editor's body: the target Profile and its conditions — a filter builder in the shape of Obsidian's Bases filter
// editor, where a row is a labelled test or a Filter Expression as code. The
// Save and Cancel buttons render into the modal's own button container,
// outside the scrolling body.
import { useId } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { ITEM_TYPES } from "@zotlit/zotero-types/item-types";

import { Button } from "@/components/obsidian/button";
import { Dropdown, DropdownItem } from "@/components/obsidian/dropdown";
import { Icon } from "@/components/obsidian/icon";
import { IconButton } from "@/components/obsidian/icon-button";
import * as m from "@/lib/i18n/generated/messages";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { cn, tooltipAttrs } from "@/lib/utils";
import { libraryLabel } from "@/services/library-scope/label";
import { selectorKey } from "@/services/library-scope/scope";
import { itemTypeLabel } from "@/services/profile-selection";

import { ChipInput } from "./ChipInput";
import {
  appendAt,
  asExpression,
  asLabelled,
  conditionIssue,
  draftInvalid,
  freshCondition,
  freshGroup,
  removeAt,
  replaceAt,
  updateGroup,
  vacuous,
} from "./draft";
import type {
  ConditionGroup,
  ConditionKind,
  ConditionPath,
  GroupMatch,
  RowCondition,
} from "./draft";
import { ExpressionEditor } from "./ExpressionEditor";
import { useRuleEditorStore } from "./store";

/** Native controls flatten into the statement frame's shared surface. */
const flatControls = cn(
  "zt:[--input-border-width-focus:0px] zt:[--input-border-width:0px]",
  "zt:[--input-radius:0px] zt:[--input-shadow:none]",
  "zt:[--dropdown-background:var(--background-modifier-form-field)]",
  "zt:[--dropdown-background-hover:var(--background-modifier-form-field-hover)]",
);

/** One statement frame: the shared surface, boundary, radius, and focus ring. */
const statementBox = cn(
  "zt:min-w-0 zt:items-start zt:overflow-hidden zt:rounded-md zt:bg-input",
  "zt:ring-1 zt:ring-border-hover",
  "zt:focus-within:ring-2 zt:focus-within:ring-border-focus",
  "zt:[--icon-size:var(--icon-s)] zt:[--icon-stroke:var(--icon-s-stroke-width)]",
  flatControls,
);

/** Flat controls wrap as units and use real hairline separators. */
const statementControls =
  "zt:flex zt:min-w-0 zt:flex-1 zt:flex-wrap zt:items-start zt:*:border-s zt:*:border-border zt:*:first:border-s-0";

/** A statement's own buttons, at the trailing end of its box. */
const statementActions =
  "zt:flex zt:h-(--input-height) zt:shrink-0 zt:items-center zt:border-s zt:border-border zt:px-0.5";

/** The buttons that grow a group, quiet enough to sit under its statements. */
const quietButton = cn(
  "zt:gap-1.5 zt:*:text-muted-foreground",
  "zt:[--input-shadow:none] zt:[--interactive-normal:transparent]",
  "zt:[--interactive-hover:var(--background-modifier-hover)]",
  "zt:[--icon-size:var(--icon-s)] zt:[--icon-stroke:var(--icon-s-stroke-width)]",
);

/** A group's match dropdown, flat against the group it heads. */
const quietDropdown = cn(
  "zt:text-sm zt:[--input-shadow:none]",
  "zt:[--dropdown-background:transparent]",
  "zt:[--dropdown-background-hover:var(--background-modifier-hover)]",
);

export interface RuleEditorProps {
  /** The modal's button container; Save and Cancel render there. */
  footer: HTMLElement;
  onSave: () => void;
  onCancel: () => void;
}

export function RuleEditor({ footer, onSave, onCancel }: RuleEditorProps) {
  return (
    <div className="zt:flex zt:flex-col zt:gap-4">
      <ProfileField />
      <ConditionsSection />
      {createPortal(<Footer onSave={onSave} onCancel={onCancel} />, footer)}
    </div>
  );
}

function Footer({ onSave, onCancel }: Omit<RuleEditorProps, "footer">) {
  const draft = useRuleEditorStore((state) => state.draft);
  const deps = useRuleEditorStore((state) => state.deps);
  const invalid = draftInvalid(draft, deps);
  return (
    <>
      <Button variant="cta" disabled={invalid} onClick={onSave}>
        {m.settings_profile_rule_save()}
      </Button>
      <Button onClick={onCancel}>{m.modal_cancel()}</Button>
    </>
  );
}

/** A labelled row: name and description beside its control, as a setting reads. */
function Field({
  name,
  desc,
  error,
  control,
}: {
  name: string;
  desc: string;
  error: string | null;
  control: (labelId: string) => ReactNode;
}) {
  const labelId = useId();
  return (
    <div className="zt:flex zt:flex-col zt:gap-2">
      <div className="zt:flex zt:items-center zt:justify-between zt:gap-4">
        <div className="zt:min-w-0">
          <div
            id={labelId}
            className="zt:text-sm zt:leading-(--line-height-tight)"
          >
            {name}
          </div>
          <p className="zt:pt-1 zt:text-xs zt:leading-(--line-height-tight) zt:text-pretty zt:text-muted-foreground">
            {desc}
          </p>
          <ErrorText>{error}</ErrorText>
        </div>
        <div className="zt:shrink-0">{control(labelId)}</div>
      </div>
    </div>
  );
}

/** A validation message; renders nothing while there is none. */
function ErrorText({ children }: { children: string | null }) {
  if (children === null) return null;
  return (
    <p
      role="alert"
      className="zt:pt-1 zt:text-xs zt:leading-(--line-height-tight) zt:text-pretty zt:text-(--text-error)"
    >
      {children}
    </p>
  );
}

function ProfileField() {
  const profile = useRuleEditorStore((state) => state.draft.profile);
  const profiles = useRuleEditorStore((state) => state.deps.profiles);
  const setProfile = useRuleEditorStore((state) => state.setProfile);
  const unavailable = !profiles.some(({ id }) => id === profile);
  return (
    <Field
      name={m.settings_profile_rule_target()}
      desc={m.settings_profile_rule_target_desc()}
      error={unavailable ? m.settings_profile_rule_target_unavailable() : null}
      control={(labelId) => (
        <Dropdown
          aria-labelledby={labelId}
          value={profile}
          onChange={(value) => setProfile(value as ProfileSelector)}
        >
          {profiles.map(({ id, label }) => (
            <DropdownItem key={id} value={id}>
              {label}
            </DropdownItem>
          ))}
          {unavailable && (
            <DropdownItem value={profile}>{profile}</DropdownItem>
          )}
        </Dropdown>
      )}
    />
  );
}

function ConditionsSection() {
  const root = useRuleEditorStore((state) => state.draft.root);
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="zt:flex zt:flex-col zt:gap-2"
    >
      <div>
        <div
          id={headingId}
          role="heading"
          aria-level={3}
          className="zt:text-base zt:leading-(--line-height-tight) zt:font-semibold"
        >
          {m.settings_profile_rule_conditions()}
        </div>
        <p className="zt:pt-1 zt:text-sm zt:leading-(--line-height-tight) zt:text-pretty zt:text-muted-foreground">
          {m.settings_profile_rule_conditions_desc()}
        </p>
      </div>
      <GroupEditor group={root} path={[]} />
    </section>
  );
}

/**
 * One group of conditions: its match in the header, its rows, and the
 * buttons that grow it. The root sits flush; a nested group is a card.
 */
function GroupEditor({
  group,
  path,
}: {
  group: ConditionGroup;
  path: ConditionPath;
}) {
  const setRoot = useRuleEditorStore((state) => state.setRoot);
  const root = useRuleEditorStore((state) => state.draft.root);
  const nested = path.length > 0;
  const setMatch = (match: GroupMatch) =>
    setRoot(updateGroup(root, path, (target) => ({ ...target, match })));
  return (
    <div
      className={cn(
        "zt:flex zt:flex-col zt:gap-1.5",
        nested &&
          "zt:rounded-md zt:border zt:border-border zt:bg-card zt:p-1.5",
      )}
    >
      <div className="zt:flex zt:items-center zt:justify-between zt:gap-2 zt:pb-0.5">
        <div className="zt:flex zt:min-w-0 zt:items-center zt:gap-2">
          {/* The card and its own match name the group; a "Group" label beside
              them repeats what both already say, so it stays for screen
              readers alone. */}
          <Dropdown
            className={quietDropdown}
            aria-label={
              nested
                ? m.settings_profile_rule_group()
                : m.settings_profile_rule_match()
            }
            value={group.match}
            onChange={(value) => setMatch(value as GroupMatch)}
          >
            <DropdownItem value="all">
              {m.settings_profile_rule_match_all()}
            </DropdownItem>
            <DropdownItem value="any">
              {m.settings_profile_rule_match_any()}
            </DropdownItem>
          </Dropdown>
        </div>
        {nested && (
          <IconButton
            icon="x"
            {...tooltipAttrs(m.settings_profile_rule_remove_group())}
            onClick={() => setRoot(removeAt(root, path))}
          />
        )}
      </div>
      <ErrorText>
        {vacuous(group, !nested) ? m.settings_profile_rule_group_empty() : null}
      </ErrorText>
      {group.conditions.length > 0 && (
        <ul className="zt:flex zt:flex-col zt:gap-1.5">
          {group.conditions.map((condition, index) => (
            <li key={index} className="zt:flex zt:items-center zt:gap-2">
              <span
                aria-hidden={index === 0 || undefined}
                className="zt:w-9 zt:shrink-0 zt:text-end zt:text-sm zt:text-muted-foreground"
              >
                {index === 0
                  ? ""
                  : group.match === "all"
                    ? m.settings_profile_rule_conjunction_and()
                    : m.settings_profile_rule_conjunction_or()}
              </span>
              <div className="zt:min-w-0 zt:flex-1">
                {condition.kind === "group" ? (
                  <GroupEditor group={condition} path={[...path, index]} />
                ) : (
                  <ConditionRow condition={condition} path={[...path, index]} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="zt:flex zt:gap-1.5 zt:pt-1">
        <button
          type="button"
          className={quietButton}
          onClick={() =>
            setRoot(appendAt(root, path, freshCondition("item-type", false)))
          }
        >
          <Icon name="plus" />
          <span>{m.settings_profile_rule_add_condition()}</span>
        </button>
        <button
          type="button"
          className={quietButton}
          onClick={() => setRoot(appendAt(root, path, freshGroup(group.match)))}
        >
          <Icon name="plus" />
          <span>{m.settings_profile_rule_add_group()}</span>
        </button>
      </div>
    </div>
  );
}

/**
 * One condition: what it tests, whether it is negated, and its value — or,
 * toggled to an expression row, the Filter Expression as code, checked on
 * every keystroke. The toggle back is refused while the text reads as more
 * than one labelled test.
 */
function ConditionRow({
  condition,
  path,
}: {
  condition: RowCondition;
  path: ConditionPath;
}) {
  const setRoot = useRuleEditorStore((state) => state.setRoot);
  const root = useRuleEditorStore((state) => state.draft.root);
  const deps = useRuleEditorStore((state) => state.deps);
  const replace = (next: RowCondition) => setRoot(replaceAt(root, path, next));
  const issue = conditionIssue(condition, deps);
  const labelled =
    condition.kind === "expression" ? asLabelled(condition) : null;
  const hasResponsiveValue =
    (condition.kind === "tags" || condition.kind === "collections") &&
    (condition.operator === "containsAny" ||
      condition.operator === "containsAll");
  return (
    <div className="zt:flex zt:flex-col" data-condition-row="">
      <div
        className={cn(
          statementBox,
          hasResponsiveValue
            ? "zt:@container zt:grid zt:grid-cols-[auto_auto_1fr_auto]"
            : "zt:flex",
          issue !== null && "zt:ring-1 zt:ring-(--background-modifier-error)",
        )}
      >
        <div
          className={cn(statementControls, hasResponsiveValue && "zt:contents")}
        >
          {condition.kind === "expression" ? (
            <ExpressionEditor
              className="zt:min-w-48 zt:flex-1"
              label={m.settings_profile_rule_expression()}
              value={condition.text}
              onChange={(text) => replace({ ...condition, text })}
              invalid={issue !== null}
              placeholder={m.settings_profile_rule_expression_placeholder()}
            />
          ) : (
            <>
              <Dropdown
                aria-label={m.settings_profile_rule_condition_kind()}
                value={condition.kind}
                onChange={(value) =>
                  replace(freshCondition(value as ConditionKind, false))
                }
              >
                <DropdownItem value="library">
                  {m.settings_profile_rule_condition_library()}
                </DropdownItem>
                <DropdownItem value="item-type">
                  {m.settings_profile_rule_condition_item_type()}
                </DropdownItem>
                <DropdownItem value="collections">
                  {m.settings_profile_rule_condition_collection()}
                </DropdownItem>
                <DropdownItem value="tags">
                  {m.settings_profile_rule_condition_tag()}
                </DropdownItem>
              </Dropdown>
              <ConditionOperator condition={condition} onChange={replace} />
              <ConditionValue condition={condition} onChange={replace} />
            </>
          )}
        </div>
        <div
          className={cn(
            statementActions,
            hasResponsiveValue && "zt:col-start-4 zt:row-start-1",
          )}
        >
          {condition.kind === "expression" ? (
            <IconButton
              icon="list-filter"
              disabled={labelled === null}
              {...tooltipAttrs(m.settings_profile_rule_edit_visually())}
              onClick={() => {
                if (labelled) replace(labelled);
              }}
            />
          ) : (
            <IconButton
              icon="code"
              {...tooltipAttrs(m.settings_profile_rule_edit_as_expression())}
              onClick={() => replace(asExpression(condition))}
            />
          )}
          <IconButton
            icon="x"
            {...tooltipAttrs(m.settings_profile_rule_remove_condition())}
            onClick={() => setRoot(removeAt(root, path))}
          />
        </div>
      </div>
      <ErrorText>{issue}</ErrorText>
    </div>
  );
}

function ConditionOperator({
  condition,
  onChange,
}: {
  condition: Exclude<RowCondition, { kind: "expression" }>;
  onChange: (next: RowCondition) => void;
}) {
  if (condition.kind === "item-type" || condition.kind === "library")
    return (
      <Dropdown
        aria-label={m.settings_profile_rule_operator()}
        value={condition.negated ? "is-not" : "is"}
        onChange={(value) =>
          onChange({ ...condition, negated: value === "is-not" })
        }
      >
        <DropdownItem value="is">
          {m.settings_profile_rule_operator_is()}
        </DropdownItem>
        <DropdownItem value="is-not">
          {m.settings_profile_rule_operator_is_not()}
        </DropdownItem>
      </Dropdown>
    );

  const value = condition.negated
    ? condition.operator === "isEmpty"
      ? "is-not-empty"
      : condition.kind === "collections" && condition.operator === "within"
        ? "not-within"
        : condition.kind === "collections"
          ? "not-contains"
          : "does-not-contain"
    : condition.operator;
  const change = (operator: string) => {
    const negated =
      operator === "does-not-contain" ||
      operator === "not-within" ||
      operator === "not-contains" ||
      operator === "is-not-empty";
    if (condition.kind === "collections") {
      const nextOperator =
        operator === "not-contains"
          ? "contains"
          : operator === "not-within"
            ? "within"
            : operator === "is-not-empty"
              ? "isEmpty"
              : (operator as typeof condition.operator);
      const values =
        nextOperator === "contains" || nextOperator === "within"
          ? condition.values.slice(0, 1)
          : condition.values;
      onChange({ ...condition, operator: nextOperator, negated, values });
      return;
    }
    const nextOperator =
      operator === "does-not-contain"
        ? "contains"
        : operator === "is-not-empty"
          ? "isEmpty"
          : (operator as typeof condition.operator);
    const values =
      nextOperator === "contains"
        ? condition.values.slice(0, 1)
        : condition.values;
    onChange({ ...condition, operator: nextOperator, negated, values });
  };
  return (
    <Dropdown
      className="zt:shrink-0"
      aria-label={m.settings_profile_rule_operator()}
      value={value}
      onChange={change}
    >
      {condition.kind === "collections" ? (
        <>
          <DropdownItem value="within">
            {m.settings_profile_rule_collection_within()}
          </DropdownItem>
          <DropdownItem value="not-within">
            {m.settings_profile_rule_collection_not_within()}
          </DropdownItem>
          <DropdownItem value="contains">
            {m.settings_profile_rule_collection_contains()}
          </DropdownItem>
          <DropdownItem value="not-contains">
            {m.settings_profile_rule_collection_not_contains()}
          </DropdownItem>
          <DropdownItem value="containsAny">
            {m.settings_profile_rule_collection_contains_any()}
          </DropdownItem>
          <DropdownItem value="containsAll">
            {m.settings_profile_rule_collection_contains_all()}
          </DropdownItem>
          <DropdownItem value="isEmpty">
            {m.settings_profile_rule_collection_is_empty()}
          </DropdownItem>
          <DropdownItem value="is-not-empty">
            {m.settings_profile_rule_collection_is_not_empty()}
          </DropdownItem>
        </>
      ) : (
        <>
          <DropdownItem value="contains">
            {m.settings_profile_rule_tag_contains()}
          </DropdownItem>
          <DropdownItem value="does-not-contain">
            {m.settings_profile_rule_tag_does_not_contain()}
          </DropdownItem>
          <DropdownItem value="containsAny">
            {m.settings_profile_rule_tag_contains_any()}
          </DropdownItem>
          <DropdownItem value="containsAll">
            {m.settings_profile_rule_tag_contains_all()}
          </DropdownItem>
          <DropdownItem value="isEmpty">
            {m.settings_profile_rule_tag_is_empty()}
          </DropdownItem>
          <DropdownItem value="is-not-empty">
            {m.settings_profile_rule_tag_is_not_empty()}
          </DropdownItem>
        </>
      )}
    </Dropdown>
  );
}

function ConditionValue({
  condition,
  onChange,
}: {
  condition: Exclude<RowCondition, { kind: "expression" }>;
  onChange: (next: RowCondition) => void;
}) {
  const deps = useRuleEditorStore((state) => state.deps);
  const collections = deps.collections;
  const suggestionsId = useId();
  switch (condition.kind) {
    case "library": {
      const available = deps.libraries.some(
        ({ selector }) => selectorKey(selector) === condition.values[0],
      );
      return (
        <Dropdown
          className="zt:min-w-0 zt:flex-1"
          {...tooltipAttrs(m.settings_profile_rule_value())}
          value={condition.values[0]}
          onChange={(value) => onChange({ ...condition, values: [value] })}
        >
          {deps.libraries.map((library) => (
            <DropdownItem
              key={selectorKey(library.selector)}
              value={selectorKey(library.selector)}
            >
              {libraryLabel(library)}
            </DropdownItem>
          ))}
          {!available && (
            <DropdownItem value={condition.values[0]}>
              {condition.values[0]}
            </DropdownItem>
          )}
        </Dropdown>
      );
    }
    case "item-type":
      return (
        <Dropdown
          className="zt:min-w-0 zt:flex-1"
          aria-label={m.settings_profile_rule_value()}
          value={condition.values[0]}
          onChange={(itemType) =>
            onChange({ ...condition, values: [itemType] })
          }
        >
          {ITEM_TYPES.map((itemType) => (
            <DropdownItem key={itemType.name} value={itemType.name}>
              {itemTypeLabel(itemType.name)}
            </DropdownItem>
          ))}
        </Dropdown>
      );
    case "collections": {
      if (condition.operator === "isEmpty") return null;
      const suggestions = collections.map(({ path }) => path.join("/"));
      const hint = (value: string) =>
        suggestions.includes(value)
          ? null
          : m.settings_profile_rule_collection_not_found();
      if (
        condition.operator === "containsAny" ||
        condition.operator === "containsAll"
      )
        return (
          <ChipInput
            values={condition.values.map((path) => path.join("/"))}
            onChange={(values) =>
              onChange({
                ...condition,
                values: values.map((value) => value.split("/")),
              })
            }
            placeholder={m.settings_profile_rule_collection_placeholder()}
            suggestions={suggestions}
            hint={hint}
          />
        );
      const value = condition.values[0]?.join("/") ?? "";
      return (
        <div className="zt:flex zt:min-w-0 zt:flex-1 zt:flex-col">
          <input
            type="text"
            className="zt:w-full zt:min-w-0"
            aria-label={m.settings_profile_rule_value()}
            placeholder={m.settings_profile_rule_collection_placeholder()}
            value={value}
            list={suggestions.length ? suggestionsId : undefined}
            onChange={(event) =>
              onChange({
                ...condition,
                values: [event.currentTarget.value.split("/")],
              })
            }
          />
          {value !== "" && hint(value) && (
            <span className="zt:px-2 zt:pb-1 zt:text-xs zt:leading-tight zt:text-muted-foreground">
              {hint(value)}
            </span>
          )}
          {suggestions.length ? (
            <datalist id={suggestionsId}>
              {suggestions.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          ) : null}
        </div>
      );
    }
    case "tags": {
      if (condition.operator === "isEmpty") return null;
      if (
        condition.operator === "containsAny" ||
        condition.operator === "containsAll"
      )
        return (
          <ChipInput
            values={condition.values}
            onChange={(values) => onChange({ ...condition, values })}
            placeholder={m.settings_profile_rule_tag_placeholder()}
          />
        );
      return (
        <input
          type="text"
          className="zt:min-w-0 zt:flex-1"
          aria-label={m.settings_profile_rule_value()}
          placeholder={m.settings_profile_rule_tag_placeholder()}
          value={condition.values[0] ?? ""}
          onChange={(event) =>
            onChange({ ...condition, values: [event.currentTarget.value] })
          }
        />
      );
    }
  }
}
