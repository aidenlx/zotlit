// The research desk around the hero's headline: six objects, each built in
// HTML on the docs Fixture's data and named by a strip of washi tape. The
// Library View sheet and the Reproducibility.zotquery table lead; the PDF
// page, the literature-note card, the draft with its citation picker and the
// Word reference page lie around them.
//
// From 1280px the desk lies on a 1440 × 832 stage that scales in steps with
// the window. Below 1280px, the library sheet, the table and the PDF sit in a
// short fanned stack under the text. The whole desk is decorative
// (`aria-hidden`): the headline and the sections below say what it shows.
// @see apps/docs/DESIGN.md → Landing (Hero)

import {
  ArrowUpDown,
  ChevronDown,
  Clock,
  Folder,
  Library,
  List,
  ListFilter,
  Rows3,
  Search,
  Table,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/cn";
import { m } from "@/paraglide/messages.js";

import { BY_YEAR, COLLECTION, QUERY_FOLDER, TAGS } from "./papers";

/** A raised sheet of paper on the desk. */
const PAPER = "[box-shadow:var(--desk-shadow)]";

/** Greeked text: a run of the paper's other lines, shown as bars. */
function Bars({ rows }: { rows: readonly string[] }) {
  return rows.map((w, i) => (
    <span
      key={i}
      className="my-[9px] block h-[5px] rounded-full bg-fd-foreground/10"
      style={{ width: w }}
    />
  ));
}

/** The washi tape that names what the object lets you do. */
function Tape({
  children,
  side = "left",
  inset = 20,
}: {
  children: ReactNode;
  side?: "left" | "right";
  inset?: number;
}) {
  return (
    <span
      className="absolute -top-3 z-10 px-3 py-[5px] font-mono text-[10.5px] leading-none font-medium tracking-[0.12em] whitespace-nowrap text-fd-foreground/80 uppercase"
      style={{
        [side]: inset,
        background: "var(--desk-tape)",
        transform: `rotate(${side === "left" ? -2.5 : 2.5}deg)`,
        clipPath:
          "polygon(0 0, 4px 25%, 0 50%, 4px 75%, 0 100%, 100% 100%, calc(100% - 4px) 75%, 100% 50%, calc(100% - 4px) 25%, 100% 0)",
      }}
    >
      {children}
    </span>
  );
}

/**
 * One object on the desk. The outer layer takes its place and, from 1280px,
 * the pointer parallax (`data-depth`); the inner one takes its angle and its
 * drop onto the desk.
 */
function Piece({
  x,
  y,
  w,
  r,
  d,
  depth,
  tape,
  children,
}: {
  /** Left edge, in px from the stage's centre line. */
  x: number;
  y: number;
  w: number;
  /** Angle, in degrees. */
  r: number;
  /** Drop delay, in ms. */
  d: number;
  /** How far the object drifts with the pointer; none when absent. */
  depth?: number;
  tape?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      data-depth={depth}
      className="absolute transition-[translate] duration-900 ease-[cubic-bezier(.2,.7,.2,1)]"
      style={{ left: `calc(50% + ${x}px)`, top: y, width: w }}
    >
      <div
        className="relative [transform:rotate(var(--desk-r))] motion-safe:animate-desk-drop"
        style={
          { "--desk-r": `${r}deg`, animationDelay: `${d}ms` } as CSSProperties
        }
      >
        {children}
        {tape}
      </div>
    </div>
  );
}

/** The top strip of an Obsidian tab: one open tab with its title. */
function TabStrip({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className="flex items-end border-b border-fd-border bg-fd-muted px-2 pt-1.5">
      <span className="flex items-center gap-1.5 rounded-t-[5px] border border-b-0 border-fd-border bg-fd-card px-2.5 py-[5px] text-[11px] font-medium text-fd-foreground">
        <Icon className="size-[11px] text-fd-muted-foreground" />
        {children}
        <span className="ms-2 text-[11px] leading-none text-fd-muted-foreground">
          ×
        </span>
      </span>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded-[5px] border border-fd-border px-1.5 py-[2px] text-[10.5px] leading-[1.3] whitespace-nowrap text-fd-foreground/80">
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

/** The Library View: the tree with Recent first, then the papers you last touched and why. */
function LibrarySheet({ compact = false }: { compact?: boolean }) {
  const recent = [
    {
      title: "Ten Simple Rules for Reproducible Computational Research",
      meta: "Sandve, Nekrutenko, Taylor et al. · 2013",
      why: m.library_recent_read_obsidian({ time: "2 h ago" }),
      selected: true,
    },
    {
      title: "Why Most Published Research Findings Are False",
      meta: "Ioannidis · 2005",
      why: m.library_recent_cited({ time: "yesterday" }),
    },
    {
      title: "A manifesto for reproducible science",
      meta: "Munafò, Nosek, Bishop et al. · 2017",
      why: m.library_recent_notes_edited({ time: "yesterday" }),
    },
    {
      title: "Ten Simple Rules for Better Figures",
      meta: "Rougier, Droettboom, Bourne · 2014",
      why: m.library_recent_added({ time: "yesterday" }),
    },
  ].slice(0, compact ? 2 : 4);
  const row =
    "flex items-center gap-1.5 rounded-[4px] px-1.5 py-[4px] text-[11.5px] leading-tight text-fd-foreground";
  const folder = cn(row, compact ? "ps-4" : "ps-5");
  return (
    <div
      className={cn(
        PAPER,
        "overflow-hidden rounded-md border border-fd-border bg-fd-card",
      )}
    >
      <TabStrip icon={Library}>{m.library_view_name()}</TabStrip>
      <div
        className={cn(
          "grid",
          compact
            ? "grid-cols-[160px_minmax(0,1fr)]"
            : "grid-cols-[164px_minmax(0,1fr)]",
        )}
      >
        <div className="border-e border-fd-border px-1.5 pt-2 pb-3">
          <div className={cn(row, "bg-(--desk-selected)")}>
            <Clock className="size-[11px]" />
            {m.library_view_recent()}
          </div>
          <p className="mt-2 px-1.5 text-[10.5px] font-semibold text-fd-muted-foreground">
            {m.library_view_tree_label()}
          </p>
          <div className={row}>
            <ChevronDown className="-ms-0.5 size-2.5 shrink-0 text-fd-muted-foreground" />
            <Library className="size-[11px] shrink-0 text-fd-muted-foreground" />
            <span className="flex-1 truncate">
              {m.settings_library_scope_personal()}
            </span>
            <span className="text-[10.5px] text-fd-muted-foreground">5</span>
          </div>
          <div className={folder}>
            <Folder className="size-[11px] shrink-0 text-fd-muted-foreground" />
            <span className="flex-1 truncate">Data visualization</span>
            <span className="text-[10.5px] text-fd-muted-foreground">1</span>
          </div>
          <div className={folder}>
            <Folder className="size-[11px] shrink-0 text-fd-muted-foreground" />
            <span className="flex-1 truncate">{COLLECTION}</span>
            <span className="text-[10.5px] text-fd-muted-foreground">4</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1 px-1">
            {FACETS.map((f) => (
              <Chip key={f()}>{f()}</Chip>
            ))}
          </div>
          {!compact && (
            <>
              <p className="mt-3 border-t border-fd-border px-1.5 pt-2 text-[10.5px] font-semibold text-fd-muted-foreground">
                {m.library_view_tags_label()}
              </p>
              <div className="mt-1 flex flex-wrap gap-1 px-1">
                {TAGS.map((t) => (
                  <Chip key={t}>{t}</Chip>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="min-w-0 p-2">
          <div className="flex items-center gap-1.5 rounded-[5px] border border-fd-border px-2 py-[4px] text-[10.5px] text-fd-muted-foreground">
            <Search className="size-2.5 shrink-0" />
            <span className="truncate">
              {m.library_view_search_placeholder()}
            </span>
          </div>
          <p className="mt-2 px-1 text-[12px] font-semibold text-fd-foreground">
            {m.library_view_recent()}
          </p>
          <ul className="mt-1 space-y-0.5">
            {recent.map((p) => (
              <li
                key={p.title}
                className={cn(
                  "rounded-[4px] px-1.5 py-[5px]",
                  p.selected && "bg-(--desk-selected)",
                )}
              >
                <p className="line-clamp-2 text-[11.5px] leading-[1.3] font-medium text-fd-foreground">
                  {p.title}
                </p>
                <p className="truncate text-[10.5px] leading-[1.45] text-fd-muted-foreground">
                  {p.meta}
                </p>
                <p className="mt-px flex items-center gap-1 text-[10.5px] leading-[1.35] text-fd-foreground/75">
                  <Clock className="size-[9px] shrink-0 text-fd-muted-foreground" />
                  <span className="min-w-0 truncate">{p.why}</span>
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** The query file as a table: the rating column is the reader's own, filled in as they read. */
function TableSheet({ compact = false }: { compact?: boolean }) {
  const cols = compact
    ? "minmax(0,1fr) 48px 84px"
    : "minmax(0,1fr) 50px 104px 96px";
  const cell = compact ? "truncate px-2 py-[6px]" : "truncate px-2 py-[10px]";
  const own = "bg-(--desk-own)";
  const tool = "inline-flex items-center gap-1";
  const counted = "text-(--desk-purple)";
  return (
    <div
      className={cn(
        PAPER,
        "overflow-hidden rounded-md border border-fd-border bg-fd-card",
      )}
    >
      <TabStrip icon={ListFilter}>{COLLECTION}.zotquery</TabStrip>
      {!compact && (
        <p className="px-2.5 pt-2 text-[11px] text-fd-muted-foreground">
          {QUERY_FOLDER} <span className="mx-0.5">/</span>{" "}
          <span className="text-fd-foreground">{COLLECTION}</span>
        </p>
      )}
      <div className="flex items-center justify-between gap-3 px-2.5 pt-2 pb-1.5 text-[10.5px] whitespace-nowrap text-fd-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Table className="size-[11px] text-fd-foreground" />
          <span className="font-medium text-fd-foreground">
            {m.library_view_papers_view_name()}
          </span>
          <ChevronDown className="size-[9px]" />
          <span className={cn("ms-1", counted)}>
            {m.query_view_results({ count: 4 })}
          </span>
        </span>
        <span className="flex items-center gap-2.5">
          <span className={cn(tool, counted)}>
            <ArrowUpDown className="size-2.5" />
            {m.query_view_sort()} 1
          </span>
          {!compact && (
            <span className={tool}>
              <Rows3 className="size-2.5" />
              {m.query_view_group()}
            </span>
          )}
          <span className={cn(tool, counted)}>
            <ListFilter className="size-2.5" />
            {m.query_view_filter()} 2
          </span>
          {!compact && (
            <span className={tool}>
              <List className="size-2.5" />
              {m.query_view_properties()}
            </span>
          )}
          <Search className="size-2.5" />
        </span>
      </div>
      <div
        className={cn(compact ? "text-[11px]" : "text-[12px]", "leading-tight")}
      >
        <div
          className="grid border-y border-fd-border text-fd-muted-foreground"
          style={{ gridTemplateColumns: cols }}
        >
          <span className={cell}>{m.query_view_property_title()}</span>
          <span className={cn(cell, "border-s border-fd-border")}>
            {m.query_view_property_year()}
          </span>
          {!compact && (
            <span className={cn(cell, "border-s border-fd-border")}>
              {m.docs_home_table_publication()}
            </span>
          )}
          <span className={cn(cell, own, "border-s border-fd-border")}>
            {m.query_view_vault_property_label({ name: "rating" })}
          </span>
        </div>
        {BY_YEAR.map((p, i) => (
          <div
            key={p.citekey}
            className="grid border-b border-fd-border text-fd-foreground last:border-b-0"
            style={{ gridTemplateColumns: cols }}
          >
            <span className={cell}>{p.title}</span>
            <span
              className={cn(cell, "border-s border-fd-border tabular-nums")}
            >
              {p.year}
            </span>
            {!compact && (
              <span className={cn(cell, "border-s border-fd-border")}>
                {p.venue}
              </span>
            )}
            <span
              className={cn(
                cell,
                own,
                "relative border-s border-fd-border tabular-nums",
              )}
            >
              <span
                className="inline-block font-semibold motion-safe:animate-desk-fill"
                style={{ animationDelay: `${1500 + i * 170}ms` }}
              >
                {p.rating}
              </span>
              {i === 1 && (
                <span className="absolute inset-0 rounded-[2px] border-[1.5px] border-fd-foreground/45 motion-safe:animate-desk-focus" />
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const MARK =
  "rounded-[2px] px-px [box-decoration-break:clone] [-webkit-box-decoration-break:clone]";

/** A page of the PDF, with the reader's marks in their Zotero colours. */
function PdfPage({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        PAPER,
        "rounded-[3px] border border-fd-border/70 bg-fd-card px-6 pt-6 pb-5",
      )}
    >
      <div className="flex items-center justify-between border-b border-fd-border pb-2 font-mono text-[10px] tracking-[0.12em] text-fd-muted-foreground uppercase">
        <span>PLOS Computational Biology</span>
        <span>1</span>
      </div>
      <p
        className={cn(
          "mt-3.5 font-serif leading-[1.2] font-bold text-balance text-fd-foreground",
          compact ? "text-[17px]" : "text-[19px]",
        )}
      >
        Ten Simple Rules for Reproducible Computational Research
      </p>
      <p className="mt-2 text-[11px] leading-snug text-fd-muted-foreground">
        Geir Kjetil Sandve, Anton Nekrutenko, James Taylor, Eivind Hovig
      </p>
      <div className="mt-3 font-serif text-[12.5px] leading-[1.62] text-fd-foreground/90">
        <Bars rows={compact ? ["100%"] : ["100%", "62%"]} />
        <p>
          <span className="me-1 inline-block h-[5px] w-[30%] rounded-full bg-fd-foreground/10 align-middle" />
          <span className={cn(MARK, "bg-(--desk-hl-yellow)")}>
            As a minimal requirement, you should at least be able to reproduce
            the results yourself.
          </span>
        </p>
        <Bars rows={["97%"]} />
        <p>
          <span className="me-1 inline-block h-[5px] w-[22%] rounded-full bg-fd-foreground/10 align-middle" />
          <span className={cn(MARK, "bg-(--desk-hl-green)")}>
            good habits of reproducibility may actually turn out to be a
            time-saver in the longer run.
          </span>
        </p>
        {!compact && (
          <>
            <Bars rows={["88%"]} />
            <p>
              <span className="me-1 inline-block h-[5px] w-[44%] rounded-full bg-fd-foreground/10 align-middle" />
              <span className="underline decoration-(--z-red) decoration-2 underline-offset-[3px]">
                a failure to take notes may make exact reproduction essentially
                impossible.
              </span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** The literature note, as a ruled index card. */
function NoteCard() {
  return (
    <div
      className={cn(
        PAPER,
        "rounded-[3px] border border-fd-border/70 bg-fd-card",
      )}
    >
      <div className="border-b-2 border-fd-primary/55 px-5 pt-4 pb-2">
        <p className="font-mono text-[15px] font-semibold text-fd-foreground">
          sandve2013
        </p>
      </div>
      <div className="bg-[repeating-linear-gradient(to_bottom,transparent_0_21px,var(--color-fd-border)_21px_22px)] px-5 pt-1 pb-3 text-[11.5px] leading-[22px]">
        <dl className="grid grid-cols-[62px_1fr]">
          <dt className="font-mono text-fd-muted-foreground">year</dt>
          <dd className="text-fd-foreground">2013</dd>
          <dt className="font-mono text-fd-muted-foreground">journal</dt>
          <dd className="truncate text-fd-foreground">
            PLOS Computational Biology
          </dd>
          <dt className="font-mono text-fd-muted-foreground">authors</dt>
          <dd className="truncate text-fd-foreground">
            Sandve, Nekrutenko, Taylor, Hovig
          </dd>
        </dl>
        <p className="mt-[22px] font-semibold text-fd-foreground">Highlights</p>
        <p className="border-s-[3px] border-(--z-yellow) ps-2.5 font-serif text-[12px] text-fd-foreground">
          As a minimal requirement, you should at least be able to reproduce the
          results yourself.{" "}
          <span className="font-sans text-fd-muted-foreground">(p. 1)</span>
        </p>
      </div>
    </div>
  );
}

/** The chapter draft: one citation already in place, a second one being typed. */
function DraftSheet() {
  return (
    <div
      className={cn(
        PAPER,
        "rounded-md border border-fd-border bg-fd-card px-5 pt-4 pb-5",
      )}
    >
      <p className="font-mono text-[10px] tracking-[0.12em] text-fd-muted-foreground uppercase">
        Chapter 3 – Presenting the results
      </p>
      <p className="mt-2 font-serif text-[16px] font-semibold text-fd-foreground">
        3.3 Keeping each figure reproducible
      </p>
      <div className="relative mt-1.5 text-[13px] leading-[1.65] text-fd-foreground">
        <p>
          Every figure in this chapter is rebuilt from its raw data by one
          script{" "}
          <span className="text-fd-primary underline decoration-fd-primary/40 decoration-dotted underline-offset-[3px]">
            (Sandve et al., 2013)
          </span>
          . Their layout follows{" "}
          <span className="font-mono text-[12px] text-fd-primary">[@ten</span>
          <span className="ms-px inline-block h-[15px] w-[1.5px] translate-y-[3px] bg-fd-foreground motion-safe:animate-desk-blink" />
        </p>
        <div className="absolute top-full left-[6%] mt-1.5 w-[268px] origin-[12%_0] overflow-hidden rounded-md border border-fd-border bg-fd-card [box-shadow:var(--desk-shadow)] motion-safe:animate-desk-pop">
          <div className="bg-fd-muted px-3 py-2">
            <p className="text-[12px] leading-snug font-medium text-fd-foreground">
              Ten Simple Rules for Better Figures
            </p>
            <p className="text-[11px] text-fd-muted-foreground">
              Rougier et al. (2014)
            </p>
          </div>
          <div className="px-3 py-2">
            <p className="text-[12px] leading-snug text-fd-foreground">
              Ten Simple Rules for Reproducible Computational Research
            </p>
            <p className="text-[11px] text-fd-muted-foreground">
              Sandve et al. (2013)
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The corner of the exported Word page, with its reference list. */
function WordPage() {
  const corner = "absolute size-3 border-fd-muted-foreground/50";
  return (
    <div
      className={cn(
        PAPER,
        "relative h-[330px] rounded-[2px] border border-fd-border/70 bg-fd-card px-9 pt-9",
      )}
    >
      <span className={cn(corner, "start-5 top-5 border-e border-b")} />
      <span className={cn(corner, "end-5 top-5 border-s border-b")} />
      <p className="text-center font-serif text-[15px] font-bold text-fd-foreground">
        References
      </p>
      <ul className="mt-2.5 grid gap-1.5 font-serif text-[11.5px] leading-[1.6] text-fd-foreground/90">
        <li className="ps-6 -indent-6">
          Ioannidis, J. P. A. (2005). Why most published research findings are
          false. <i>PLoS Medicine, 2</i>(8), e124.
        </li>
        <li className="ps-6 -indent-6">
          Rougier, N. P., Droettboom, M., &amp; Bourne, P. E. (2014). Ten simple
          rules for better figures. <i>PLOS Computational Biology, 10</i>(9),
          e1003833.
        </li>
        <li className="ps-6 -indent-6">
          Sandve, G. K., Nekrutenko, A., Taylor, J., &amp; Hovig, E. (2013). Ten
          simple rules for reproducible computational research.{" "}
          <i>PLOS Computational Biology, 9</i>(10), e1003285.
        </li>
      </ul>
    </div>
  );
}

/** The full desk, from 1280px: the objects lie around the headline. */
export function Desk() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 hidden select-none xl:block"
    >
      <div className="absolute top-0 left-1/2 h-[832px] w-[1440px] origin-top -translate-x-1/2 scale-(--desk-s)">
        {/* Each group of objects is drawn at 0.84 towards its own outer edge, so
            the objects keep at least 72px clear of the text (which keeps its
            size) and the table's last column stays on screen. */}
        {/* Left of the text: the library sheet over a blank sheet, and the PDF. */}
        <div className="absolute inset-0 origin-[0_40%] scale-[0.84]">
          <Piece x={-712} y={56} w={380} r={-6} d={0} depth={0.3}>
            <div
              className={cn(
                PAPER,
                "h-[340px] rounded-[3px] border border-fd-border/70 bg-fd-card",
              )}
            />
          </Piece>
          <Piece
            x={-722}
            y={34}
            w={412}
            r={-2.5}
            d={100}
            depth={0.6}
            tape={<Tape>{m.docs_home_desk_library()}</Tape>}
          >
            <LibrarySheet />
          </Piece>
          <Piece
            x={-668}
            y={446}
            w={316}
            r={2.5}
            d={500}
            depth={1.2}
            tape={
              <Tape side="right" inset={18}>
                {m.docs_home_desk_read()}
              </Tape>
            }
          >
            <PdfPage />
          </Piece>
        </div>
        {/* Right of the text: the table over a blank sheet, and the draft. */}
        <div className="absolute inset-0 origin-[100%_40%] scale-[0.84]">
          <Piece x={326} y={48} w={380} r={4.5} d={200} depth={0.35}>
            <div
              className={cn(
                PAPER,
                "h-[230px] rounded-[3px] border border-fd-border/70 bg-fd-card",
              )}
            />
          </Piece>
          <Piece
            x={306}
            y={30}
            w={412}
            r={1.8}
            d={300}
            depth={0.8}
            tape={
              <Tape side="right" inset={24}>
                {m.docs_home_desk_table()}
              </Tape>
            }
          >
            <TableSheet />
          </Piece>
          <Piece
            x={328}
            y={384}
            w={364}
            r={-2}
            d={900}
            depth={1.1}
            tape={
              <Tape side="right" inset={22}>
                {m.docs_home_desk_cite()}
              </Tape>
            }
          >
            <DraftSheet />
          </Piece>
        </div>
        {/* Below the text: the note card and the Word page. */}
        <div className="absolute inset-0 origin-bottom -translate-y-[44px] scale-[0.84]">
          <Piece
            x={-312}
            y={604}
            w={292}
            r={-3}
            d={700}
            depth={0.9}
            tape={<Tape>{m.docs_home_desk_notes()}</Tape>}
          >
            <NoteCard />
          </Piece>
          <Piece
            x={14}
            y={618}
            w={330}
            r={1.5}
            d={1100}
            depth={0.5}
            tape={<Tape inset={26}>{m.docs_home_desk_export()}</Tape>}
          >
            <WordPage />
          </Piece>
        </div>

        {/* A clearing on the desk, so nothing crowds the headline. */}
        <div className="absolute top-[43%] left-1/2 h-[460px] w-[760px] -translate-1/2 bg-[radial-gradient(closest-side,var(--color-fd-background)_60%,transparent)]" />
      </div>
    </div>
  );
}

/** Below 1280px: the library sheet, the table and the PDF in a short fanned stack. */
export function DeskStack() {
  return (
    <div
      aria-hidden
      className="pointer-events-none relative mx-auto mt-10 h-[760px] w-full max-w-[460px] overflow-hidden select-none xl:hidden"
    >
      <Piece
        x={-174}
        y={16}
        w={324}
        r={-3}
        d={150}
        tape={<Tape>{m.docs_home_desk_library()}</Tape>}
      >
        <LibrarySheet compact />
      </Piece>
      <Piece
        x={-150}
        y={300}
        w={324}
        r={2}
        d={360}
        tape={
          <Tape side="right" inset={18}>
            {m.docs_home_desk_table()}
          </Tape>
        }
      >
        <TableSheet compact />
      </Piece>
      <Piece
        x={-162}
        y={530}
        w={316}
        r={-2}
        d={570}
        tape={<Tape>{m.docs_home_desk_read()}</Tape>}
      >
        <PdfPage compact />
      </Piece>
    </div>
  );
}
