// The Sort control: the sort properties of a view, the first one first. The
// researcher adds a property, sets its direction, drags it to set its
// priority, and removes it. It is host-neutral: it reads the sort and reports
// the next one, and the host saves it.
import { Dropdown, DropdownItem } from "@/components/obsidian/dropdown";
import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { cn } from "@/lib/utils";

import { directionLabel } from "./properties";
import type { PropertyOption } from "./properties";
import type { QueryFileDirection, QueryFileSort } from "./query-file";
import { GripIcon, moved, useReorder } from "./reorder";

export interface SortEditorProps {
  value: readonly QueryFileSort[];
  /** The properties ZotLit Query can sort the view's dataset by. */
  options: readonly PropertyOption[];
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
    }
  );
}

export function SortEditor({ value, options, onChange }: SortEditorProps) {
  const reorder = useReorder(value.length, (from, to) =>
    onChange(moved(value, from, to)),
  );
  const unused = options.filter(
    (option) => !value.some((sort) => sort.property === option.path),
  );
  const set = (index: number, sort: QueryFileSort) =>
    onChange(value.map((entry, at) => (at === index ? sort : entry)));
  return (
    <div className="zt:flex zt:flex-col zt:gap-1" data-sort-editor="">
      <div className="zt:px-1 zt:text-xs zt:font-semibold zt:text-(--text-muted)">
        {m.query_view_sort_by()}
      </div>
      {value.map((sort, index) => {
        const option = optionOf(options, sort.property);
        const { row, handle } = reorder(index);
        return (
          <div
            key={sort.property}
            data-sort-row={sort.property}
            {...row}
            className={cn(
              "zt:rounded zt:flex zt:items-center zt:gap-1 zt:px-1",
              row.className,
            )}
          >
            <span {...handle}>
              <GripIcon />
            </span>
            <Dropdown
              aria-label={m.query_view_sort_by()}
              data-sort-property=""
              className="zt:min-w-0 zt:flex-1"
              value={sort.property}
              onChange={(property) => set(index, { ...sort, property })}
            >
              {[option, ...unused].map((candidate) => (
                <DropdownItem key={candidate.path} value={candidate.path}>
                  {candidate.label}
                </DropdownItem>
              ))}
            </Dropdown>
            <Dropdown
              aria-label={option.label}
              data-sort-direction=""
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
            <button
              type="button"
              className="clickable-icon"
              aria-label={m.query_view_sort_remove()}
              data-sort-remove=""
              onClick={() => onChange(value.filter((_, at) => at !== index))}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        );
      })}
      {unused.length > 0 && (
        <button
          type="button"
          className="clickable-icon zt:flex zt:items-center zt:gap-1 zt:self-start"
          data-sort-add=""
          onClick={() =>
            onChange([
              ...value,
              { property: unused[0]!.path, direction: "ASC" },
            ])
          }
        >
          <Icon name="plus" size={14} />
          <span>{m.query_view_sort_add()}</span>
        </button>
      )}
    </div>
  );
}
