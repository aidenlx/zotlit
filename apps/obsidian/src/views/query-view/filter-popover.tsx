// The Query View's Filter: the shared Match editor with the conditions of the
// view's Query Dataset, once for the filters for all views and once for the
// view's own. `FilterEditor` holds both sections and reads nothing from a
// host, so the toolbar popover here and the sidebar's "Filter..." mount the
// same part.
//
// The popover is the toolbar's native popover in the top layer (apps/obsidian
// ADR 0044).
// Obsidian's typing suggestions draw in the page under it, so the value fields
// take the browser's own suggestion list instead.
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";

import type { MatchTree } from "@zotlit/templates/facade";
import {
  ChipInput,
  MatchEditor,
  MatchInput,
  MatchSelect,
  WorkbenchHostProvider,
  WorkbenchThemeProvider,
  useParts,
} from "@zotlit/workbench/ui";
import type {
  MatchConditionKind,
  MatchFilter,
  MatchVocabulary,
  RowCondition,
} from "@zotlit/workbench/ui";
import { ITEM_TYPES } from "@zotlit/zotero-types/item-types";

import { useObsidianApp } from "@/lib/app-context";
import * as m from "@/lib/i18n/generated/messages";
import { runtime } from "@/lib/i18n/generated/runtime";
import { getLogger } from "@/lib/log";
import { createTemplateWorkbenchHost } from "@/views/template-workbench/host";
import { matchTheme } from "@/views/template-workbench/match-pane";

import {
  FILTER_OPERATORS,
  filterFields,
  formatFilterRow,
  freshFilterRow,
  parseFilterRow,
  withOperator,
} from "./filter-fields";
import type {
  FilterField,
  FilterFieldKind,
  FilterOperator,
  FilterRow,
} from "./filter-fields";
import { allViewsDataset } from "./query-file";
import type {
  ConditionIssue,
  FilterSection,
  QueryFileDataset,
} from "./query-file";
import { ToolbarPopover } from "./toolbar-popover";
import type { QueryView } from "./view";

const logger = getLogger(["views", "query-view", "filter"]);

/** The values a condition offers, from the Libraries the view reads. */
export interface FilterValues {
  readonly tags: readonly string[];
  /** Collection paths, joined by `/`. */
  readonly collections: readonly string[];
  /** `personal` or `group:<groupID>`, with the group's name. */
  readonly libraries: readonly { id: string; name: string | null }[];
}

const NO_VALUES: FilterValues = { tags: [], collections: [], libraries: [] };

/** The issue of one condition, as the Query View last found it. */
export type FilterIssue = ConditionIssue | null;

const KIND_LABELS: Record<FilterFieldKind, () => string> = {
  color: m.query_view_property_color,
  tags: m.query_view_property_tag,
  comment: m.annot_view_card_comment_label,
  text: m.query_view_filter_text,
  page: m.query_view_property_page,
  "date-added": m.query_view_property_date_added,
  "date-modified": m.query_view_property_date_modified,
  "item-title": m.query_view_property_item_title,
  creators: m.query_view_filter_creator,
  "first-author": m.query_view_property_first_author,
  year: m.query_view_filter_year,
  "item-type": m.query_view_property_item_type,
  collection: m.query_view_property_collection,
  library: m.query_view_property_library,
  "attachment-title": m.query_view_property_attachment_title,
  "file-type": m.query_view_filter_file_type,
};

const OPERATOR_LABELS: Record<FilterOperator, () => string> = {
  contains: m.query_view_filter_op_contains,
  "does-not-contain": m.query_view_filter_op_does_not_contain,
  "contains-any": m.query_view_filter_op_contains_any,
  "contains-all": m.query_view_filter_op_contains_all,
  within: m.query_view_filter_op_within,
  "not-within": m.query_view_filter_op_not_within,
  is: m.query_view_filter_op_is,
  "is-not": m.query_view_filter_op_is_not,
  "is-empty": m.query_view_filter_op_is_empty,
  "is-not-empty": m.query_view_filter_op_is_not_empty,
  before: m.query_view_filter_op_before,
  after: m.query_view_filter_op_after,
  "on-or-before": m.query_view_filter_op_on_or_before,
  "on-or-after": m.query_view_filter_op_on_or_after,
};

