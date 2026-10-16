import type {
  FilterDataset,
  FilterField,
  FilterFieldKind,
  FilterOperator,
  FilterRow,
} from "#/match/fields";
// The conditions of a Query Dataset as the Match editor offers them: the
// kind picker's names and icons, and each field's operator and value
// controls. The Query View's Filter and the Profile Match share them.
import type { ReactNode } from "react";

import { ITEM_TYPES } from "@zotlit/zotero-types/item-types";

import type { WorkbenchMessages } from "./generated/messages";
import { useWorkbenchHost } from "./host";
import { ChipInput } from "./match.chips";
import type {
  MatchConditionKind,
  MatchVocabulary,
  RowCondition,
} from "./match.draft";
import { MatchInput } from "./match.input";
import { MatchSelect } from "./match.rows";
import { useWorkbenchMessages } from "./messages";
import { useIcon, useParts } from "./theme";
import type { WorkbenchIcon } from "./theme";

import {
  FILTER_OPERATORS,
  filterFields,
  formatFilterRow,
  freshFilterRow,
  parseFilterRow,
  withOperator,
} from "#/match/fields";

/** The values a condition offers, from the Libraries the filter reads. */
export interface FilterValues {
  readonly tags: readonly string[];
  /** Collection paths, joined by `/`. */
  readonly collections: readonly string[];
  /** `personal` or `group:<groupID>`, with the group's name. */
  readonly libraries: readonly { id: string; name: string | null }[];
}

type Label = (m: WorkbenchMessages) => string;

const KIND_LABELS: Record<FilterFieldKind, Label> = {
  color: (m) => m.workbench_filter_field_color(),
  tags: (m) => m.workbench_filter_field_tag(),
  comment: (m) => m.workbench_filter_field_comment(),
  text: (m) => m.workbench_filter_field_text(),
  page: (m) => m.workbench_filter_field_page(),
  "date-added": (m) => m.workbench_filter_field_date_added(),
  "date-modified": (m) => m.workbench_filter_field_date_modified(),
  "item-title": (m) => m.workbench_filter_field_item_title(),
  creators: (m) => m.workbench_filter_field_creator(),
  "first-author": (m) => m.workbench_filter_field_first_author(),
  year: (m) => m.workbench_filter_field_year(),
  "item-type": (m) => m.workbench_filter_field_item_type(),
  collection: (m) => m.workbench_filter_field_collection(),
  library: (m) => m.workbench_filter_field_library(),
  "attachment-title": (m) => m.workbench_filter_field_attachment_title(),
  "file-type": (m) => m.workbench_filter_field_file_type(),
};

const OPERATOR_LABELS: Record<FilterOperator, Label> = {
  contains: (m) => m.workbench_filter_op_contains(),
  "does-not-contain": (m) => m.workbench_filter_op_does_not_contain(),
  "contains-any": (m) => m.workbench_filter_op_contains_any(),
  "contains-all": (m) => m.workbench_filter_op_contains_all(),
  within: (m) => m.workbench_filter_op_within(),
  "not-within": (m) => m.workbench_filter_op_not_within(),
  is: (m) => m.workbench_filter_op_is(),
  "is-not": (m) => m.workbench_filter_op_is_not(),
  "is-empty": (m) => m.workbench_filter_op_is_empty(),
  "is-not-empty": (m) => m.workbench_filter_op_is_not_empty(),
  before: (m) => m.workbench_filter_op_before(),
  after: (m) => m.workbench_filter_op_after(),
  "on-or-before": (m) => m.workbench_filter_op_on_or_before(),
  "on-or-after": (m) => m.workbench_filter_op_on_or_after(),
};

/** A Collection is a member, not a text: "is" reads better than "contains". */
const COLLECTION_LABELS: Partial<Record<FilterOperator, Label>> = {
  contains: (m) => m.workbench_filter_op_is(),
  "does-not-contain": (m) => m.workbench_filter_op_is_not(),
  "contains-any": (m) => m.workbench_filter_op_is_any(),
  "contains-all": (m) => m.workbench_filter_op_is_all(),
  "is-empty": (m) => m.workbench_filter_op_is_empty(),
  "is-not-empty": (m) => m.workbench_filter_op_is_not_empty(),
};

const COLORS: readonly [string, Label][] = [
  ["yellow", (m) => m.workbench_filter_color_yellow()],
  ["red", (m) => m.workbench_filter_color_red()],
  ["green", (m) => m.workbench_filter_color_green()],
  ["blue", (m) => m.workbench_filter_color_blue()],
  ["purple", (m) => m.workbench_filter_color_purple()],
  ["magenta", (m) => m.workbench_filter_color_magenta()],
  ["orange", (m) => m.workbench_filter_color_orange()],
  ["gray", (m) => m.workbench_filter_color_gray()],
  ["plum", (m) => m.workbench_filter_color_plum()],
];

const FILE_TYPES: readonly [string, Label][] = [
  ["pdf", (m) => m.workbench_filter_file_type_pdf()],
  ["epub", (m) => m.workbench_filter_file_type_epub()],
  ["web", (m) => m.workbench_filter_file_type_web()],
  ["other", (m) => m.workbench_filter_file_type_other()],
];

