// The Group control: the one property a view groups its rows by, the order of
// the groups, and, in a Manual group order, which groups show and where. It
// is host-neutral: it reads the grouping and the groups the rows hold, and
// reports the next grouping; the host saves it.
//
// It lays out as the Bases Group menu: a "Group by" section with one joined
// [property | direction] box and a delete button. A Manual group order adds
// a section of group rows and a "Show all" / "Hide all" footer.
import { Dropdown, DropdownItem } from "@/components/obsidian/dropdown";
import * as m from "@/lib/i18n/generated/messages";
import { cn } from "@/lib/utils";

import { directionLabel } from "./properties";
import type { PropertyOption } from "./properties";
import type { QueryFileGroupValue, QueryFileSort } from "./query-file";
import { GripIcon, moved, useReorder } from "./reorder";
import type { LayoutGroup } from "./rows";
import {
  JoinedSelects,
  NotUsed,
  RemoveButton,
  sortRowClass,
  sortRowsClass,
} from "./sort-control";
import {
  PopoverAction,
  PopoverActions,
  PopoverHeader,
  PopoverSection,
} from "./toolbar-popover";
import "./group-control.css";

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
  const option = options.find((entry) => entry.path === groupBy?.property);
  return (
    <>
      <PopoverSection data-group-editor="">
        <PopoverHeader>{m.query_view_group_by()}</PopoverHeader>
        <div className={cn(sortRowsClass, "zt:ps-(--size-2-3)")}>
          <div className={sortRowClass}>
            <JoinedSelects
              property={
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
                  {!option && groupBy && (
                    <DropdownItem value={groupBy.property}>
                      {groupBy.property}
                    </DropdownItem>
                  )}
                  {options.map((candidate) => (
                    <DropdownItem key={candidate.path} value={candidate.path}>
                      {candidate.label}
                    </DropdownItem>
                  ))}
                </Dropdown>
              }
              direction={
                <Dropdown
                  aria-label={m.query_view_group()}
                  data-group-direction=""
                  className="zt:shrink-0"
                  disabled={!groupBy}
                  value={manual ? MANUAL : (groupBy?.direction ?? "ASC")}
                  onChange={(direction) => {
                    if (!groupBy) return;
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
                    );
                  }}
                >
                  {(["ASC", "DESC"] as const).map((direction) => (
                    <DropdownItem key={direction} value={direction}>
                      {directionLabel(option?.kind ?? "text", direction)}
                    </DropdownItem>
                  ))}
                  <DropdownItem value={MANUAL}>
                    {m.query_view_group_manual()}
                  </DropdownItem>
                </Dropdown>
              }
            />
            {unused && (
              <span data-group-unused="">
                <NotUsed />
              </span>
            )}
            <RemoveButton
              label={m.query_view_group_remove()}
              data-group-remove=""
              disabled={!groupBy}
              onClick={() => onChange({})}
            />
          </div>
        </div>
      </PopoverSection>
      {groupBy && groupOrder && (
        <ManualOrder
          groups={groups}
          order={groupOrder}
          onChange={(next) => onChange({ groupBy, groupOrder: next })}
        />
      )}
    </>
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
      <PopoverSection data-group-order="">
        <div className="zt:px-(--size-4-3) zt:py-(--size-4-2) zt:text-sm zt:text-muted-foreground">
          {m.query_view_group_empty()}
        </div>
      </PopoverSection>
    );
  const anyShown = groups.some((group) => group.shown);
  return (
    <>
      <PopoverSection data-group-order="">
        {groups.map((group, index) => {
          const { row, handle } = reorder(index);
          return (
            <label
              key={group.value ?? ""}
              data-group-row={group.value ?? ""}
              {...row}
              className={cn(
                "zt:flex zt:items-center zt:gap-(--size-4-2) zt:rounded-sm zt:p-(--size-2-2) zt:ps-(--size-2-3) zt:text-sm zt:text-foreground zt:[corner-shape:var(--corner-shape)] zt:hover:bg-muted",
                row.className,
              )}
            >
              <span {...handle}>
                <GripIcon />
              </span>
              <input
                type="checkbox"
                className="zt:shrink-0"
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
                className="zt:pe-(--size-2-2) zt:text-xs zt:text-(--text-faint) zt:tabular-nums"
                data-group-count=""
              >
                {group.count}
              </span>
            </label>
          );
        })}
      </PopoverSection>
      <PopoverActions>
        <PopoverAction
          icon={anyShown ? "eye-off" : "eye"}
          data-group-toggle-all=""
          onClick={() =>
            save(groups.map((group) => ({ ...group, shown: !anyShown })))
          }
        >
          {anyShown
            ? m.query_view_group_hide_all()
            : m.query_view_group_show_all()}
        </PopoverAction>
      </PopoverActions>
    </>
  );
}
