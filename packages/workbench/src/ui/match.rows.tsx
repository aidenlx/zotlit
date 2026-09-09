import type { ComponentProps } from "react";

import { ITEM_TYPES } from "@zotlit/zotero-types/item-types";

import { useWorkbenchHost } from "./host";
import { ChipInput } from "./match.chips";
import type { RowCondition, MatchEditorDeps } from "./match.draft";
import { MatchInput } from "./match.input";
// Kind, operator, and value controls preserve the established Match vocabulary.
import { useWorkbenchMessages } from "./messages";
import { WorkbenchSelect } from "./select";
import { useParts } from "./theme";

import { selectorKey } from "#/match/condition";
export function MatchSelect({
  onChange,
  ...props
}: Omit<ComponentProps<typeof WorkbenchSelect>, "onChange"> & {
  onChange: (value: string) => void;
}) {
  return (
    <WorkbenchSelect
      {...props}
      onInput={(event) => onChange(event.currentTarget.value)}
    />
  );
}
export function ConditionOperator({
  condition,
  onChange,
}: {
  condition: Exclude<RowCondition, { kind: "expression" }>;
  onChange: (next: RowCondition) => void;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("match");
  if (condition.kind === "item-type" || condition.kind === "library")
    return (
      <MatchSelect
        aria-label={m.workbench_match_operator()}
        value={condition.negated ? "is-not" : "is"}
        onChange={(value) =>
          onChange({ ...condition, negated: value === "is-not" })
        }
      >
        <option value="is">{m.workbench_match_operator_is()}</option>
        <option value="is-not">{m.workbench_match_operator_is_not()}</option>
      </MatchSelect>
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
    <MatchSelect
      {...part("control")}
      aria-label={m.workbench_match_operator()}
      value={value}
      onChange={change}
    >
      {condition.kind === "collections" ? (
        <>
          <option value="within">
            {m.workbench_match_collection_within()}
          </option>
          <option value="not-within">
            {m.workbench_match_collection_not_within()}
          </option>
          <option value="contains">
            {m.workbench_match_collection_contains()}
          </option>
          <option value="not-contains">
            {m.workbench_match_collection_not_contains()}
          </option>
          <option value="containsAny">
            {m.workbench_match_collection_contains_any()}
          </option>
          <option value="containsAll">
            {m.workbench_match_collection_contains_all()}
          </option>
          <option value="isEmpty">
            {m.workbench_match_collection_is_empty()}
          </option>
          <option value="is-not-empty">
            {m.workbench_match_collection_is_not_empty()}
          </option>
        </>
      ) : (
        <>
          <option value="contains">{m.workbench_match_tag_contains()}</option>
          <option value="does-not-contain">
            {m.workbench_match_tag_does_not_contain()}
          </option>
          <option value="containsAny">
            {m.workbench_match_tag_contains_any()}
          </option>
          <option value="containsAll">
            {m.workbench_match_tag_contains_all()}
          </option>
          <option value="isEmpty">{m.workbench_match_tag_is_empty()}</option>
          <option value="is-not-empty">
            {m.workbench_match_tag_is_not_empty()}
          </option>
        </>
      )}
    </MatchSelect>
  );
}

export function ConditionValue({
  condition,
  onChange,
  deps,
}: {
  condition: Exclude<RowCondition, { kind: "expression" }>;
  onChange: (next: RowCondition) => void;
  deps: MatchEditorDeps;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("match");
  const host = useWorkbenchHost();
  const collections = deps.collections;
  switch (condition.kind) {
    case "library":
      return (
        <ChipInput
          values={condition.values.filter(Boolean)}
          onChange={(values) =>
            onChange({ ...condition, values: [values.at(-1) ?? ""] })
          }
          placeholder={m.workbench_match_value()}
          suggestions={deps.libraries.map((library) =>
            selectorKey(library.selector),
          )}
          hint={(value) =>
            deps.libraries.find(
              (library) => selectorKey(library.selector) === value,
            )?.name ?? null
          }
        />
      );
    case "item-type":
      return (
        <MatchSelect
          {...part("control")}
          aria-label={m.workbench_match_value()}
          value={condition.values[0]}
          onChange={(itemType) =>
            onChange({ ...condition, values: [itemType] })
          }
        >
          {ITEM_TYPES.map((itemType) => (
            <option key={itemType.name} value={itemType.name}>
              {
                itemType.labels[
                  host.getLocale() === "zh-CN" ? "zh-CN" : "en-US"
                ]
              }
            </option>
          ))}
        </MatchSelect>
      );
    case "collections": {
      if (condition.operator === "isEmpty") return null;
      const suggestions = collections.map(({ path }) => path.join("/"));
      const hint = (value: string) =>
        suggestions.includes(value)
          ? null
          : m.workbench_match_collection_not_found();
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
            placeholder={m.workbench_match_collection_placeholder()}
            suggestions={suggestions}
            hint={hint}
          />
        );
      const value = condition.values[0]?.join("/") ?? "";
      return (
        <div {...part("control")}>
          <MatchInput
            {...part("input")}
            aria-label={m.workbench_match_value()}
            placeholder={m.workbench_match_collection_placeholder()}
            value={value}
            suggestions={suggestions}
            onChange={(value) =>
              onChange({
                ...condition,
                values: [value.split("/")],
              })
            }
          />
          {value !== "" && hint(value) && (
            <span {...part("control")}>{hint(value)}</span>
          )}
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
            placeholder={m.workbench_match_tag_placeholder()}
            suggestions={deps.tags}
          />
        );
      return (
        <MatchInput
          {...part("input")}
          aria-label={m.workbench_match_value()}
          placeholder={m.workbench_match_tag_placeholder()}
          suggestions={deps.tags}
          value={condition.values[0] ?? ""}
          onChange={(value) => onChange({ ...condition, values: [value] })}
        />
      );
    }
  }
}