function choices(
  kind: FilterFieldKind,
  {
    values,
    m,
    locale,
  }: { values: FilterValues; m: WorkbenchMessages; locale: string },
): readonly [string, string][] {
  switch (kind) {
    case "color":
      return COLORS.map(([value, label]) => [value, label(m)]);
    case "file-type":
      return FILE_TYPES.map(([value, label]) => [value, label(m)]);
    case "item-type": {
      const labels = locale === "zh-CN" ? "zh-CN" : "en-US";
      return ITEM_TYPES.map((type) => [type.name, type.labels[labels]]);
    }
    case "library":
      return values.libraries.map(({ id, name }) => [
        id,
        id === "personal"
          ? m.workbench_filter_library_personal()
          : (name ?? id),
      ]);
    default:
      return [];
  }
}

function RowOperator({
  field,
  condition,
  onChange,
}: {
  field: FilterField;
  condition: FilterRow;
  onChange: (next: FilterRow) => void;
}) {
  const m = useWorkbenchMessages();
  return (
    <MatchSelect
      aria-label={m.workbench_filter_operator()}
      value={condition.operator}
      onChange={(value) =>
        onChange(withOperator(condition, value as FilterOperator))
      }
    >
      {FILTER_OPERATORS[field.type].map((operator) => (
        <option key={operator} value={operator}>
          {(field.type === "collection"
            ? (COLLECTION_LABELS[operator] ?? OPERATOR_LABELS[operator])
            : OPERATOR_LABELS[operator])(m)}
        </option>
      ))}
    </MatchSelect>
  );
}

function RowValue({
  field,
  condition,
  values,
  onChange,
}: {
  field: FilterField;
  condition: FilterRow;
  values: FilterValues;
  onChange: (next: FilterRow) => void;
}) {
  const m = useWorkbenchMessages();
  const host = useWorkbenchHost();
  const part = useParts("match");
  const { operator } = condition;
  if (operator === "is-empty" || operator === "is-not-empty") return null;
  const suggestions =
    field.kind === "tags"
      ? values.tags
      : field.type === "collection"
        ? values.collections
        : undefined;
  const placeholder =
    field.kind === "tags"
      ? m.workbench_filter_tag_placeholder()
      : field.type === "collection"
        ? m.workbench_filter_collection_placeholder()
        : m.workbench_filter_value();
  if (operator === "contains-any" || operator === "contains-all")
    return (
      <ChipInput
        values={condition.values}
        onChange={(next) => onChange({ ...condition, values: next })}
        placeholder={placeholder}
        suggestions={suggestions}
      />
    );
  if (field.type === "choice") {
    const options = choices(field.kind, {
      values,
      m,
      locale: host.getLocale(),
    });
    return (
      <MatchSelect
        {...part("control")}
        aria-label={m.workbench_filter_value()}
        value={condition.value}
        onChange={(value) => onChange({ ...condition, value })}
      >
        {condition.value === "" ? (
          <option value="" disabled>
            {m.workbench_match_value_empty()}
          </option>
        ) : options.some(([value]) => value === condition.value) ? null : (
          <option value={condition.value}>{condition.value}</option>
        )}
        {options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </MatchSelect>
    );
  }
  if (field.type === "number" || field.type === "date")
    return (
      <input
        {...part("input")}
        type={field.type}
        aria-label={m.workbench_filter_value()}
        placeholder={m.workbench_match_value_empty()}
        value={condition.value}
        onInput={(event) =>
          onChange({ ...condition, value: event.currentTarget.value })
        }
      />
    );
  return (
    <MatchInput
      {...part("input")}
      aria-label={m.workbench_filter_value()}
      placeholder={placeholder}
      suggestions={suggestions}
      value={condition.value}
      onChange={(value) => onChange({ ...condition, value })}
    />
  );
}

const FIELD_ICONS: Record<FilterField["type"], WorkbenchIcon> = {
  text: "property-text",
  list: "property-list",
  collection: "property-list",
  choice: "property-text",
  number: "property-number",
  date: "property-date",
};

/** The theme's icon of a field's value type. */
function FieldIcon({ field }: { field: FilterField }) {
  const icon = useIcon();
  return icon(
    field.kind === "tags" ? "property-tags" : FIELD_ICONS[field.type],
  );
}

/**
 * The conditions of one dataset, as the Match editor offers them. A
 * condition shows `label(field)` where it gives one, else the name of its
 * kind, and `icon(field)` where it gives one, else the theme's icon of its
 * value type.
 */
export function filterVocabulary(
  dataset: FilterDataset,
  {
    m,
    values,
    issue,
    label,
    icon,
  }: {
    m: WorkbenchMessages;
    values: FilterValues;
    issue?: (
      condition: RowCondition<FilterRow>,
      path: readonly number[],
    ) => string | null;
    label?: (field: FilterField) => string | null | undefined;
    icon?: (field: FilterField) => ReactNode;
  },
): MatchVocabulary<FilterRow> {
  const fields = filterFields(dataset);
  const kinds = fields.map(
    (field): MatchConditionKind<FilterRow> => ({
      kind: field.kind,
      label: label?.(field) ?? KIND_LABELS[field.kind](m),
      icon: icon ? icon(field) : <FieldIcon field={field} />,
      fresh: () => freshFilterRow(field),
      parse: (text) => {
        const row = parseFilterRow(text, fields);
        return row?.kind === field.kind ? row : null;
      },
      format: (row) => formatFilterRow(row, fields),
      renderOperator: ({ condition, onChange }) => (
        <RowOperator field={field} condition={condition} onChange={onChange} />
      ),
      renderValue: ({ condition, onChange }) => (
        <RowValue
          field={field}
          condition={condition}
          values={values}
          onChange={onChange}
        />
      ),
    }),
  );
  const first = fields[0]!.kind;
  return { kinds, newKind: first, ...(issue ? { issue } : {}) };
}