/** A Collection is a member, not a text: "is" reads better than "contains". */
const COLLECTION_LABELS: Partial<Record<FilterOperator, () => string>> = {
  contains: m.query_view_filter_op_is,
  "does-not-contain": m.query_view_filter_op_is_not,
  "contains-any": m.query_view_filter_op_is_any,
  "contains-all": m.query_view_filter_op_is_all,
  "is-empty": m.query_view_filter_op_is_empty,
  "is-not-empty": m.query_view_filter_op_is_not_empty,
};

const COLORS: readonly [string, () => string][] = [
  ["yellow", m.annot_view_color_yellow],
  ["red", m.annot_view_color_red],
  ["green", m.annot_view_color_green],
  ["blue", m.annot_view_color_blue],
  ["purple", m.annot_view_color_purple],
  ["magenta", m.annot_view_color_magenta],
  ["orange", m.annot_view_color_orange],
  ["gray", m.annot_view_color_gray],
  ["plum", m.annot_view_color_plum],
];

const FILE_TYPES: readonly [string, () => string][] = [
  ["pdf", m.query_view_filter_file_type_pdf],
  ["epub", m.query_view_filter_file_type_epub],
  ["web", m.query_view_filter_file_type_web],
  ["other", m.query_view_filter_file_type_other],
];

function choices(
  kind: FilterFieldKind,
  values: FilterValues,
): readonly [string, string][] {
  switch (kind) {
    case "color":
      return COLORS.map(([value, label]) => [value, label()]);
    case "file-type":
      return FILE_TYPES.map(([value, label]) => [value, label()]);
    case "item-type": {
      const locale = runtime.getLocale() === "zh-CN" ? "zh-CN" : "en-US";
      return ITEM_TYPES.map((type) => [type.name, type.labels[locale]]);
    }
    case "library":
      return values.libraries.map(({ id, name }) => [
        id,
        id === "personal" ? m.settings_library_scope_personal() : (name ?? id),
      ]);
    default:
      return [];
  }
}

