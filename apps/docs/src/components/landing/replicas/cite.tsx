// Job 5, "Cite while you write": the landing's one "try it" moment. The page
// prints the finished frame — the draft with Sandve et al. 2013 cited at page
// 2 — and loads the working draft (try-cite.tsx) only when the section comes
// near, in the same frame, so nothing moves when it arrives.
// @see apps/docs/DESIGN.md → Illustration (try one moment)

import { NotebookPen, RotateCcw } from "lucide-react";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Message } from "@/components/message";
import { m } from "@/paraglide/messages.js";

import { DRAFT, DRAFT_TEXT, chicagoCite, paper } from "./papers";
import { ReplicaWindow } from "./window";

const TryCite = lazy(() => import("./try-cite"));

/** The sentence the visitor finishes: the one the "Cite while you write" walk types. */
export const SENTENCE = DRAFT_TEXT[1]![0] as string;

/** The draft around the line the visitor writes: its title and first paragraph. */
export function DraftFrame({ line }: { line: ReactNode }) {
  const first = DRAFT_TEXT[0]!;
  return (
    <div className="relative grid min-h-[22rem] content-start gap-3 p-4 text-[15px] leading-relaxed @md:px-8 @md:py-6">
      <p className="font-serif text-[20px] leading-snug font-medium">{DRAFT}</p>
      <p className="text-fd-muted-foreground">
        {first.map((run, i) =>
          typeof run === "string" ? (
            run
          ) : (
            // oxlint-disable-next-line react/no-array-index-key -- a fixed paragraph
            <span key={i} className="text-(--zt-cite)">
              {chicagoCite(paper(run.key), run.page)}
            </span>
          ),
        )}
      </p>
      <div>{line}</div>
    </div>
  );
}

export function TryHint() {
  return (
    <Message
      text={m.docs_home_try_hint({ trigger: "{trigger}" })}
      slots={{
        trigger: (
          <kbd className="rounded-sm border border-fd-border bg-fd-muted px-1 font-mono text-[0.9em] text-fd-foreground">
            [@
          </kbd>
        ),
      }}
    />
  );
}

/**
 * The row under the window: the hint, or the next step, and the reset button.
 * The still draws it too, with the button held invisible, so the working
 * draft arrives without moving anything.
 */
export function TryFooter({
  message,
  onReset,
}: {
  message: ReactNode;
  onReset?: () => void;
}) {
  return (
    <div className="mt-3 flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p aria-live="polite" className="text-[14px] text-fd-foreground">
        {message}
      </p>
      <button
        type="button"
        onClick={onReset}
        disabled={!onReset}
        className="inline-flex h-11 items-center gap-1.5 rounded-[10px] border border-transparent bg-fd-card px-4 text-[14px] font-semibold shadow-ring transition-[box-shadow,scale] duration-150 ease-out not-disabled:hover:shadow-ring-hover disabled:invisible motion-safe:not-disabled:active:scale-96"
      >
        <RotateCcw aria-hidden className="size-4" strokeWidth={2.25} />
        {m.docs_home_try_reset()}
      </button>
    </div>
  );
}

/** The finished frame: what the page shows before the working draft loads, and without JavaScript. */
function Still() {
  return (
    <>
      <ReplicaWindow
        icon={NotebookPen}
        title={`${DRAFT}.md`}
        label={`${DRAFT}: ${SENTENCE}${chicagoCite(paper("sandve2013"), "2")}.`}
      >
        <DraftFrame
          line={
            <p>
              {SENTENCE}
              <span className="text-(--zt-cite)">
                {chicagoCite(paper("sandve2013"), "2")}
              </span>
              .
            </p>
          }
        />
      </ReplicaWindow>
      <TryFooter message={<TryHint />} />
    </>
  );
}

export default function CiteReplica() {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "100% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref}>
      <p className="mb-3 font-mono text-[11px] font-medium tracking-[0.08em] text-fd-primary uppercase">
        {m.docs_home_try_label()}
      </p>
      {near ? (
        <Suspense fallback={<Still />}>
          <TryCite />
        </Suspense>
      ) : (
        <Still />
      )}
    </div>
  );
}
