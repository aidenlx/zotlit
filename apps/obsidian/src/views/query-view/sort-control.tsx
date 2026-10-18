// The Sort control: the sort properties of a view, the first one first. The
// researcher adds a property, sets its direction, drags it to set its
// priority, and removes it. It is host-neutral: it reads the sort and reports
// the next one, and the host saves it.
//
// It lays out as the Bases Sort menu: a "Sort by" section of rows, each a
// drag handle, one joined [property | direction] box and a delete button,
// then an "Add sort" footer. The Group control reuses the row parts.
import type { ReactNode } from "react";

import { Dropdown, DropdownItem } from "@/components/obsidian/dropdown";
import { Icon } from "@/components/obsidian/icon";
import { Select } from "@/components/select";
import type { SelectOption } from "@/components/select";
import * as m from "@/lib/i18n/generated/messages";
import { cn } from "@/lib/utils";

import { directionLabel } from "./properties";
import type { PropertyOption } from "./properties";
import type { QueryFileDirection, QueryFileSort } from "./query-file";
import { GripIcon, moved, useReorder } from "./reorder";
import {
  PopoverAction,
  PopoverActions,
  PopoverHeader,
  PopoverSection,
} from "./toolbar-popover";

export interface SortEditorProps {
  value: readonly QueryFileSort[];
  /** The properties ZotLit Query can sort the view's dataset by. */
  options: readonly PropertyOption[];
  /** The sort properties the view's dataset lacks, which the view does not use. */
  unused?: readonly string[];
  onChange: (next: QueryFileSort[]) => void;
}

/** A property the file names that the options do not, shown by its path. */
function optionOf(
  options: readonly PropertyOption[],
  path: string,
): PropertyOption {
  return (
    options.find((option) => option.path === path) ?? {
      path,
      label: path,
      kind: "text",
      icon: "file-question",
    }
  );
}

/**
 * A property as the property select offers it: its type icon before its
 * name, and its path after it where the name is not the path, as the Bases
 * property picker shows a property's id.
 */
export function propertySelectOption(option: PropertyOption): SelectOption {
  return {
    value: option.path,
    label: option.label,
    icon: <Icon name={option.icon} />,
    detail: option.path,
  };
}

/**
 * The rows of a Sort or Group section, spaced as the Bases menu spaces its
 * sort rows.
 */
export const sortRowsClass =
  "zt:flex zt:flex-col zt:gap-(--size-2-3) zt:px-(--size-4-1) zt:pt-(--size-4-1) zt:pb-(--size-4-2)";

/** One row: handle, joined selects, delete button and marks. */
export const sortRowClass = "zt:flex zt:items-center zt:gap-(--size-4-1)";

/**
 * A property select and its direction select, joined in one box as Bases
 * joins them. The selects stay bare: the box sets the input variables they
 * read (no radius, no shadow, the form-field fill), draws the ring, and
 * takes the focus ring for the select inside it.
 */
export function JoinedSelects({
  property,
  direction,
}: {
  property: ReactNode;
  direction: ReactNode;
}) {
  return (
    <div
      data-joined-selects=""
      className={cn(
        "zt:flex zt:min-w-0 zt:flex-1 zt:items-stretch zt:overflow-hidden",
        "zt:rounded-(--metadata-property-radius) zt:[corner-shape:var(--metadata-property-corner-shape)]",
        "zt:shadow-(--metadata-property-box-shadow-hover) zt:focus-within:shadow-(--metadata-property-box-shadow-focus)",
        "zt:[--dropdown-background:var(--background-modifier-form-field)] zt:[--input-radius:0] zt:[--input-shadow-hover:none] zt:[--input-shadow:none]",
      )}
    >
      {property}
      <span
        aria-hidden="true"
        className="zt:w-(--border-width) zt:shrink-0 zt:bg-border"
      />
      {direction}
    </div>
  );
}

/** The delete button at the end of a row: a trash icon, as in Bases. */
export function RemoveButton({
  label,
  disabled,
  onClick,
  ...data
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  [data: `data-${string}`]: string | undefined;
}) {
  return (
    <button
      type="button"
      className="clickable-icon zt:shrink-0"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      {...data}
    >
      <Icon
        name="trash-2"
        size="var(--icon-s)"
        strokeWidth="var(--icon-s-stroke-width)"
      />
    </button>
  );
}

/** The mark of a setting the view keeps but does not use. */
export function NotUsed() {
  return (
    <span className="zt:shrink-0 zt:text-xs zt:text-(--text-faint)">
      {m.query_view_not_used()}
    </span>
  );
}

export function SortEditor({
  value,
  options,
  unused: notUsed = [],
  onChange,
}: SortEditorProps) {
  const reorder = useReorder(value.length, (from, to) =>
    onChange(moved(value, from, to)),
  );
  const unused = options.filter(
    (option) => !value.some((sort) => sort.property === option.path),
  );
  const set = (index: number, sort: QueryFileSort) =>
    onChange(value.map((entry, at) => (at === index ? sort : entry)));
  return (
    <>
      <PopoverSection data-sort-editor="">
        <PopoverHeader>{m.query_view_sort_by()}</PopoverHeader>
        {value.length > 0 && (
          <div className={sortRowsClass}>
            {value.map((sort, index) => {
              const option = optionOf(options, sort.property);
              const { row, handle } = reorder(index);
              return (
                <div
                  key={sort.property}
                  data-sort-row={sort.property}
                  data-sort-unused={
                    notUsed.includes(sort.property) ? "" : undefined
                  }
                  {...row}
                  className={cn(sortRowClass, row.className)}
                >
                  <span {...handle}>
                    <GripIcon />
                  </span>
                  <JoinedSelects
                    property={
                      <Select
                        aria-label={m.query_view_sort_by()}
                        data-sort-property=""
                        className="zt:min-w-0 zt:flex-1"
                        value={sort.property}
                        options={[option, ...unused].map(propertySelectOption)}
                        onChange={(property) =>
                          set(index, { ...sort, property })
                        }
                      />
                    }
                    direction={
                      <Dropdown
                        aria-label={option.label}
                        data-sort-direction=""
                        className="zt:shrink-0"
                        value={sort.direction}
                        onChange={(direction) =>
                          set(index, {
                            ...sort,
                            direction: direction as QueryFileDirection,
                          })
                        }
                      >
                        {(["ASC", "DESC"] as const).map((direction) => (
                          <DropdownItem key={direction} value={direction}>
                            {directionLabel(option.kind, direction)}
                          </DropdownItem>
                        ))}
                      </Dropdown>
                    }
                  />
                  {notUsed.includes(sort.property) && <NotUsed />}
                  <RemoveButton
                    label={m.query_view_sort_remove()}
                    data-sort-remove=""
                    onClick={() =>
                      onChange(value.filter((_, at) => at !== index))
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </PopoverSection>
      {unused.length > 0 && (
        <PopoverActions>
          <PopoverAction
            icon="plus"
            data-sort-add=""
            onClick={() =>
              onChange([
                ...value,
                { property: unused[0]!.path, direction: "ASC" },
              ])
            }
          >
            {m.query_view_sort_add()}
          </PopoverAction>
        </PopoverActions>
      )}
    </>
  );
}
