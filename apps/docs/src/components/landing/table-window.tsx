// The table demo's window and caption trail, drawn for one step of the demo
// (see ./table-demo). Steps: 0 the collection in the Library View; 1–3 Save
// as query file and its dialog; 4 the query file opens; 5–9 the table and
// its columns fill in; 10–11 the sort by year; 12–16 the rating column and
// the ratings typed in; 17 the finished frame.
// Inside the window, ZotLit's own labels (the plugin's `m.*` messages) and
// Obsidian's purple; around it, the site tokens.
// @see apps/docs/DESIGN.md → Landing (Compare your papers)

import {
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Clock,
  Ellipsis,
  File,
  FilePlus,
  FileText,
  Folder,
  Group,
  Hash,
  Library,
  List,
  ListFilter,
  Newspaper,
  PanelLeft,
  Search,
  Table,
  TextAlignStart,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Fragment } from "react";
import type { CSSProperties, RefObject } from "react";

import { cn } from "@/lib/cn";
import { m } from "@/paraglide/messages.js";

import {
  BY_YEAR,
  COLLECTION,
  COLLECTION_PAPERS,
  QUERY_FILE,
  QUERY_FOLDER,
  TAGS,
} from "./papers";
import type { Paper } from "./papers";

/** The finished frame: the prerendered page and reduced motion show it. */
export const FINAL = 17;

/** Obsidian's accent: only inside the enacted window. */
const PURPLE = "text-(--desk-purple)";
const TINT = "bg-[rgb(138_92_245/0.14)]";
const EASE = "cubic-bezier(.2,.75,.25,1)";

const BEATS = [
  m.docs_home_table_beat_collection,
  m.docs_home_table_beat_save,
  m.docs_home_table_beat_columns,
  m.docs_home_table_beat_sort,
  m.docs_home_table_beat_rating,
];
/** When each beat starts, in ms from the cycle start; the last entry ends the cycle. */
const BEAT_AT = [0, 2000, 5900, 9700, 12000, 19800];
const beatOf = (s: number) =>
  s >= 12 ? 4 : s >= 10 ? 3 : s >= 5 ? 2 : s >= 1 ? 1 : 0;
const two = (n: number) => String(n).padStart(2, "0");

/**
 * FLIP over every [data-flip] element in the stage. `snap` records where
 * things are (any running animation included); after React commits, `play`
 * cancels running animations, measures the new places, and animates each
 * element from old to new. A keyed element inside a keyed element animates
 * relative to it, so a cell is not moved twice with its row. An element new
 * to the stage with [data-enter] fades and rises in. Only transform and
 * opacity animate.
 */
export function makeFlip() {
  let prev: Map<string, DOMRect> | null = null;
  const snap = (root: HTMLElement | null) => {
    if (!root) return;
    const map = new Map<string, DOMRect>();
    for (const el of root.querySelectorAll<HTMLElement>("[data-flip]"))
      map.set(el.dataset["flip"]!, el.getBoundingClientRect());
    prev = map;
  };
  const play = (root: HTMLElement | null) => {
    const map = prev;
    prev = null;
    if (!root || !map) return;
    const els = [...root.querySelectorAll<HTMLElement>("[data-flip]")];
    for (const el of els) for (const a of el.getAnimations()) a.cancel();
    // Reads first: every element's new place.
    const delta = new Map<HTMLElement, { dx: number; dy: number }>();
    for (const el of els) {
      const from = map.get(el.dataset["flip"]!);
      if (!from) continue;
      const to = el.getBoundingClientRect();
      delta.set(el, { dx: from.left - to.left, dy: from.top - to.top });
    }
    for (const el of els) {
      const d = delta.get(el);
      const delay = Number(el.dataset["delay"] ?? 0);
      if (!d) {
        if (!el.dataset["enter"]) continue;
        el.animate(
          [
            { opacity: 0, transform: "translateY(8px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 520, delay, easing: EASE, fill: "backwards" },
        );
        continue;
      }
      let { dx, dy } = d;
      const host = el.parentElement?.closest<HTMLElement>("[data-flip]");
      const hd = host && root.contains(host) ? delta.get(host) : undefined;
      if (hd) {
        dx -= hd.dx;
        dy -= hd.dy;
      }
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: 700, delay, easing: EASE, fill: "backwards" },
      );
    }
  };
  return { snap, play };
}

function Icon({
  icon: I,
  size = 14,
  className,
}: {
  icon: LucideIcon;
  size?: number;
  className?: string;
}) {
  return (
    <I
      aria-hidden
      size={size}
      strokeWidth={1.8}
      className={cn("shrink-0", className)}
    />
  );
}

