// Job 7, "Export and submit": the "Export with citations" dialog on the draft,
// then the Word document it writes, with formatted citations and the
// reference list. Replica of apps/obsidian/src/views/pandoc-export/modal.ts.

import { ChevronDown, FileOutput } from "lucide-react";
import { useRef } from "react";

import { cn } from "@/lib/cn";
import { m } from "@/paraglide/messages.js";

import { DraftBody } from "./draft";
import { DRAFT, REFERENCES } from "./papers";
import { useLoop } from "./use-loop";
import { ReplicaWindow } from "./window";

const STYLE = "Chicago Manual of Style 17th edition (author-date)";

function Field({
  name,
  desc,
  value,
}: {
  name: string;
  desc?: string;
  value: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-fd-border py-2.5">
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{name}</p>
        {desc && <p className="text-[12px] text-fd-muted-foreground">{desc}</p>}
      </div>
      <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md border border-fd-border px-2 py-1 text-[12.5px]">
        <span className="truncate">{value}</span>
        <ChevronDown
          className="size-3.5 shrink-0 text-fd-muted-foreground"
          strokeWidth={1.5}
        />
      </span>
    </div>
  );
}

function Dialog() {
  return (
    <div className="grid place-items-center bg-fd-foreground/5 p-4 @md:p-8">
      <div className="w-full max-w-[28rem] rounded-xl bg-fd-card p-4 shadow-ring">
        <p className="pb-3 text-[15px] font-semibold">
          {m.pandoc_export_title()}
        </p>
        <Field
          name={m.pandoc_export_format_name()}
          desc={m.pandoc_export_format_desc()}
          value={m.pandoc_export_format_docx()}
        />
        <Field
          name={m.pandoc_export_style_name()}
          desc={m.pandoc_export_style_from_note()}
          value={STYLE}
        />
        <Field
          name={m.pandoc_export_destination_name()}
          value={`Exports/${DRAFT}.docx`}
        />
        <div className="flex justify-end gap-2 border-t border-fd-border pt-3">
          <span className="rounded-md border border-fd-border px-3 py-1.5 text-[13px]">
            {m.modal_cancel()}
          </span>
          <span className="rounded-md bg-fd-primary px-3 py-1.5 text-[13px] font-medium text-fd-primary-foreground">
            {m.pandoc_export_confirm()}
          </span>
        </div>
      </div>
    </div>
  );
}

function WordPage() {
  return (
    <div className="bg-fd-muted p-4 @md:p-8">
      <div className="mx-auto grid max-w-[36rem] gap-4 rounded-sm bg-white p-6 text-[#1b2029] shadow-ring @md:p-9">
        <DraftBody plain className="font-serif text-[14px]" />
        <div>
          <p className="font-serif text-[15px] font-semibold">References</p>
          <ul className="mt-2 grid gap-2 font-serif text-[12.5px] leading-snug">
            {Object.entries(REFERENCES).map(([k, r]) => (
              <li key={k} className="ps-5 -indent-5">
                {r.lead} {r.title} <span className="italic">{r.venue}</span>{" "}
                {r.rest}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** How long each frame of the loop shows, in ms; the last is the finished frame. */
const FRAMES = [2400, 5000];

export default function ExportReplica() {
  const ref = useRef<HTMLDivElement>(null);
  // The dialog, then the document it writes.
  const frame = useLoop(ref, FRAMES);
  const done = frame === 1;
  return (
    <div ref={ref}>
      <ReplicaWindow
        icon={FileOutput}
        title={done ? `${DRAFT}.docx` : `${DRAFT}.md`}
        label={`${m.pandoc_export_title()}: ${DRAFT}.docx, ${STYLE}`}
      >
        <div className="grid *:[grid-area:1/1]">
          <div className={cn(!done && "invisible")}>
            <WordPage />
          </div>
          <div className={cn(done && "invisible")}>
            <Dialog />
          </div>
        </div>
      </ReplicaWindow>
    </div>
  );
}
