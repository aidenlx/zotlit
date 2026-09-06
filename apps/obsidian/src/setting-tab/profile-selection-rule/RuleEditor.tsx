// The rule editor's body: the target Profile, the Library scope, and the
// conditions — a filter builder in the shape of Obsidian's Bases filter
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
import { libraryLabel, selectorLabel } from "@/services/library-scope/label";
import { compareSelectors, selectorKey } from "@/services/library-scope/scope";
import type {
  LibrarySelector,
  LibraryScope,
} from "@/services/library-scope/scope";
import {
  choicesLookup,
  collectionKey,
  collectionLabel,
  itemTypeLabel,
} from "@/services/profile-selection";

import {
  appendAt,
  asExpression,
  asLabelled,
  describeOptions,
  draftInvalid,
  freshCondition,
  freshGroup,
  removeAt,
  replaceAt,
  rowIssue,
  scopeIssue,
  updateGroup,
  vacuous,
} from "./draft";
import type {
  ConditionGroup,
  ConditionKind,
  ConditionPath,
  GroupMatch,
  RowCondition,
  RuleDraft,
} from "./draft";
import { ExpressionEditor } from "./ExpressionEditor";
import { useRuleEditorStore } from "./store";

/**
 * The controls Obsidian nests inside a box of its own — a Property editor, a
 * Bases filter row — read these tokens for their border, radius and surface.
 * Flattening them there lets the box own all three, so the controls read as
 * segments of one control instead of a line of loose ones.
 */
const flatControls = cn(
  "zt:[--input-border-width-focus:0px] zt:[--input-border-width:0px]",
  "zt:[--input-radius:0px] zt:[--input-shadow:none]",
  "zt:[--dropdown-background:var(--background-modifier-form-field)]",
  "zt:[--dropdown-background-hover:var(--background-modifier-form-field-hover)]",
);

/** One statement's box: an input's surface, ring and radius around its controls. */
const statementBox = cn(
  "zt:flex zt:items-center zt:overflow-hidden zt:rounded-md zt:bg-input",
  "zt:ring-1 zt:ring-border-hover",
  "zt:focus-within:ring-2 zt:focus-within:ring-border-focus",
  "zt:[--icon-size:var(--icon-s)] zt:[--icon-stroke:var(--icon-s-stroke-width)]",
  flatControls,
);

/**
 * The controls of one statement. They sit on the box's own surface, so the
 * hairline the gap leaves between them is what separates one from the next.
 */
const statementControls =
  "zt:flex zt:min-w-0 zt:flex-1 zt:flex-wrap zt:items-center zt:gap-px zt:bg-border";

/** A statement's own buttons, at the trailing end of its box. */
const statementActions = "zt:flex zt:shrink-0 zt:items-center zt:p-0.5";

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
  onSave: (draft: RuleDraft) => void;
  onCancel: () => void;
}

