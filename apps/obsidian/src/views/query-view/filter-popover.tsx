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
import type { ReactNode } from "react";
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

import { Icon } from "@/components/obsidian/icon";
import { useObsidianApp } from "@/lib/app-context";
import * as m from "@/lib/i18n/generated/messages";
import { runtime } from "@/lib/i18n/generated/runtime";
import { getLogger } from "@/lib/log";
import { cn } from "@/lib/utils";
import { createTemplateWorkbenchHost } from "@/views/template-workbench/host";
import { matchTheme } from "@/views/template-workbench/match-pane";
import { matchRows } from "@/views/template-workbench/theme";

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
import { propertyIcon } from "./property-icon";
import { allViewsDataset } from "./query-file";
import type {
  ConditionIssue,
  FilterSection,
  QueryFileDataset,
} from "./query-file";
import { toolbarButtonLook } from "./toolbar-button";
import {
  PopoverHeader,
  PopoverSection,
  ToolbarPopover,
} from "./toolbar-popover";
import type { QueryView } from "./view";
import { useViewProperties } from "./view-properties";
import type { ViewProperties } from "./view-properties";

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

/**
 * The conditions of one dataset, as the Match editor offers them. A
 * condition shows the Display Name of its field in `properties`, else the
 * name of its kind.
 */
