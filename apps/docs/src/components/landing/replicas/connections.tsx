// Job 6, "See how your sources connect": the draft beside the References
// sidebar, which lists what the chapter cites in its citation style. The loop
// steps through the references; each marks where the draft cites it.
// Replica of apps/obsidian/src/views/references/.

import {
  BookType,
  ChevronRight,
  ClipboardCopy,
  ListOrdered,
} from "lucide-react";
import { useRef } from "react";

import { cn } from "@/lib/cn";
import { m } from "@/paraglide/messages.js";

import { DraftBody } from "./draft";
import { DRAFT, REFERENCES } from "./papers";
import { useLoop } from "./use-loop";
import { ReplicaWindow } from "./window";

const KEYS = Object.keys(REFERENCES);

/** How long each frame of the loop shows, in ms; the last is the finished frame. */
const FRAMES = [1800, 1800, 1800, 4000];

export default function ConnectionsReplica() {
  const ref = useRef<HTMLDivElement>(null);
  // Step through each reference, then rest on the whole list.
  const frame = useLoop(ref, FRAMES);
  const active = KEYS[frame] ?? null;
  return (
    <div ref={ref}>
      <ReplicaWindow
        icon={ListOrdered}
        title={`${DRAFT}.md`}
        label={`${DRAFT}, ${m.references_view_name()}: ${KEYS.map((k) => REFERENCES[k]!.lead).join("; ")}`}
      >
        <div className="grid @2xl:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
          <DraftBody active={active} className="p-4 @md:px-8 @md:py-6" />
          <div className="max-@2xl:border-t border-fd-border @2xl:border-s">
            <div className="flex items-center gap-2 border-b border-fd-border px-3 py-2 text-[12.5px] text-fd-muted-foreground">
              <span className="font-medium text-fd-foreground">
                {m.references_view_name()}
              </span>
              <ClipboardCopy className="ms-auto size-3.5" strokeWidth={1.5} />
              <BookType className="size-3.5" strokeWidth={1.5} />
            </div>
            <ol className="grid gap-1 p-2 text-[12.5px] leading-snug">
              {KEYS.map((k) => {
                const r = REFERENCES[k]!;
                return (
                  <li
                    key={k}
                    className={cn(
                      "flex gap-1.5 rounded-md p-2 transition-colors duration-150 ease-out",
                      active === k && "bg-fd-accent",
                    )}
                  >
                    <p className="min-w-0 flex-1 ps-4 -indent-4">
                      {r.lead} {r.title}{" "}
                      <span className="italic">{r.venue}</span> {r.rest}
                    </p>
                    <ChevronRight
                      className="mt-0.5 size-3.5 shrink-0 text-fd-muted-foreground"
                      strokeWidth={1.5}
                    />
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </ReplicaWindow>
    </div>
  );
}