export function RuleEditor({ footer, onSave, onCancel }: RuleEditorProps) {
  return (
    <div className="zt:flex zt:flex-col zt:gap-4">
      <ProfileField />
      <LibrariesField />
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
      <Button
        variant="cta"
        disabled={invalid}
        onClick={() => {
          if (!invalid) onSave(draft);
        }}
      >
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
  children,
}: {
  name: string;
  desc: string;
  error: string | null;
  control: (labelId: string) => ReactNode;
  children?: ReactNode;
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
      {children}
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

function LibrariesField() {
  const scope = useRuleEditorStore((state) => state.draft.scope);
  const libraries = useRuleEditorStore((state) => state.deps.libraries);
  const setScope = useRuleEditorStore((state) => state.setScope);
  /** Where switching Libraries to Selected starts: My Library, when available. */
  const starting = (): LibrarySelector[] =>
    libraries.some((library) => library.selector.type === "personal")
      ? [{ type: "personal" }]
      : [];
  return (
    <Field
      name={m.settings_profile_rule_scope()}
      desc={m.settings_profile_rule_scope_desc()}
      error={scopeIssue(scope)}
      control={(labelId) => (
        <Dropdown
          aria-labelledby={labelId}
          value={scope.mode}
          onChange={(value) =>
            setScope(
              value === "all"
                ? { mode: "all" }
                : { mode: "selected", libraries: starting() },
            )
          }
        >
          <DropdownItem value="all">
            {m.settings_library_scope_all()}
          </DropdownItem>
          <DropdownItem value="selected">
            {m.settings_library_scope_selected()}
          </DropdownItem>
        </Dropdown>
      )}
    >
      {scope.mode === "selected" && (
        <LibraryChecklist scope={scope} onChange={setScope} />
      )}
    </Field>
  );
}

/**
 * Every selected Library, available or not, then every available Library
 * this rule does not select — one checkbox each.
 */
function LibraryChecklist({
  scope,
  onChange,
}: {
  scope: Extract<LibraryScope, { mode: "selected" }>;
  onChange: (scope: LibraryScope) => void;
}) {
  const libraries = useRuleEditorStore((state) => state.deps.libraries);
  const byKey = new Map(
    libraries.map((library) => [selectorKey(library.selector), library]),
  );
  const selected = new Set(scope.libraries.map(selectorKey));
  const rows = [
    ...scope.libraries.map((selector) => {
      const library = byKey.get(selectorKey(selector));
      return {
        selector,
        label: library ? libraryLabel(library) : selectorLabel(selector),
        unavailable: library === undefined,
        checked: true,
      };
    }),
    ...libraries
      .filter((library) => !selected.has(selectorKey(library.selector)))
      .map((library) => ({
        selector: library.selector,
        label: libraryLabel(library),
        unavailable: false,
        checked: false,
      })),
  ];
  return (
    <ul className="zt:flex zt:flex-col zt:gap-1.5 zt:rounded-md zt:bg-card zt:p-3">
      {rows.map((row) => (
        <li key={selectorKey(row.selector)}>
          <label className="zt:flex zt:items-center zt:gap-2 zt:text-sm">
            <input
              type="checkbox"
              checked={row.checked}
              onChange={(event) =>
                onChange({
                  mode: "selected",
                  libraries: event.currentTarget.checked
                    ? [...scope.libraries, row.selector].sort(compareSelectors)
                    : scope.libraries.filter(
                        (candidate) =>
                          selectorKey(candidate) !== selectorKey(row.selector),
                      ),
                })
              }
            />
            <span>{row.label}</span>
            {row.unavailable && (
              <span className="zt:text-xs zt:text-muted-foreground">
                {m.settings_library_scope_unavailable()}
              </span>
            )}
          </label>
        </li>
      ))}
    </ul>
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
  const collections = useRuleEditorStore((state) => state.deps.collections);
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
            setRoot(
              appendAt(
                root,
                path,
                freshCondition("item-type", false, collections),
              ),
            )
          }
        >
          <Icon name="plus" />
          <span>{m.settings_profile_rule_add_condition()}</span>
        </button>
        <button
          type="button"
          className={quietButton}
          onClick={() =>
            setRoot(appendAt(root, path, freshGroup(group.match, collections)))
          }
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
  const issue = rowIssue(condition, deps);
  const labelled =
    condition.kind === "expression" ? asLabelled(condition) : null;
  return (
    <div className="zt:flex zt:flex-col">
      <div
        className={cn(
          statementBox,
          issue !== null && "zt:ring-(--background-modifier-error)",
        )}
      >
        <div className={statementControls}>
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
                  replace(
                    freshCondition(
                      value as ConditionKind,
                      condition.negated,
                      deps.collections,
                    ),
                  )
                }
              >
                <DropdownItem value="item-type">
                  {m.settings_profile_rule_condition_item_type()}
                </DropdownItem>
                <DropdownItem value="collection">
                  {m.settings_profile_rule_condition_collection()}
                </DropdownItem>
                <DropdownItem value="tags">
                  {m.settings_profile_rule_condition_tag()}
                </DropdownItem>
              </Dropdown>
              <Dropdown
                aria-label={m.settings_profile_rule_operator()}
                value={condition.negated ? "is-not" : "is"}
                onChange={(value) =>
                  replace({ ...condition, negated: value === "is-not" })
                }
              >
                <DropdownItem value="is">
                  {m.settings_profile_rule_operator_is()}
                </DropdownItem>
                <DropdownItem value="is-not">
                  {m.settings_profile_rule_operator_is_not()}
                </DropdownItem>
              </Dropdown>
              <ConditionValue condition={condition} onChange={replace} />
            </>
          )}
        </div>
        <div className={statementActions}>
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

function ConditionValue({
  condition,
  onChange,
}: {
  condition: Exclude<RowCondition, { kind: "expression" }>;
  onChange: (next: RowCondition) => void;
}) {
  const deps = useRuleEditorStore((state) => state.deps);
  switch (condition.kind) {
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
    case "collection": {
      // A reference the database no longer holds stays selected, flagged, so
      // the user can see what the rule pointed at before choosing a replacement.
      const current = collectionKey(condition);
      const known = choicesLookup(deps.collections)(condition);
      return (
        <>
          <Dropdown
            // A Library-and-path label needs room: wrap before it is crushed.
            className="zt:min-w-48 zt:flex-1"
            aria-label={m.settings_profile_rule_value()}
            value={current}
            onChange={(value) => {
              const choice = deps.collections.find(
                (candidate) => collectionKey(candidate) === value,
              );
              if (choice)
                onChange({
                  ...condition,
                  library: choice.library,
                  key: choice.key,
                });
            }}
          >
            {deps.collections.map((choice) => (
              <DropdownItem
                key={collectionKey(choice)}
                value={collectionKey(choice)}
              >
                {collectionLabel(choice, describeOptions(deps))}
              </DropdownItem>
            ))}
            {!known && (
              <DropdownItem value={current}>
                {collectionLabel(condition, { libraries: deps.libraries })}
              </DropdownItem>
            )}
          </Dropdown>
          <Dropdown
            // Last in the row, so it takes the space left over — the colour
            // behind the controls stays a hairline between them.
            className="zt:min-w-0 zt:flex-1"
            aria-label={m.settings_profile_rule_collection_scope()}
            value={condition.descendants ? "descendants" : "direct"}
            onChange={(value) =>
              onChange({ ...condition, descendants: value === "descendants" })
            }
          >
            <DropdownItem value="descendants">
              {m.settings_profile_rule_collection_descendants()}
            </DropdownItem>
            <DropdownItem value="direct">
              {m.settings_profile_rule_collection_direct()}
            </DropdownItem>
          </Dropdown>
        </>
      );
    }
    case "tags":
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
