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

import { foldFilterTree } from "@zotlit/filter-expression";
import type { MatchTree } from "@zotlit/templates/facade";
import {
  MatchEditor,
  WorkbenchHostProvider,
  WorkbenchThemeProvider,
  filterVocabulary,
} from "@zotlit/workbench/ui";
import type {
  FilterField,
  FilterValues,
  MatchFilter,
} from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon";
import { useObsidianApp } from "@/lib/app-context";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { cn } from "@/lib/utils";
import { createTemplateWorkbenchHost } from "@/views/template-workbench/host";
import { matchTheme } from "@/views/template-workbench/match-pane";
import { matchRows } from "@/views/template-workbench/theme";

import { propertyIcon } from "./property-icon";
import { allViewsDataset, vaultProperty } from "./query-file";
import type {
  ConditionIssue,
  FilterSection,
  QueryFileDataset,
} from "./query-file";
import type { LiteratureNotes, VaultPropertyType } from "./table-notes";
import { toolbarButtonLook } from "./toolbar-button";
import {
  PopoverHeader,
  PopoverSection,
  ToolbarPopover,
} from "./toolbar-popover";
import { useVaultPropertyNames, useVaultVersion } from "./vault-cell";
import type { QueryView } from "./view";
import { useViewProperties } from "./view-properties";
import type { ViewProperties } from "./view-properties";

const logger = getLogger(["views", "query-view", "filter"]);

export type { FilterValues };

const NO_VALUES: FilterValues = { tags: [], collections: [], libraries: [] };

/** The issue of one condition, as the Query View last found it. */
export type FilterIssue = ConditionIssue | null;

/** How a condition tests a vault property of each type. */
const VAULT_FIELD_TYPES: Record<VaultPropertyType, FilterField["type"]> = {
  text: "text",
  multitext: "list",
  number: "number",
  checkbox: "boolean",
  // A date, or a date and time, compares as the text the frontmatter holds.
  date: "text",
  datetime: "text",
};

/** The kind of the condition on the vault property at `path`. */
const VAULT_KIND_PREFIX = "custom:";

/**
 * The conditions on the vault properties `names`. Each reads its property by
 * bracket access, `vault["reading-status"]`, which a name with a hyphen needs.
 */
export function vaultFilterFields(
  names: readonly string[],
  notes: Pick<LiteratureNotes, "propertyType">,
  properties: ViewProperties | null,
): FilterField[] {
  return names.map((name) => {
    const property = vaultProperty(name);
    return {
      kind: `${VAULT_KIND_PREFIX}${property}`,
      path: `vault[${JSON.stringify(name)}]`,
      type: VAULT_FIELD_TYPES[notes.propertyType(name)],
      label: properties?.entry(property).displayName ?? name,
    };
  });
}

function samePath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, at) => value === b[at]);
}