// ---- The Library View's collection pane ----

function TreeRow({
  indent = 0,
  icon,
  label,
  count,
  chevron = false,
  selected = false,
}: {
  indent?: number;
  icon: LucideIcon;
  label: string;
  count?: number;
  chevron?: boolean;
  selected?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex h-[25px] items-center gap-1.5 rounded-[5px] pe-2",
        selected && TINT,
      )}
      style={{ paddingInlineStart: 8 + indent * 15 }}
    >
      {chevron && (
        <Icon
          icon={ChevronDown}
          size={11}
          className="-ms-3.5 text-fd-muted-foreground"
        />
      )}
      <Icon icon={icon} size={13} className="text-fd-muted-foreground" />
      <span className="flex-1 truncate text-fd-foreground">{label}</span>
      {count !== undefined && (
        <span className="text-fd-muted-foreground tabular-nums">{count}</span>
      )}
    </div>
  );
}

function Chip({ children }: { children: string }) {
  return (
    <span className="inline-flex h-[21px] items-center rounded-full border border-fd-border px-2 text-[11.5px] text-fd-foreground/80">
      {children}
    </span>
  );
}

const FACETS = [
  m.library_view_facet_unread,
  m.library_view_facet_annotated,
  m.library_view_facet_has_note,
  m.library_view_facet_pdf,
];