function samePath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, at) => value === b[at]);
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
  return (
    <MatchSelect
      aria-label={m.query_view_filter_operator()}
      value={condition.operator}
      onChange={(value) =>
        onChange(withOperator(condition, value as FilterOperator))
      }
    >
      {FILTER_OPERATORS[field.type].map((operator) => (
        <option key={operator} value={operator}>
          {(field.type === "collection"
            ? (COLLECTION_LABELS[operator] ?? OPERATOR_LABELS[operator])
            : OPERATOR_LABELS[operator])()}
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
      ? m.query_view_filter_tag_placeholder()
      : field.type === "collection"
        ? m.query_view_filter_collection_placeholder()
        : m.query_view_filter_value();
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
    const options = choices(field.kind, values);
    return (
      <MatchSelect
        {...part("control")}
        aria-label={m.query_view_filter_value()}
        value={condition.value}
        onChange={(value) => onChange({ ...condition, value })}
      >
        {options.some(([value]) => value === condition.value) ? null : (
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
        aria-label={m.query_view_filter_value()}
        value={condition.value}
        onInput={(event) =>
          onChange({ ...condition, value: event.currentTarget.value })
        }
      />
    );
  return (
    <MatchInput
      {...part("input")}
      aria-label={m.query_view_filter_value()}
      placeholder={placeholder}
      suggestions={suggestions}
      value={condition.value}
      onChange={(value) => onChange({ ...condition, value })}
    />
  );
}

/** The conditions of one dataset, as the Match editor offers them. */
export function filterVocabulary(
  dataset: QueryFileDataset,
  values: FilterValues,
  issue: (
    condition: RowCondition<FilterRow>,
    path: readonly number[],
  ) => string | null,
): MatchVocabulary<FilterRow> {
  const fields = filterFields(dataset);
  const kinds = fields.map(
    (field): MatchConditionKind<FilterRow> => ({
      kind: field.kind,
      label: KIND_LABELS[field.kind](),
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
  return { kinds, starterKind: first, newKind: first, issue };
}

export interface FilterEditorProps {
  /** The dataset of the view whose filters show. */
  dataset: QueryFileDataset;
  /** The dataset the filters for all views are written for. */
  allViewsDataset: QueryFileDataset;
  allViews: MatchFilter | undefined;
  thisView: MatchFilter | undefined;
  values: FilterValues;
  issue: FilterIssue;
  disabled?: boolean;
  /** The sections that show; both by default. */
  sections?: readonly FilterSection[];
  /** Save one section's filters; answers whether they were kept. */
  onChange: (section: FilterSection, next: MatchTree | undefined) => boolean;
}

/** The two sections of a view's filters: for all views, and for this view. */
export function FilterEditor({
  dataset,
  allViewsDataset: shared,
  allViews,
  thisView,
  values,
  issue,
  disabled = false,
  sections: shown = ["all", "view"],
  onChange,
}: FilterEditorProps) {
  const app = useObsidianApp();
  const host = useMemo(() => {
    const created = createTemplateWorkbenchHost(app, {
      render: () =>
        Promise.reject(new Error("The Query View filter renders no template.")),
      matchData: {
        tags: async () => [],
        collections: async () => [],
        libraries: async () => [],
      },
      insertTarget: () => null,
    });
    // The popover sits in the top layer, over Obsidian's suggestion popups.
    return { ...created, inputSuggestions: undefined };
  }, [app]);
  useEffect(() => () => host[Symbol.dispose](), [host]);
  const vocabulary = (section: FilterSection) =>
    filterVocabulary(section === "all" ? shared : dataset, values, (_, path) =>
      issue && issue.section === section && samePath(issue.path, path)
        ? issue.message
        : null,
    );
  const sections = (
    [
      ["all", m.query_view_filter_all_views(), allViews],
      ["view", m.query_view_filter_this_view(), thisView],
    ] satisfies [FilterSection, string, MatchFilter | undefined][]
  ).filter(([section]) => shown.includes(section));
  return (
    <WorkbenchHostProvider host={host}>
      <WorkbenchThemeProvider theme={matchTheme}>
        <div className="zt:flex zt:flex-col zt:gap-3">
          {sections.map(([section, heading, value]) => (
            <section key={section} data-filter-section={section}>
              {sections.length > 1 && (
                <h4 className="zt:m-0 zt:mb-1 zt:text-sm zt:font-semibold">
                  {heading}
                </h4>
              )}
              {section === "all" && shared !== dataset ? (
                <p className="zt:m-0 zt:text-sm zt:text-(--text-muted)">
                  {m.query_view_filter_other_dataset()}
                </p>
              ) : (
                <MatchEditor
                  value={value}
                  vocabulary={vocabulary(section)}
                  disabled={disabled}
                  onChange={(next) => onChange(section, next)}
                />
              )}
            </section>
          ))}
        </div>
      </WorkbenchThemeProvider>
    </WorkbenchHostProvider>
  );
}

/** The toolbar's Filter control: a button and the popover it opens. */
export function FilterButton({ view }: { view: QueryView }) {
  const file = useStore(view.state, (s) => s.file);
  const shown = useStore(view.state, (s) => s.view);
  const filterIssue = useStore(view.state, (s) => s.filterIssue);
  const [values, setValues] = useState<FilterValues>(NO_VALUES);
  if (!file || !shown) return null;
  return (
    <ToolbarPopover
      icon="list-filter"
      label={m.query_view_filter()}
      active={file.filters !== undefined || shown.filters !== undefined}
      hook="filter"
      className="zt:w-[min(40rem,calc(100vw_-_2rem))] zt:max-w-none zt:p-3"
      onOpen={() => {
        view.filterValues().then(setValues, (error: unknown) => {
          logger.warn("The filter values could not be read", { error });
        });
      }}
    >
      <FilterEditor
        dataset={shown.from ?? "annotations"}
        allViewsDataset={allViewsDataset(file)}
        allViews={file.filters}
        thisView={shown.filters}
        values={values}
        issue={filterIssue}
        disabled={!view.writable}
        onChange={(section, next) => view.setFilters(section, next)}
      />
    </ToolbarPopover>
  );
}
