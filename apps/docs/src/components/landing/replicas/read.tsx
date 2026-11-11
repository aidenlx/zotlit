// Job 3, "Read and annotate": Sandve et al. 2013 open in ZotLit's PDF reader,
// the reader's Zotero highlights on the page, and the annotation view beside
// it. The loop adds the blue highlight on page 2; its card arrives in the list.
// Replica of apps/obsidian/src/views/annot-view/ (Annotation.tsx card,
// type-icon.ts) beside the PDF view.

import { AlignLeft, FileText, Palette, Search, Tag } from "lucide-react";
import { useRef } from "react";

import { cn } from "@/lib/cn";
import { m } from "@/paraglide/messages.js";

import { SANDVE_HIGHLIGHTS, paper } from "./papers";
import type { Highlight } from "./papers";
import { useLoop } from "./use-loop";
import { ReplicaWindow } from "./window";

const NEW = SANDVE_HIGHLIGHTS[4]!;

/** Filler text lines on the page, in the light line tone: the PDF page stays white in both schemes. */
function Lines({ widths }: { widths: readonly number[] }) {
  return (
    <>
      {widths.map((w, i) => (
        // oxlint-disable-next-line react/no-array-index-key -- fixed filler lines
        <span
          key={i}
          className="block h-[5px] rounded-full bg-[#e3dfd6]"
          style={{ width: `${w}%` }}
        />
      ))}
    </>
  );
}

function Marked({ h, on = true }: { h: Highlight; on?: boolean }) {
  return (
    <span
      className="[box-decoration-break:clone] transition-[background-color] duration-150 ease-out"
      style={{
        backgroundColor: on
          ? `color-mix(in oklab, ${h.color} 40%, transparent)`
          : "transparent",
      }}
    >
      {h.text}
    </span>
  );
}

function Card({
  h,
  selected,
  hidden,
}: {
  h: Highlight;
  selected?: boolean;
  /** Holds its place while hidden, so the list keeps its height. */
  hidden?: boolean;
}) {
  return (
    <li
      className={cn(
        "rounded-md bg-fd-card px-3 py-2 text-[12px] ring-1 transition-[box-shadow,background-color,opacity] duration-150 ease-out",
        selected ? "bg-fd-accent ring-fd-primary" : "ring-fd-border",
        hidden && "opacity-0",
      )}
    >
      <div className="flex items-center gap-1.5 text-fd-muted-foreground">
        <span
          className="size-2.5 rounded-full"
          style={{ background: h.color }}
        />
        <AlignLeft className="size-3" strokeWidth={1.5} />
        <span className="ms-auto rounded-sm bg-fd-muted px-1.5 tabular-nums">
          {m.annot_view_page({ page: h.page })}
        </span>
      </div>
      <blockquote
        className="mt-1.5 border-s-2 ps-2 leading-snug text-fd-foreground"
        style={{ borderColor: h.color }}
      >
        {h.text}
      </blockquote>
      {h.comment && <p className="mt-1.5 leading-snug">{h.comment}</p>}
      {h.tag && <p className="mt-1 text-fd-muted-foreground">#{h.tag}</p>}
    </li>
  );
}

/** How long each frame of the loop shows, in ms; the last is the finished frame. */
const FRAMES = [2200, 5000];

export default function ReadReplica() {
  const ref = useRef<HTMLDivElement>(null);
  // Four highlights; the reader marks the blue passage and its card appears.
  const frame = useLoop(ref, FRAMES);
  const added = frame === 1;
  const p = paper("sandve2013");
  const cards = SANDVE_HIGHLIGHTS.filter((h) => h !== NEW || added);
  const [green, yellow, red, purple] = SANDVE_HIGHLIGHTS;
  return (
    <div ref={ref}>
      <ReplicaWindow
        icon={FileText}
        title="Sandve et al. - 2013 - Ten Simple Rules for Reproducible Computational Research.pdf"
        label={`${p.title}, ${m.annot_view_name()}: ${SANDVE_HIGHLIGHTS.map((h) => h.text).join(" ")}`}
      >
        <div className="grid @2xl:grid-cols-[minmax(0,1fr)_minmax(0,17rem)]">
          <div className="bg-fd-muted p-4 @md:p-6">
            <div className="mx-auto grid max-w-[34rem] gap-3 rounded-sm bg-white p-5 text-[11.5px] leading-[1.55] text-[#1b2029] shadow-ring @md:p-7">
              <p className="font-serif text-[16px] leading-snug font-semibold">
                {p.title}
              </p>
              <p className="text-[10.5px] text-[#5f6672]">
                Geir Kjetil Sandve, Anton Nekrutenko, James Taylor, Eivind Hovig
              </p>
              <div className="grid gap-4 @md:grid-cols-2">
                <div className="grid content-start gap-1.5">
                  <Lines widths={[100, 96, 100, 88]} />
                  <p>
                    … <Marked h={green!} /> <Marked h={yellow!} />
                  </p>
                  <Lines widths={[100, 92, 70]} />
                </div>
                <div className="grid content-start gap-1.5">
                  <p>
                    <Marked h={red!} />
                  </p>
                  <Lines widths={[100, 94]} />
                  <p className="font-semibold">
                    <Marked h={purple!} />
                  </p>
                  <p>
                    … <Marked h={NEW} on={added} />
                  </p>
                  <Lines widths={[100, 84]} />
                </div>
              </div>
            </div>
          </div>
          <div className="max-@2xl:border-t border-fd-border @2xl:border-s">
            <div className="flex items-center gap-2 border-b border-fd-border px-3 py-2 text-[12.5px] text-fd-muted-foreground">
              <span className="font-medium text-fd-foreground">
                {m.annot_view_name()}
              </span>
              <Search className="ms-auto size-3.5" strokeWidth={1.5} />
              <Palette className="size-3.5" strokeWidth={1.5} />
              <Tag className="size-3.5" strokeWidth={1.5} />
            </div>
            <p className="px-3 pt-2 text-[11.5px] text-fd-muted-foreground tabular-nums">
              {m.annot_view_filter_count({
                shown: String(cards.length),
                total: String(cards.length),
              })}
            </p>
            <ul className="grid gap-2 p-3">
              {SANDVE_HIGHLIGHTS.map((h) => (
                <Card
                  key={h.text}
                  h={h}
                  selected={added && h === NEW}
                  hidden={h === NEW && !added}
                />
              ))}
            </ul>
          </div>
        </div>
      </ReplicaWindow>
    </div>
  );
}