function Tree({ open }: { open: boolean }) {
  return (
    <aside
      className="shrink-0 overflow-hidden transition-[width] duration-750 ease-[cubic-bezier(.6,0,.2,1)] motion-reduce:transition-none max-md:hidden"
      style={{ width: open ? 226 : 0 }}
    >
      <div className="h-full w-[226px] border-e border-fd-border p-2.5 text-[12.5px]">
        <TreeRow icon={Clock} label={m.library_view_recent()} />
        <p className="mt-2 mb-0.5 px-2 text-[11.5px] font-semibold text-fd-muted-foreground">
          {m.library_view_tree_label()}
        </p>
        <TreeRow
          indent={1}
          chevron
          icon={Library}
          label={m.settings_library_scope_personal()}
          count={5}
        />
        <TreeRow
          indent={2}
          icon={Folder}
          label="Data visualization"
          count={1}
        />
        <TreeRow
          indent={2}
          icon={Folder}
          label={COLLECTION}
          count={4}
          selected
        />
        <div className="mt-2 flex flex-wrap gap-1 px-1">
          {FACETS.map((f) => (
            <Chip key={f()}>{f()}</Chip>
          ))}
        </div>
        <div className="mx-1 mt-2.5 border-t border-fd-border pt-2">
          <p className="px-1 text-[11.5px] font-semibold text-fd-muted-foreground">
            {m.library_view_tags_label()}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {TAGS.map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

// ---- The list heading (Library View) and the toolbar (query file) ----

function LibraryHead({ step }: { step: number }) {
  const pressed = step >= 1;
  return (
    <div className="border-b border-fd-border">
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <Icon icon={PanelLeft} className="text-fd-muted-foreground" />
        <div className="flex h-[27px] flex-1 items-center gap-2 rounded-[6px] border border-fd-border px-2.5 text-fd-muted-foreground">
          <Icon icon={Search} size={13} />
          <span className="text-[12.5px]">
            {m.library_view_search_placeholder()}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2.5 p-3 pt-2.5">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-[6px]",
            TINT,
            PURPLE,
          )}
        >
          <Icon icon={Folder} size={15} />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[11px] text-fd-muted-foreground">
            {m.settings_library_scope_personal()} ›
          </p>
          <p className="text-[14px] font-semibold text-fd-foreground">
            {COLLECTION}
          </p>
          <p className="text-[11.5px] text-fd-muted-foreground">
            {m.library_view_heading_papers({ count: 4 })} ·{" "}
            {m.library_view_heading_unread({ count: 2 })}
          </p>
        </div>
        <div className="flex items-center gap-1 self-start pt-0.5 text-fd-muted-foreground">
          <span className="flex size-7 items-center justify-center rounded-[5px]">
            <Icon icon={ArrowUpDown} size={15} />
          </span>
          <span className="relative">
            <span
              key={pressed ? "on" : "off"}
              className={cn(
                "flex size-7 items-center justify-center rounded-[5px]",
                pressed && [TINT, PURPLE, "motion-safe:animate-demo-press"],
              )}
            >
              <Icon icon={FilePlus} size={15} />
            </span>
            {pressed && step < 3 && (
              <span className="absolute end-0 top-full z-10 mt-1.5 rounded-[5px] bg-fd-foreground px-2 py-1 text-[11.5px] whitespace-nowrap text-fd-background shadow-md motion-safe:animate-demo-pop">
                {m.annot_view_save_as_query_file()}
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

function Tool({
  icon,
  label,
  count,
  active = false,
}: {
  icon: LucideIcon;
  label: string;
  count?: string;
  active?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[25px] items-center gap-1 rounded-[5px] border px-1.5",
        active
          ? "border-fd-border bg-fd-muted text-fd-foreground"
          : "border-transparent",
        count && PURPLE,
      )}
    >
      <Icon icon={icon} size={13} />
      <span className="max-md:hidden">{label}</span>
      {count && (
        <span
          key={count}
          className="inline-block text-[11px] opacity-70 motion-safe:animate-demo-type"
        >
          {count}
        </span>
      )}
    </span>
  );
}

function QueryBar({ step }: { step: number }) {
  const table = step >= 5;
  return (
    <div className="flex h-10 items-center gap-2 border-b border-fd-border px-3 text-[12.5px] text-fd-muted-foreground">
      <span
        data-flip="qb-view"
        data-enter=""
        className="inline-flex items-center gap-1.5 text-fd-foreground"
      >
        <span
          key={table ? "t" : "p"}
          className="inline-flex motion-safe:animate-demo-type"
        >
          <Icon icon={table ? Table : Library} />
        </span>
        <span className="font-medium">{m.library_view_papers_view_name()}</span>
        <Icon
          icon={ChevronsUpDown}
          size={12}
          className="text-fd-muted-foreground"
        />
      </span>
      <span
        data-flip="qb-count"
        data-enter=""
        data-delay="60"
        className={PURPLE}
      >
        {m.query_view_results({ count: 4 })}
      </span>
      <span className="flex-1" />
      <span
        data-flip="qb-tools"
        data-enter=""
        data-delay="120"
        className="flex items-center gap-0.5"
      >
        <Tool
          icon={ArrowUpDown}
          label={m.query_view_sort()}
          count={step >= 11 ? "1" : undefined}
          active={step === 10}
        />
        <Tool icon={Group} label={m.query_view_group()} />
        <Tool icon={ListFilter} label={m.query_view_filter()} count="2" />
        <Tool
          icon={List}
          label={m.query_view_properties()}
          active={(step >= 5 && step <= 9) || step === 12}
        />
        <Tool icon={Search} label={m.query_view_search()} />
      </span>
    </div>
  );
}

// ---- The Save as query file dialog ----

function SaveDialog({ step }: { step: number }) {
  const saving = step >= 3;
  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center bg-black/16 pt-7">
      <div className="w-[min(25rem,calc(100%-1.5rem))] rounded-[10px] border border-fd-border bg-fd-card text-[12.5px] shadow-[0_18px_44px_-14px_rgb(0_0_0/0.45)] motion-safe:animate-demo-pop">
        <div className="flex items-center justify-between px-4 pt-3.5">
          <p className="text-[14px] font-semibold text-fd-foreground">
            {m.annot_view_save_title()}
          </p>
          <Icon icon={X} size={13} className="text-fd-muted-foreground" />
        </div>
        <div className="grid gap-2 px-4 pt-2.5">
          <div className="grid gap-1 text-fd-foreground">
            {m.annot_view_save_name_label()}
            <span className="flex h-[27px] items-center rounded-[5px] border border-fd-border bg-fd-background px-2">
              {COLLECTION}
            </span>
          </div>
          <div className="grid gap-1 text-fd-foreground">
            {m.annot_view_save_folder_label()}
            <span className="flex h-[27px] items-center rounded-[5px] border border-(--desk-purple) px-2">
              {QUERY_FOLDER}
            </span>
          </div>
          <p className="text-fd-muted-foreground">
            {m.annot_view_save_file({ file: QUERY_FILE })}
          </p>
        </div>
        <div className="mt-3 flex justify-end gap-2 border-t border-fd-border px-4 py-2.5">
          <span
            key={saving ? "s" : "w"}
            className={cn(
              "rounded-[5px] bg-[#8a5cf5] px-3 py-1 font-medium text-white",
              saving && "motion-safe:animate-demo-press",
            )}
          >
            {m.annot_view_save_action()}
          </span>
          <span className="rounded-[5px] bg-fd-muted px-3 py-1 text-fd-foreground">
            {m.modal_cancel()}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---- Rows: the two-line Papers row that becomes a Table row ----

type ColumnKey = "note" | "year" | "pub" | "creators" | "rating";

interface Column {
  key: ColumnKey;
  label: () => string;
  icon: LucideIcon;
  /** The step at which the column fills. */
  at: number;
  /** Phones keep only Title, Year and rating. */
  wideOnly: boolean;
}

const COLUMNS: readonly Column[] = [
  {
    key: "note",
    label: m.query_view_table_literature_note,
    icon: File,
    at: 6,
    wideOnly: true,
  },
  {
    key: "year",
    label: m.query_view_property_year,
    icon: Hash,
    at: 7,
    wideOnly: false,
  },
  {
    key: "pub",
    label: m.docs_home_table_publication,
    icon: TextAlignStart,
    at: 8,
    wideOnly: true,
  },
  {
    key: "creators",
    label: m.query_view_property_creators,
    icon: List,
    at: 9,
    wideOnly: true,
  },
  {
    key: "rating",
    label: () => m.query_view_vault_property_label({ name: "rating" }),
    icon: TextAlignStart,
    at: 12,
    wideOnly: false,
  },
];

/**
 * Every column track is reserved from the first Table frame, so the grid
 * never changes and no column moves sideways; each column fills in place at
 * its beat. `minmax(0, …)` on every wide track: the header and each row share
 * one grid, whatever the cells' text would ask for.
 */
const TABLE_GRID =
  "grid-cols-[minmax(0,1fr)_3.5rem_6rem] md:grid-cols-[minmax(0,3fr)_minmax(0,1.12fr)_minmax(0,0.6fr)_minmax(0,1.7fr)_minmax(0,1.75fr)_minmax(0,1.05fr)]";

function Cell({
  col,
  p,
  i,
  step,
}: {
  col: Column;
  p: Paper;
  i: number;
  step: number;
}) {
  const shown = step >= col.at;
  const base = cn(
    "flex min-w-0 items-center border-s px-2 transition-colors duration-500 md:px-2.5",
    shown ? "border-fd-border" : "border-transparent",
    col.wideOnly && "max-md:hidden",
    col.key === "year" && "max-md:overflow-hidden",
  );
  if (!shown) return <div className={base} />;
  const flip = { "data-enter": "", "data-delay": i * 60 };
  switch (col.key) {
    case "note":
      return (
        <div className={base}>
          {p.note ? (
            <span
              data-flip={`n-${p.citekey}`}
              {...flip}
              className={cn(
                "block truncate underline decoration-1 underline-offset-2",
                PURPLE,
              )}
            >
              {p.citekey}
            </span>
          ) : (
            <span
              data-flip={`n-${p.citekey}`}
              {...flip}
              className="inline-flex items-center gap-1 rounded px-1 text-fd-muted-foreground"
            >
              <Icon icon={FilePlus} size={12} />
              {m.query_view_table_create_note()}
            </span>
          )}
        </div>
      );
    case "year":
      return (
        <div className={base}>
          <span
            data-flip={`y-${p.citekey}`}
            {...flip}
            className="block font-serif text-[14px] text-fd-foreground tabular-nums"
          >
            {p.year}
          </span>
        </div>
      );
    case "pub":
    case "creators":
      return (
        <div className={base}>
          <span
            data-flip={`${col.key}-${p.citekey}`}
            {...flip}
            className="block truncate text-fd-foreground"
          >
            {col.key === "pub" ? p.venue : p.creators}
          </span>
        </div>
      );
    case "rating": {
      // A property of the paper's literature note, typed one row at a time
      // with Obsidian's cell focus. A paper with no note shows "No note".
      if (!p.note)
        return (
          <div className={base}>
            <span
              data-flip={`r-${p.citekey}`}
              {...flip}
              className="block truncate text-fd-muted-foreground"
            >
              {m.query_view_vault_no_note()}
            </span>
          </div>
        );
      const typed = step >= 13 + i;
      const focused = step >= 13 && step < FINAL && step === 13 + i;
      return (
        <div className={cn(base, "relative")}>
          {focused && (
            <span
              data-flip="focus"
              className="absolute inset-0 rounded-[3px] border-[1.5px] border-(--desk-purple)"
            />
          )}
          {typed && (
            <span
              className={cn(
                "relative inline-block font-serif text-[15px] font-semibold text-fd-foreground tabular-nums",
                focused && "motion-safe:animate-demo-type",
              )}
            >
              {p.rating}
            </span>
          )}
          {focused && (
            <span className="relative ms-px inline-block h-[1.05em] w-px bg-(--desk-purple) motion-safe:animate-demo-blink" />
          )}
        </div>
      );
    }
  }
}

function Row({ p, i, step }: { p: Paper; i: number; step: number }) {
  const table = step >= 5;
  // Before the table, the second line holds what has not moved into a column.
  const meta: readonly (readonly [string, string | number])[] = table
    ? []
    : [
        ["mc-", p.short],
        ["my-", p.year],
        ["mp-", p.venue],
      ];
  return (
    <div
      data-flip={`row-${p.citekey}`}
      className={cn(
        "grid border-b border-fd-border",
        table ? [TABLE_GRID, "min-h-[35px]"] : "min-h-[49px] grid-cols-1",
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5 py-1.5 ps-2 pe-2.5 max-md:overflow-hidden">
        <span className="w-3 shrink-0 text-fd-muted-foreground">
          {p.children && <Icon icon={ChevronRight} size={12} />}
        </span>
        {!table && (
          <Icon icon={Newspaper} className="text-fd-muted-foreground" />
        )}
        <div className="min-w-0 flex-1 leading-snug">
          <span
            data-flip={`t-${p.citekey}`}
            className={cn(
              "block truncate text-fd-foreground",
              !table && "font-medium",
            )}
          >
            {p.title}
          </span>
          {meta.length > 0 && (
            <span className="flex min-w-0 items-baseline gap-1 overflow-hidden text-[11.5px] whitespace-nowrap text-fd-muted-foreground">
              {meta.map(([k, v], j) => (
                <Fragment key={k}>
                  {j > 0 && <span>·</span>}
                  <span
                    data-flip={k + p.citekey}
                    className={cn(
                      "inline-block",
                      k === "my-" ? "tabular-nums" : "truncate",
                    )}
                  >
                    {v}
                  </span>
                </Fragment>
              ))}
            </span>
          )}
        </div>
        {!table && (
          <span className="flex shrink-0 items-center gap-1 text-fd-muted-foreground">
            {p.note && <Icon icon={FileText} size={13} />}
            {p.pdf && <Icon icon={File} size={13} />}
          </span>
        )}
      </div>
      {table &&
        COLUMNS.map((c) => (
          <Cell key={c.key} col={c} p={p} i={i} step={step} />
        ))}
    </div>
  );
}

function HeadRow({ step }: { step: number }) {
  return (
    <div
      className={cn(
        "grid border-b border-fd-border text-[12px] text-fd-muted-foreground",
        TABLE_GRID,
      )}
    >
      <span
        data-flip="h-title"
        data-enter=""
        className="flex h-[30px] items-center gap-1.5 ps-[26px]"
      >
        <Icon icon={TextAlignStart} size={12} />
        {m.query_view_property_title()}
      </span>
      {COLUMNS.map((c) => (
        <span
          key={c.key}
          className={cn(
            "flex h-[30px] min-w-0 items-center border-s px-2 transition-colors duration-500 max-md:overflow-hidden md:px-2.5",
            step >= c.at ? "border-fd-border" : "border-transparent",
            c.wideOnly && "max-md:hidden",
          )}
        >
          {step >= c.at && (
            <span
              data-flip={`h-${c.key}`}
              data-enter=""
              className="flex min-w-0 items-center gap-1.5"
            >
              <Icon icon={c.icon} size={12} className="max-md:hidden" />
              <span className="truncate">{c.label()}</span>
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

// ---- The window ----

export function DemoWindow({
  step,
  fading,
  stageRef,
}: {
  step: number;
  fading: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
}) {
  const query = step >= 4;
  const table = step >= 5;
  const rows = step >= 11 ? BY_YEAR : COLLECTION_PAPERS;
  const tab =
    "flex h-[28px] w-[9.5rem] items-center gap-1.5 rounded-t-[7px] px-2.5 text-[12.5px] sm:w-[11rem]";
  return (
    <div className="overflow-hidden rounded-[11px] border border-fd-border bg-fd-card text-[13px] shadow-(--desk-window-shadow)">
      <div className="flex h-[34px] items-end gap-1 border-b border-fd-border bg-fd-muted px-3">
        <span className="me-2 mb-[12px] flex gap-[6px]">
          {[0, 1, 2].map((d) => (
            <span key={d} className="size-[9px] rounded-full bg-fd-border" />
          ))}
        </span>
        <span
          className={cn(
            tab,
            query
              ? "text-fd-muted-foreground"
              : "border border-b-0 border-fd-border bg-fd-card text-fd-foreground",
          )}
        >
          <span className="font-serif text-[12px] font-bold">Z</span>
          <span className="flex-1 truncate">{m.library_view_name()}</span>
          {!query && (
            <Icon icon={X} size={11} className="text-fd-muted-foreground" />
          )}
        </span>
        {query && (
          <span
            className={cn(
              tab,
              "border border-b-0 border-fd-border bg-fd-card text-fd-foreground motion-safe:animate-demo-pop",
            )}
          >
            <Icon
              icon={ListFilter}
              size={12}
              className="text-fd-muted-foreground"
            />
            <span className="flex-1 truncate">{COLLECTION}</span>
            <Icon icon={X} size={11} className="text-fd-muted-foreground" />
          </span>
        )}
        <span className="ms-1 mb-[7px] text-fd-muted-foreground">+</span>
      </div>
      <div className="flex h-[34px] items-center gap-2.5 px-3.5 text-[12.5px] text-fd-muted-foreground">
        <Icon icon={ArrowLeft} size={13} />
        <Icon icon={ArrowRight} size={13} className="opacity-50" />
        {query ? (
          <span
            key="crumb"
            className="truncate text-fd-foreground/85 motion-safe:animate-demo-pop"
          >
            {QUERY_FOLDER} <span className="text-fd-muted-foreground">/</span>{" "}
            {COLLECTION}
          </span>
        ) : (
          <span className="text-fd-foreground/85">{m.library_view_name()}</span>
        )}
        <span className="flex-1" />
        <Icon icon={Ellipsis} size={15} />
      </div>
      <div
        ref={stageRef}
        className={cn(
          "relative flex h-[312px] border-t border-fd-border transition-opacity duration-550 md:h-[318px]",
          fading ? "opacity-0" : "opacity-100",
        )}
      >
        <Tree open={!query} />
        <div className="relative min-w-0 flex-1">
          {query ? <QueryBar step={step} /> : <LibraryHead step={step} />}
          {table && <HeadRow step={step} />}
          <div>
            {rows.map((p, i) => (
              <Row key={p.citekey} p={p} i={i} step={step} />
            ))}
          </div>
        </div>
        {(step === 2 || step === 3) && <SaveDialog step={step} />}
      </div>
    </div>
  );
}

// ---- The caption trail ----

export function Trail({
  step,
  cycle,
  playing,
}: {
  step: number;
  cycle: number;
  playing: boolean;
}) {
  const beat = beatOf(step);
  // A beat behind the current one is full; the current one fills over its
  // span while the demo plays; the finished frame shows every bar full.
  const bar = (i: number): { className?: string; style?: CSSProperties } => {
    if (i < beat || (!playing && step === FINAL)) return {};
    if (i > beat || !playing) return { className: "scale-x-0" };
    return {
      style: {
        animation: `demo-beat ${BEAT_AT[i + 1]! - BEAT_AT[i]!}ms linear both`,
      },
    };
  };
  return (
    <div aria-hidden className="mt-4">
      <ol className="grid grid-cols-5 gap-2 sm:gap-5">
        {BEATS.map((b, i) => {
          const { className, style } = bar(i);
          return (
            <li
              key={b()}
              className={cn(
                "transition-colors duration-500",
                i === beat ? "text-fd-foreground" : "text-fd-muted-foreground",
              )}
            >
              <span className="relative block h-px bg-fd-border">
                <span
                  key={`${cycle}-${i}`}
                  className={cn(
                    "absolute inset-x-0 -inset-y-[0.5px] origin-left bg-fd-ring",
                    className,
                  )}
                  style={style}
                />
              </span>
              <span className="mt-2 hidden items-baseline gap-2 md:flex">
                <span className="font-mono text-[11px] tracking-wider text-fd-primary tabular-nums">
                  {two(i + 1)}
                </span>
                <span className="font-serif text-[15px] italic">{b()}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 flex items-baseline gap-2 md:hidden">
        <span className="font-mono text-[11px] tracking-wider text-fd-primary tabular-nums">
          {m.docs_home_table_beat_counter({
            number: two(beat + 1),
            total: two(BEATS.length),
          })}
        </span>
        <span
          key={beat}
          className="font-serif text-[15px] text-fd-foreground italic motion-safe:animate-demo-pop"
        >
          {BEATS[beat]!()}
        </span>
      </p>
    </div>
  );
}
