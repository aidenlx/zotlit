// Job 2, "Find a paper": the Library View on the collection "Reproducibility".
// The loop presses the Annotated filter, then selects the paper left, whose
// Reading Card opens beside the list.
// Replica of apps/obsidian/src/views/library/ (chip.ts `FILTER_CHIP_CLASS`,
// heading.tsx, reading-card.tsx) and query-view/papers-layout.tsx.

import {
  Copy,
  FileText,
  Highlighter,
  Library,
  NotebookPen,
  Search,
} from "lucide-react";
import { useRef } from "react";

import { cn } from "@/lib/cn";
import { m } from "@/paraglide/messages.js";

import {
  COLLECTION,
  PAPERS,
  SANDVE_HIGHLIGHTS,
  metaLine,
  paper,
} from "./papers";
import { useLoop } from "./use-loop";
import { ReplicaWindow } from "./window";

const FACETS = [
  m.library_view_facet_unread,
  m.library_view_facet_annotated,
  m.library_view_facet_has_note,
  m.library_view_facet_pdf,
];

function ReadingCard() {
  const p = paper("sandve2013");
  return (
    <div className="grid content-start gap-3 p-4 text-[13px]">
      <p className="font-serif text-[19px] leading-snug font-medium">
        {p.title}
      </p>
      <p className="text-fd-muted-foreground">
        Geir Kjetil Sandve, Anton Nekrutenko, James Taylor, Eivind Hovig
      </p>
      <p>
        <span className="italic">{p.venue}</span> {p.locator} · {p.year}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {["reproducibility", "research-practice"].map((t) => (
          <span
            key={t}
            className="rounded-sm bg-fd-muted px-1.5 py-0.5 text-[12px] text-fd-muted-foreground"
          >
            #{t}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-fd-border px-2 py-1">
          <FileText className="size-3.5" strokeWidth={1.5} />
          {m.library_view_menu_open_pdf()}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-fd-border px-2 py-1">
          <NotebookPen className="size-3.5" strokeWidth={1.5} />
          {m.library_view_menu_open_note()}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-fd-border px-2 py-1">
          <Copy className="size-3.5" strokeWidth={1.5} />
          {m.library_view_card_copy_citation_key()}
        </span>
      </div>
      <div>
        <p className="mb-1.5 font-medium">
          {m.library_view_card_your_annotations()}
        </p>
        <div className="flex h-2 overflow-hidden rounded-full">
          {SANDVE_HIGHLIGHTS.map((h) => (
            <span
              key={h.text}
              className="flex-1"
              style={{ background: h.color }}
            />
          ))}
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 text-fd-muted-foreground">
          <Highlighter className="size-3.5" strokeWidth={1.5} />
          {SANDVE_HIGHLIGHTS.length} · p. 1–2
        </p>
      </div>
    </div>
  );
}

/** How long each frame of the loop shows, in ms; the last is the finished frame. */
const FRAMES = [1600, 1600, 5000];

export default function FindReplica() {
  const ref = useRef<HTMLDivElement>(null);
  // All papers; Annotated pressed; the paper selected and its card open.
  const frame = useLoop(ref, FRAMES);
  const filtered = frame >= 1;
  const selected = frame === 2;
  const rows = filtered ? PAPERS.filter((p) => p.annotated) : PAPERS;
  return (
    <div ref={ref}>
      <ReplicaWindow
        icon={Library}
        title={m.library_view_name()}
        label={`${m.library_view_name()}: ${COLLECTION}, ${PAPERS.map((p) => p.title).join("; ")}`}
      >
        <div className="grid @3xl:grid-cols-[minmax(0,1fr)_minmax(0,19rem)]">
          <div className="min-w-0">
            <div className="p-3 pb-2">
              <div className="flex h-8 items-center gap-2 rounded-md border border-fd-border px-2.5 text-[13px] text-fd-muted-foreground">
                <Search className="size-3.5" strokeWidth={1.5} />
                {m.library_view_search_placeholder()}
              </div>
              <p className="mt-3 text-[11.5px] text-fd-muted-foreground">
                {m.settings_library_scope_personal()} ›
              </p>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[15px] font-semibold">{COLLECTION}</p>
                <p className="text-[12px] text-fd-muted-foreground tabular-nums">
                  {rows.length} / {PAPERS.length}
                </p>
              </div>
              <div
                className="mt-2 flex flex-wrap gap-1.5"
                aria-label={m.library_view_facets_label()}
              >
                {FACETS.map((label, i) => {
                  const on = i === 1 && filtered;
                  return (
                    <span
                      key={label()}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-[12px] transition-colors duration-150 ease-out",
                        on
                          ? "border-fd-primary bg-fd-primary text-fd-primary-foreground"
                          : "border-fd-border text-fd-muted-foreground",
                      )}
                    >
                      {label()}
                    </span>
                  );
                })}
              </div>
            </div>
            {/* Room for every row, so the filter never changes the window's height. */}
            <ul className="min-h-[17.5rem] border-t border-fd-border">
              {rows.map((p) => (
                <li
                  key={p.citekey}
                  className={cn(
                    "flex gap-2.5 border-b border-fd-border px-3 py-2.5 transition-colors duration-150 ease-out",
                    selected && p.citekey === "sandve2013" && "bg-fd-accent",
                  )}
                >
                  <FileText
                    className="mt-0.5 size-3.5 shrink-0 text-fd-muted-foreground"
                    strokeWidth={1.5}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium">
                      {p.title}
                    </p>
                    <p className="truncate text-[12px] text-fd-muted-foreground">
                      {metaLine(p)}
                    </p>
                  </div>
                  {p.note && (
                    <NotebookPen
                      className="mt-0.5 size-3.5 shrink-0 text-fd-muted-foreground"
                      strokeWidth={1.5}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div
            className={cn(
              "max-@3xl:border-t border-fd-border transition-opacity duration-150 ease-out @3xl:border-s",
              selected ? "opacity-100" : "opacity-35",
            )}
          >
            <ReadingCard />
          </div>
        </div>
      </ReplicaWindow>
    </div>
  );
}
