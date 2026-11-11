// Job 4, "Take literature notes": the note ZotLit writes for Sandve et al.
// 2013 under the Default profile, drawn from the renderer's real output
// (rendered-note.ts) as Live Preview shows it: the properties (the Workbench's
// real PropertyList), the title, the Zotero link, and the Annotations query
// block as live annotation cards. The loop picks the paper in the quick
// switcher first.

import { FileText, NotebookPen, Search } from "lucide-react";
import { Fragment, useRef } from "react";

import { cn } from "@/lib/cn";
import { m } from "@/paraglide/messages.js";

import { NoteProperties } from "./note-properties";
import { SANDVE_HIGHLIGHTS, byline, paper } from "./papers";
import { RENDERED_NOTE } from "./rendered-note";
import { useLoop } from "./use-loop";
import { ReplicaWindow } from "./window";

/** The note body's blocks: headings, the link line, and the query block. */
function blocks(body: string) {
  return body
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
}

function NoteBody() {
  return (
    <div className="grid gap-3 p-4 @md:px-8 @md:py-6">
      <NoteProperties />
      {blocks(RENDERED_NOTE.body).map((b) => {
        if (b.startsWith("## "))
          return (
            <p key={b} className="font-serif text-[17px] font-medium">
              {b.slice(3)}
            </p>
          );
        if (b.startsWith("# "))
          return (
            <p
              key={b}
              className="font-serif text-[21px] leading-snug font-medium"
            >
              {b.slice(2)}
            </p>
          );
        if (b.startsWith("```zotquery"))
          return (
            <ul key="query" className="grid gap-2 @lg:grid-cols-2">
              {SANDVE_HIGHLIGHTS.slice(0, 4).map((h) => (
                <li
                  key={h.text}
                  className="rounded-md px-3 py-2 text-[12px] ring-1 ring-fd-border"
                >
                  <blockquote
                    className="border-s-2 ps-2 leading-snug"
                    style={{ borderColor: h.color }}
                  >
                    {h.text}
                  </blockquote>
                  <p className="mt-1 text-fd-muted-foreground tabular-nums">
                    {m.annot_view_page({ page: h.page })}
                    {h.comment && ` · ${h.comment}`}
                  </p>
                </li>
              ))}
            </ul>
          );
        // The link line: [Zotero](zotero://…) and the PDF links.
        return (
          <p key={b} className="text-[13.5px]">
            {[...b.matchAll(/\[([^\]]+)\]\([^)]+\)/g)].map((link, i) => (
              <Fragment key={link[0]}>
                {i > 0 && " "}
                <span className="text-fd-primary underline decoration-fd-primary/40 underline-offset-2">
                  {link[1]}
                </span>
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function Switcher() {
  const p = paper("sandve2013");
  return (
    <div className="p-4 @md:p-8">
      <div className="mx-auto max-w-[30rem] overflow-hidden rounded-lg bg-fd-card text-[13px] shadow-ring">
        <div className="flex items-center gap-2 border-b border-fd-border px-3 py-2.5">
          <Search
            className="size-3.5 text-fd-muted-foreground"
            strokeWidth={1.5}
          />
          <span>sandve</span>
          <span className="h-4 w-px bg-fd-foreground motion-safe:animate-pulse" />
        </div>
        <div className="flex gap-2.5 bg-fd-accent px-3 py-2.5">
          <FileText
            className="mt-0.5 size-3.5 shrink-0 text-fd-muted-foreground"
            strokeWidth={1.5}
          />
          <div className="min-w-0">
            <p className="truncate font-medium">{p.title}</p>
            <p className="text-[12px] text-fd-muted-foreground">
              {byline(p)}, <span className="italic">{p.venue}</span>
            </p>
          </div>
        </div>
        <div className="flex gap-4 border-t border-fd-border px-3 py-1.5 text-[11.5px] text-fd-muted-foreground">
          <span>
            <kbd className="font-mono">↵</kbd> {m.instruction_open_lit_note()}
          </span>
          <span>
            <kbd className="font-mono">⇧↵</kbd> {m.instruction_open_pdf()}
          </span>
        </div>
      </div>
    </div>
  );
}

/** How long each frame of the loop shows, in ms; the last is the finished frame. */
const FRAMES = [1800, 5200];

export default function NotesReplica() {
  const ref = useRef<HTMLDivElement>(null);
  // Pick the paper; the note is written.
  const frame = useLoop(ref, FRAMES);
  const written = frame === 1;
  return (
    <div ref={ref}>
      <ReplicaWindow
        icon={NotebookPen}
        title={`${RENDERED_NOTE.filename}.md`}
        label={`${RENDERED_NOTE.filename}.md: ${paper("sandve2013").title}`}
      >
        {/* Both frames share one cell, so the window keeps its height through the loop. */}
        <div className="grid *:[grid-area:1/1]">
          <div className={cn(!written && "invisible")}>
            <NoteBody />
          </div>
          <div className={cn(written && "invisible")}>
            <Switcher />
          </div>
        </div>
      </ReplicaWindow>
    </div>
  );
}