export function filterVocabulary(
  dataset: QueryFileDataset,
  {
    values,
    issue,
    properties,
  }: {
    values: FilterValues;
    issue: (
      condition: RowCondition<FilterRow>,
      path: readonly number[],
    ) => string | null;
    properties: Pick<ViewProperties, "entry"> | null;
  },
): MatchVocabulary<FilterRow> {
  const fields = filterFields(dataset);
  const kinds = fields.map(
    (field): MatchConditionKind<FilterRow> => ({
      kind: field.kind,
      label:
        properties?.entry(field.path).displayName ?? KIND_LABELS[field.kind](),
      icon: (
        <Icon
          name={propertyIcon(dataset, { path: field.path, formula: null })}
        />
      ),
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
  return { kinds, newKind: first, issue };
}

/**
 * The Match editor as the Bases filter menu draws it, from the variables that
 * menu reads: `--bases-filter-input-background` for a condition's fields, the
 * table border on a nested group, a borderless conjunction select, and text
 * actions in the toolbar button's `.text-icon-button` look. The Template
 * Workbench keeps `matchTheme`.
 */
const filterRows = matchRows({ look: "filter" });
const filterTheme = {
  ...matchTheme,
  classes: {
    ...matchTheme.classes,
    match: {
      ...matchTheme.classes.match,
      // A condition's actions are bare `<button>`s in the popover, rolled
      // back as its action rows are (see `toolbar-button.css`).
      button: cn("zt-query-popover-action", toolbarButtonLook),
      "remove-button": cn("zt-query-popover-action", toolbarButtonLook),
      fieldset: cn(
        "zt:m-0 zt:flex zt:min-w-0 zt:flex-col zt:border-0 zt:p-0 zt:text-sm",
        "zt:[--icon-size:var(--icon-s)] zt:[--icon-stroke:var(--icon-s-stroke-width)]",
      ),
      group: cn(
        "zt:flex zt:w-full zt:min-w-0 zt:flex-col zt:gap-(--size-2-3)",
        "zt:data-[state=nested]:rounded-md zt:data-[state=nested]:border-(length:--table-border-width) zt:data-[state=nested]:border-(--table-border-color) zt:data-[state=nested]:bg-(--background-primary-alt) zt:data-[state=nested]:p-(--size-2-3)",
        filterRows.group(),
      ),
      // The header holds the conjunction, a select drawn without its box, as
      // Bases draws it; the footer holds the text actions.
      actions: cn(
        "zt:flex zt:flex-wrap zt:items-center",
        "zt:data-[state=header]:justify-between zt:data-[state=header]:gap-(--size-2-1) zt:data-[state=header]:pb-(--size-2-1)",
        "zt:data-[state=header]:[--dropdown-background-hover:var(--background-modifier-hover)] zt:data-[state=header]:[--dropdown-background:transparent] zt:data-[state=header]:[--input-shadow:none]",
        "zt:data-[state=footer]:pt-(--size-2-2)",
      ),
      rows: "zt:m-0 zt:flex zt:list-none zt:flex-col zt:gap-(--size-2-3) zt:p-0",
      row: filterRows.row(),
      handle: filterRows.handle(),
      conjunction:
        "zt:flex zt:min-h-(--input-height) zt:items-center zt:justify-end zt:text-end zt:text-sm zt:[overflow-wrap:anywhere]",
      statement: cn(
        "zt:flex zt:min-w-0 zt:items-start zt:overflow-hidden zt:rounded-(--metadata-property-radius) zt:bg-(--bases-filter-input-background) zt:[corner-shape:var(--metadata-property-corner-shape)]",
        "zt:shadow-[0_0_0_var(--border-width)_var(--background-modifier-border-hover)] zt:focus-within:shadow-(--metadata-property-box-shadow-focus) zt:data-[state=error]:shadow-[0_0_0_var(--border-width)_var(--background-modifier-error)] zt:[&:has([aria-invalid=true])]:shadow-[0_0_0_var(--border-width)_var(--background-modifier-error)]",
        "zt:[--background-modifier-form-field:var(--bases-filter-input-background)] zt:[--dropdown-background-hover:var(--background-modifier-form-field-hover)] zt:[--dropdown-background:var(--bases-filter-input-background)] zt:[--input-border-width-focus:0px] zt:[--input-border-width:0px] zt:[--input-radius:0px] zt:[--input-shadow:none]",
        "zt:[&_[data-part=wrapper]>select]:[field-sizing:content] zt:[&_[data-part=wrapper]>select]:w-full",
        "zt:[&>[data-part=actions]]:h-(--input-height) zt:[&>[data-part=actions]]:shrink-0 zt:[&>[data-part=actions]]:flex-nowrap zt:[&>[data-part=actions]]:px-(--size-2-1)",
      ),
      // The property select carries the icon of the property's type, as the
      // Bases property picker does, and is capped as Bases caps it.
      predicate: cn(
        "zt:flex zt:max-w-full zt:min-w-0 zt:[&>[data-part=wrapper]]:border-border zt:[&>[data-part=wrapper]+[data-part=wrapper]]:border-s-(length:--border-width)",
        "zt:[&>[data-part=wrapper]:first-of-type]:max-w-[14em]",
        // The icon takes the select's start padding, so the name follows it
        // at the gap Bases leaves.
        "zt:data-[state=icon]:[&>[data-part=wrapper]:first-of-type]:[--dropdown-padding:0_var(--dropdown-padding-end)_0_var(--size-4-2)] zt:[.mod-rtl_&]:data-[state=icon]:[&>[data-part=wrapper]:first-of-type]:[--dropdown-padding:0_var(--size-4-2)_0_var(--dropdown-padding-end)]",
      ),
      "kind-icon":
        "zt:flex zt:shrink-0 zt:items-center zt:self-stretch zt:ps-(--size-4-2) zt:text-(--icon-color)",
      error:
        "zt:pt-(--size-4-1) zt:text-xs zt:leading-normal zt:text-pretty zt:text-(--text-error)",
    },
  },
};

export interface FilterEditorProps {
  /** The dataset of the view whose filters show. */
  dataset: QueryFileDataset;
  /** The dataset the filters for all views are written for. */
  allViewsDataset: QueryFileDataset;
  allViews: MatchFilter | undefined;
  thisView: MatchFilter | undefined;
  values: FilterValues;
  issue: FilterIssue;
  /** The Properties of the view, whose Display Names name the conditions. */
  properties: ViewProperties | null;
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
  properties,
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
    filterVocabulary(section === "all" ? shared : dataset, {
      values,
      issue: (_, path) =>
        issue && issue.section === section && samePath(issue.path, path)
          ? issue.message
          : null,
      properties,
    });
  const sections = (
    [
      ["all", m.query_view_filter_all_views(), allViews],
      ["view", m.query_view_filter_this_view(), thisView],
    ] satisfies [FilterSection, string, MatchFilter | undefined][]
  ).filter(([section]) => shown.includes(section));
  const body = (section: FilterSection, value: MatchFilter | undefined) =>
    section === "all" && shared !== dataset ? (
      <p className="zt:m-0 zt:text-sm zt:text-muted-foreground">
        {m.query_view_filter_other_dataset()}
      </p>
    ) : (
      <MatchEditor
        value={value}
        vocabulary={vocabulary(section)}
        onChange={(next) => onChange(section, next)}
      />
    );
  return (
    <WorkbenchHostProvider host={host}>
      <WorkbenchThemeProvider theme={filterTheme}>
        {sections.length > 1 ? (
          sections.map(([section, heading, value]) => (
            <FoldSection
              key={section}
              section={section}
              heading={heading}
              count={conditionCount(value)}
              // The filters for all views start folded while they hold none,
              // as in Bases. A section with conditions shows them, unlike
              // Bases, so every filter that narrows the results is in sight.
              initiallyOpen={section === "view" || value !== undefined}
            >
              {body(section, value)}
            </FoldSection>
          ))
        ) : (
          <div className="zt:flex zt:flex-col zt:gap-3">
            {sections.map(([section, , value]) => (
              <section key={section} data-filter-section={section}>
                {body(section, value)}
              </section>
            ))}
          </div>
        )}
      </WorkbenchThemeProvider>
    </WorkbenchHostProvider>
  );
}

/**
 * One section of the Filter popover, "All views" or "This view": a heading
 * that folds the section, as Bases folds them, and the count of its
 * conditions. A folded section keeps its editor mounted.
 */
function FoldSection({
  section,
  heading,
  count,
  initiallyOpen,
  children,
}: {
  section: FilterSection;
  heading: string;
  count: number;
  initiallyOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <PopoverSection data-filter-section={section}>
      <details
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        className="zt:group/fold"
      >
        <summary className="zt:cursor-(--cursor) zt:list-none zt:rounded-sm zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)] zt:focus-visible:outline-none zt:[&::-webkit-details-marker]:hidden">
          <PopoverHeader>
            <Icon
              name="right-triangle"
              size="var(--icon-xs)"
              strokeWidth="var(--icon-xs-stroke-width)"
              className="zt:shrink-0 zt:[rotate:calc(var(--direction)*-90deg)] zt:text-(--nav-collapse-icon-color) zt:transition-[rotate] zt:duration-100 zt:group-open/fold:[rotate:none]"
            />
            <span data-filter-heading="" className="zt:min-w-0 zt:truncate">
              {heading}
            </span>
            {count > 0 && (
              <span
                data-filter-count={count}
                className="zt:rounded-sm zt:bg-muted zt:px-(--size-2-2) zt:py-(--size-2-1) zt:text-xs zt:leading-none zt:text-muted-foreground zt:tabular-nums"
              >
                {count}
              </span>
            )}
          </PopoverHeader>
        </summary>
        <div className="zt:p-(--size-4-2)">{children}</div>
      </details>
    </PopoverSection>
  );
}

/** How many conditions a filter holds, groups not counted. */
function conditionCount(tree: MatchFilter | undefined): number {
  if (tree === undefined) return 0;
  if (typeof tree === "string") return 1;
  const children = "and" in tree ? tree.and : "or" in tree ? tree.or : tree.not;
  return children.reduce((sum, child) => sum + conditionCount(child), 0);
}

/** The toolbar's Filter control: a button and the popover it opens. */
export function FilterButton({ view }: { view: QueryView }) {
  const file = useStore(view.state, (s) => s.file);
  const shown = useStore(view.state, (s) => s.view);
  const filterIssue = useStore(
    view.state,
    (s) => s.failure?.filterIssue ?? null,
  );
  const properties = useViewProperties(view);
  const [values, setValues] = useState<FilterValues>(NO_VALUES);
  if (!file || !shown) return null;
  return (
    <ToolbarPopover
      icon="list-filter"
      label={m.query_view_filter()}
      active={file.filters !== undefined || shown.filters !== undefined}
      count={conditionCount(file.filters) + conditionCount(shown.filters)}
      hook="filter"
      className="zt:w-[min(var(--bases-filter-menu-width),calc(100vw_-_var(--size-4-8)))] zt:max-w-none"
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
        properties={properties}
        onChange={(section, next) => view.document.setFilters(section, next)}
      />
    </ToolbarPopover>
  );
}