/**
 * The Match editor as the Bases filter menu draws it: the form field
 * background for a condition's fields, the
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
        "zt:flex zt:min-w-0 zt:items-start zt:overflow-hidden zt:rounded-(--metadata-property-radius) zt:bg-input zt:[corner-shape:var(--metadata-property-corner-shape)]",
        "zt:shadow-[0_0_0_var(--border-width)_var(--background-modifier-border-hover)] zt:focus-within:shadow-(--metadata-property-box-shadow-focus) zt:data-[state=error]:shadow-[0_0_0_var(--border-width)_var(--background-modifier-error)] zt:[&:has([aria-invalid=true])]:shadow-[0_0_0_var(--border-width)_var(--background-modifier-error)]",
        "zt:[--dropdown-background-hover:var(--background-modifier-form-field-hover)] zt:[--dropdown-background:var(--background-modifier-form-field)] zt:[--input-border-width-focus:0px] zt:[--input-border-width:0px] zt:[--input-radius:0px] zt:[--input-shadow:none]",
        "zt:[&_[data-part=wrapper]>select]:[field-sizing:content] zt:[&_[data-part=wrapper]>select]:w-full",
        "zt:[&>[data-part=actions]]:h-(--input-height) zt:[&>[data-part=actions]]:shrink-0 zt:[&>[data-part=actions]]:flex-nowrap zt:[&>[data-part=actions]]:px-(--size-2-1)",
      ),
      // A condition keeps one line, as in Bases, at any depth: a nested
      // group is narrower, so the property select gives up width first and
      // the value keeps room for a few characters.
      fields:
        "zt:flex zt:min-w-0 zt:flex-1 zt:flex-nowrap zt:items-stretch zt:overflow-hidden",
      value: cn(matchTheme.classes.match?.value, "zt:min-w-[8ch]"),
      // The property select carries the icon of the property's type, as the
      // Bases property picker does, and is capped as Bases caps it.
      predicate: cn(
        "zt:[&>[data-part=wrapper]:not(:first-of-type)]:shrink-0",
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
  /** The conditions on vault properties, which a section of Items offers. */
  vaultFields?: readonly FilterField[];
  /** The type of the vault property `name`, for the icon of its condition. */
  vaultType?: (name: string) => VaultPropertyType;
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
  vaultFields = [],
  vaultType,
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
        // The Filter offers its own values and tests no Item.
        matches: async () => ({ kind: "missing" }),
      },
      insertTarget: () => null,
    });
    // The popover sits in the top layer, over Obsidian's suggestion popups.
    return { ...created, inputSuggestions: undefined };
  }, [app]);
  useEffect(() => () => host[Symbol.dispose](), [host]);
  const vocabulary = (section: FilterSection) => {
    const of = section === "all" ? shared : dataset;
    return filterVocabulary(of, {
      m: host.messages,
      values,
      issue: (_, path) =>
        issue && issue.section === section && samePath(issue.path, path)
          ? issue.message
          : null,
      // A condition shows the Display Name of its field in the view's
      // Properties, and the icon the view's property list shows.
      label: (field) =>
        field.label ?? properties?.entry(field.path).displayName,
      icon: (field) => (
        <Icon
          name={propertyIcon(
            of,
            field.kind.startsWith(VAULT_KIND_PREFIX)
              ? {
                  path: field.kind.slice(VAULT_KIND_PREFIX.length),
                  kind: "vault",
                }
              : { path: field.path, kind: "field" },
            vaultType,
          )}
        />
      ),
      extra: of === "items" ? vaultFields : [],
    });
  };
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
  return tree === undefined
    ? 0
    : foldFilterTree(tree, {
        leaf: () => 1,
        group: (_, counts) => counts.reduce((sum, count) => sum + count, 0),
      });
}

/** The toolbar's Filter control: a button and the popover it opens. */
export function FilterButton({ view }: { view: QueryView }) {
  const file = useStore(view.state, (s) => s.file);
  const shown = useStore(view.state, (s) => s.view);
  const filterIssue = useStore(
    view.state,
    (s) => s.failure?.filterIssue ?? null,
  );
  const { literatureNotes } = view.tableDeps;
  const names = useVaultPropertyNames(literatureNotes);
  const properties = useViewProperties(view, names);
  // A change of a property's type changes no name, so it is read apart.
  const vaultVersion = useVaultVersion(literatureNotes);
  const vaultFields = useMemo(
    () => vaultFilterFields(names, literatureNotes, properties),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `vaultVersion` reads the types again
    [names, literatureNotes, properties, vaultVersion],
  );
  const [values, setValues] = useState<FilterValues>(NO_VALUES);
  if (!file || !shown) return null;
  return (
    <ToolbarPopover
      icon="list-filter"
      label={m.query_view_filter()}
      active={file.filters !== undefined || shown.filters !== undefined}
      count={conditionCount(file.filters) + conditionCount(shown.filters)}
      hook="filter"
      className="zt:w-[min(--spacing(130),calc(100vw_-_var(--size-4-8)))] zt:max-w-none"
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
        vaultFields={vaultFields}
        vaultType={(name) => literatureNotes.propertyType(name)}
        onChange={(section, next) => view.document.setFilters(section, next)}
      />
    </ToolbarPopover>
  );
}
