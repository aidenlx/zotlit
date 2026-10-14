// The Group control: the one property a view groups its rows by, the order of
// the groups, and, in a Manual group order, which groups show and where. It
// is host-neutral: it reads the grouping and the groups the rows hold, and
// reports the next grouping; the host saves it.
import { Dropdown, DropdownItem } from "@/components/obsidian/dropdown";
import * as m from "@/lib/i18n/generated/messages";
import { cn } from "@/lib/utils";

import type { PropertyOption } from "./properties";
import type { QueryFileGroupValue, QueryFileSort } from "./query-file";
import { GripIcon, moved, useReorder } from "./reorder";
import type { LayoutGroup } from "./rows";
import { NotUsed } from "./sort-control";

/** A view's grouping, as the Group control reads and writes it. */
export interface GroupSetting {
  groupBy?: QueryFileSort;
  groupOrder?: readonly QueryFileGroupValue[];
}

export interface GroupEditorProps {
  value: GroupSetting;
  /** The properties the layout can group by. */
  options: readonly PropertyOption[];
  /** The groups the view's rows hold now, the shown ones first. */
  groups: readonly LayoutGroup[];
  /** Whether the view's dataset lacks the group property, so the view does not use it. */
  unused?: boolean;
  onChange: (next: GroupSetting) => void;
}

const NONE = "";
const MANUAL = "MANUAL";

export function GroupEditor({
  value,
  options,
  groups,
  unused = false,
  onChange,
}: GroupEditorProps) {
  const { groupBy, groupOrder } = value;
  const manual = groupOrder !== undefined;
  const known = options.some((option) => option.path === groupBy?.property);
  return (
    <div className="zt:flex zt:flex-col zt:gap-1" data-group-editor="">
      <div className="zt:px-1 zt:text-xs zt:font-semibold zt:text-(--text-muted)">
        {m.query_view_group_by()}
      </div>
      <div className="zt:flex zt:items-center zt:gap-1 zt:px-1">
        <Dropdown
          aria-label={m.query_view_group_by()}
          data-group-property=""
          className="zt:min-w-0 zt:flex-1"
          value={groupBy?.property ?? NONE}
          onChange={(property) =>
            onChange(
              property === NONE
                ? {}
                : {
                    groupBy: {
                      property,
                      direction: groupBy?.direction ?? "ASC",
                    },
                  },
            )
          }
        >
          <DropdownItem value={NONE}>
            {m.query_view_group_by_none()}
          </DropdownItem>
          {!known && groupBy && (
            <DropdownItem value={groupBy.property}>
              {groupBy.property}
            </DropdownItem>
          )}
          {options.map((option) => (
            <DropdownItem key={option.path} value={option.path}>
              {option.label}
            </DropdownItem>
          ))}
        </Dropdown>
        {unused && (
          <span data-group-unused="">
            <NotUsed />
          </span>
        )}
        {groupBy && (
          <Dropdown
            aria-label={m.query_view_group()}
            data-group-direction=""
            value={manual ? MANUAL : groupBy.direction}
            onChange={(direction) =>
              onChange(
                direction === MANUAL
                  ? {
                      groupBy,
                      groupOrder: groups.map((group) => group.value),
                    }
                  : {
                      groupBy: {
                        ...groupBy,
                        direction: direction === "DESC" ? "DESC" : "ASC",
                      },
                    },
              )
            }
          >
            <DropdownItem value="ASC">
              {m.query_view_group_ascending()}
            </DropdownItem>
            <DropdownItem value="DESC">
              {m.query_view_group_descending()}
            </DropdownItem>
            <DropdownItem value={MANUAL}>
              {m.query_view_group_manual()}
            </DropdownItem>
          </Dropdown>
        )}
      </div>
      {groupBy && groupOrder && (
        <ManualOrder
          groups={groups}
          order={groupOrder}
          onChange={(next) => onChange({ groupBy, groupOrder: next })}
        />
      )}
    </div>
  );
}

/**
 * The groups of a Manual group order: a tick shows or hides each, and drag
 * sets its place. A value of the order that no row holds now keeps its entry
 * after the ones listed, so a group that comes back takes its place again.
 */
function ManualOrder({
  groups,
  order,
  onChange,
}: {
  groups: readonly LayoutGroup[];
  order: readonly QueryFileGroupValue[];
  onChange: (next: QueryFileGroupValue[]) => void;
}) {
  const unlisted = order.filter(
    (value) => !groups.some((group) => group.value === value),
  );
  const save = (
    rows: readonly { value: QueryFileGroupValue; shown: boolean }[],
  ) =>
    onChange([
      ...rows.filter((row) => row.shown).map((row) => row.value),
      ...unlisted,
    ]);
  const reorder = useReorder(groups.length, (from, to) =>
    save(moved(groups, from, to)),
  );
  if (groups.length === 0)
    return (
      <div className="zt:px-1 zt:text-sm zt:text-(--text-muted)">
        {m.query_view_group_empty()}
      </div>
    );
  const anyShown = groups.some((group) => group.shown);
  return (
    <div className="zt:flex zt:flex-col" data-group-order="">
      {groups.map((group, index) => {
        const { row, handle } = reorder(index);
        return (
          <label
            key={group.value ?? ""}
            data-group-row={group.value ?? ""}
            {...row}
            className={cn(
              "zt:rounded zt:flex zt:items-center zt:gap-2 zt:px-1 zt:py-0.5 zt:text-sm",
              row.className,
            )}
          >
            <span {...handle}>
              <GripIcon />
            </span>
            <input
              type="checkbox"
              className="task-list-item-checkbox"
              checked={group.shown}
              onChange={() =>
                save(
                  groups.map((candidate) =>
                    candidate === group
                      ? { ...candidate, shown: !candidate.shown }
                      : candidate,
                  ),
                )
              }
            />
            <span className="zt:min-w-0 zt:flex-1 zt:truncate">
              {group.label}
            </span>
            <span
              className="zt:text-(--text-faint) zt:tabular-nums"
              data-group-count=""
            >
              {group.count}
            </span>
          </label>
        );
      })}
      <button
        type="button"
        className="clickable-icon zt:self-start"
        data-group-toggle-all=""
        onClick={() =>
          save(groups.map((group) => ({ ...group, shown: !anyShown })))
        }
      >
        {anyShown
          ? m.query_view_group_hide_all()
          : m.query_view_group_show_all()}
      </button>
    </div>
  );
}
