// Job 8, "Make it yours": the Template Workbench with the Default profile's
// real note template on the left and, on the right, the note preview ZotLit's
// renderer produced from it for Sandve et al. 2013 (rendered-note.ts), its
// properties drawn as the Workbench draws them. A still: the template
// and the note it makes, side by side.

import { Braces, SlidersHorizontal } from "lucide-react";
import { Fragment } from "react";

import { cn } from "@/lib/cn";
import { m } from "@/paraglide/messages.js";

import { NoteProperties } from "./note-properties";
import { RENDERED_NOTE } from "./rendered-note";
import { ReplicaWindow } from "./window";

/** The template body: what follows the profile's manifest, up to the annotation template. */
const TEMPLATE = RENDERED_NOTE.source
  .split(/^---$/m)[2]!
  .trim()
  .split("```zotquery")[0]!
  .trim();

/** One template line, its Liquid tags in the accent text tone. */
function TemplateLine({ line }: { line: string }) {
  const parts = line.split(/(\{\{.*?\}\}|\{%.*?%\})/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\{[{%]/.test(p) ? (
          // oxlint-disable-next-line react/no-array-index-key -- parts of one fixed line
          <span key={i} className="rounded-sm bg-fd-accent text-fd-primary">
            {p}
          </span>
        ) : (
          // oxlint-disable-next-line react/no-array-index-key -- parts of one fixed line
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

const TABS = [
  m.workbench_tab_note,
  m.workbench_tab_properties,
  m.workbench_tab_name_and_folder,
  m.workbench_tab_annotation,
];

export default function CustomiseReplica() {
  const title = RENDERED_NOTE.body.split("\n")[0]!.replace(/^# /, "");
  return (
    <ReplicaWindow
      icon={SlidersHorizontal}
      title={m.workbench_title()}
      label={`${m.workbench_title()}: ${m.workbench_tab_note()}, ${m.workbench_result_heading()}: ${title}`}
    >
      <div className="grid @2xl:grid-cols-2">
        <div className="min-w-0 p-3">
          <div className="flex flex-wrap gap-1 pb-2">
            {TABS.map((t, i) => (
              <span
                key={t()}
                className={cn(
                  "rounded-md px-2 py-1 text-[12px]",
                  i === 0
                    ? "bg-fd-muted font-medium text-fd-foreground"
                    : "text-fd-muted-foreground",
                )}
              >
                {t()}
              </span>
            ))}
            <span className="ms-auto inline-flex items-center gap-1 rounded-md border border-fd-border px-2 py-1 text-[12px] text-fd-muted-foreground">
              <Braces className="size-3.5" strokeWidth={1.5} />
              {m.workbench_fields_heading()}
            </span>
          </div>
          <pre className="overflow-x-auto rounded-md border border-fd-border bg-fd-background p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
            {TEMPLATE.split("\n").map((line, i) => (
              // oxlint-disable-next-line react/no-array-index-key -- lines of a fixed template
              <Fragment key={i}>
                <TemplateLine line={line} />
                {"\n"}
              </Fragment>
            ))}
            <span className="text-fd-muted-foreground">```zotquery …```</span>
          </pre>
        </div>
        <div className="max-@2xl:border-t min-w-0 border-fd-border p-3 @2xl:border-s">
          <p className="pb-2 text-[13px] font-semibold">
            {m.workbench_result_heading()}
          </p>
          <p className="pb-2 font-mono text-[11.5px] text-fd-muted-foreground">
            {m.workbench_result_filename()}: {RENDERED_NOTE.filename}.md
          </p>
          <NoteProperties />
          <p className="font-serif text-[18px] leading-snug font-medium">
            {title}
          </p>
          <p className="mt-2 text-[13px]">
            <span className="text-fd-primary underline decoration-fd-primary/40 underline-offset-2">
              Zotero
            </span>
          </p>
        </div>
      </div>
    </ReplicaWindow>
  );
}
