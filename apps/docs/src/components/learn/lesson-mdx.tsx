// The parts a lesson body is written in: `<Step n>` with its caption, one
// `<Check>`, an optional `<Figure>` and any `<Fix title>`.
//
//   <Step n={1}>
//   In Obsidian, open **Settings** … select <UiLabel name={m.…()} />.
//
//   <Check>A tab named <UiLabel name={m.library_view_name()} /> opens.</Check>
//
//   <Fix title="No tab opened">Select the ZotLit icon in the ribbon …</Fix>
//   </Step>
//
// A step's title and picture text come from the lesson's frontmatter by `n`.
// The page renders every step as one row of the checklist, each with its
// whole text, so the prerendered HTML reads as one whole lesson; once the page
// runs, `LessonView` keeps one row open at a time. The Markdown edition binds
// the same parts to the lesson through `lessonMarkdownComponents`.

import { asMarkdown, md } from "fumadocs-core/server";
import {
  ArrowDown,
  Check as CheckIcon,
  ChevronDown,
  CircleCheck,
  Eye,
} from "lucide-react";
import { Children, isValidElement, use, useId, useState } from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import * as m from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";

import { LessonContext, nextOpenStep } from "./lesson-state";
import type { LessonState, LessonStepMeta } from "./lesson-state";
import { stepMedia, StepPicture } from "./step-picture";

/**
 * Before the page runs, CSS alone opens one row: the one the hash targets. A
 * reader without JavaScript has no `data-lesson-js` on the root element and
 * reads every row open, in order.
 */
export const preHydration = {
  /** A row's body: hidden unless the hash targets its row. */
  body: "[html[data-lesson-js]_[data-lesson]:not([data-ready])_&]:hidden [html[data-lesson-js]_[data-lesson]:not([data-ready])_:target>&]:grid",
  /** The row the hash targets, drawn as the open row. */
  target:
    "[html[data-lesson-js]_[data-lesson]:not([data-ready])_&:target]:my-3 [html[data-lesson-js]_[data-lesson]:not([data-ready])_&:target]:rounded-[14px] [html[data-lesson-js]_[data-lesson]:not([data-ready])_&:target]:border-transparent [html[data-lesson-js]_[data-lesson]:not([data-ready])_&:target]:bg-fd-card [html[data-lesson-js]_[data-lesson]:not([data-ready])_&:target]:p-4 [html[data-lesson-js]_[data-lesson]:not([data-ready])_&:target]:shadow-ring",
  /** Controls that only work with JavaScript. */
  scripted:
    "[html:not([data-lesson-js])_[data-lesson]:not([data-ready])_&]:hidden",
  /** Shown to a reader without JavaScript, hidden while the page starts. */
  unscripted: "[html[data-lesson-js]_[data-lesson]:not([data-ready])_&]:hidden",
};

export const labelClass =
  "font-mono text-[11px] leading-tight font-medium tracking-[0.08em] text-fd-muted-foreground uppercase";

/** Action text: sans 18px, each ZotLit label as a UI chip, links in the accent text tone. */
const captionClass =
  "text-lg leading-normal [&_a]:rounded-sm [&_a]:font-medium [&_a]:text-fd-primary [&_a]:underline [&_a]:decoration-fd-primary/40 [&_a]:underline-offset-4 [&_a]:hover:decoration-fd-primary [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-offset-2 [&_a]:focus-visible:outline-fd-ring [&_code]:rounded-sm [&_code]:bg-fd-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.84em] [&_p+p]:mt-3 [&>:not(:first-child)]:mt-3 [&_strong]:rounded-[5px] [&_strong]:bg-fd-muted [&_strong]:px-1.5 [&_strong]:py-px [&_strong]:text-[0.94em] [&_strong]:font-semibold [&_strong]:[box-decoration-break:clone]";

export const buttonClass =
  "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] bg-fd-foreground px-5 py-2.5 font-semibold text-fd-background transition-[background-color,scale] duration-150 hover:bg-fd-foreground/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring motion-safe:active:scale-[0.96]";

/** The secondary action: the raised surface with the shadow ring. */
const secondaryButtonClass =
  "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-transparent bg-fd-background px-5 py-2.5 font-semibold text-fd-foreground shadow-ring transition-[box-shadow,scale] duration-150 hover:shadow-ring-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring motion-safe:active:scale-[0.96]";

export const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring";

/**
 * A bold lead-in and its text as one Markdown paragraph. MDX wraps a part's
 * text in a paragraph when it spans lines, so the text is folded back first.
 */
async function leadIn(lead: ReactNode, children: ReactNode) {
  const [label, text] = await Promise.all([md`${lead}`, md`${children}`]);
  // The edition slices prose from the authored source, so a formatter's
  // `{" "}` between two inline elements arrives as text; it stands for a space.
  const line = (value: string) =>
    value
      .replaceAll('{" "}', " ")
      .replaceAll(/\s*\n\s*/g, " ")
      .trim();
  // A label inside the bold lead-in would close the bold early.
  return `\n**${line(label).replaceAll("**", "")}:** ${line(text)}\n\n`;
}

/** What the reader sees when the step worked. */
export function Check({ children }: { children: ReactNode }) {
  if (asMarkdown()) return leadIn(m.docs_learn_md_check(), children);
  return (
    <div className="grid gap-1.5 rounded-[10px] bg-check-bg px-3.5 py-3 text-[17px] leading-normal text-check [&_strong]:font-semibold">
      <p className={cn(labelClass, "flex items-center gap-1.5 text-check")}>
        <Eye aria-hidden strokeWidth={1.5} className="size-3.5" />
        {m.docs_learn_check_label()}
      </p>
      <div className={oneLine}>{children}</div>
    </div>
  );
}

/**
 * A check or fix is one sentence or two. When a formatter wraps it, MDX splits
 * it into paragraphs at a label on a line of its own, so the paragraphs run on
 * as one line of text.
 */
const oneLine = "[&>p]:inline [&>p+p]:before:content-['_']";

/** One likely failure: what the reader sees, then what to do. */
export function Fix({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  if (asMarkdown()) return leadIn(title, children);
  return (
    <div className="grid gap-1.5">
      <h3 className="text-[17px] leading-snug font-semibold">{title}</h3>
      <div className={cn("text-[17px] leading-normal", oneLine)}>
        {children}
      </div>
    </div>
  );
}

/** A view beside the step's picture, such as a small table. */
export function Figure({ children }: { children: ReactNode }) {
  if (asMarkdown()) return md`${children}`;
  return (
    <div className="text-[16.5px] [&_table]:my-0 [&_table]:w-full [&_table]:border-collapse [&_td]:border-t [&_td]:border-fd-border [&_td]:py-2.5 [&_td]:pe-2.5 [&_td]:align-top [&_th]:pe-2.5 [&_th]:pb-2 [&_th]:text-start [&_th]:font-mono [&_th]:text-[11px] [&_th]:font-medium [&_th]:tracking-[0.08em] [&_th]:text-fd-muted-foreground [&_th]:uppercase [&>div]:my-0 [&>div]:overflow-x-auto [&>div]:rounded-none [&>div]:border-0 [&>div]:bg-transparent">
      {children}
    </div>
  );
}

function ofType(type: unknown) {
  return (node: ReactNode) => isValidElement(node) && node.type === type;
}

export function Step({ n, children }: { n: number; children: ReactNode }) {
  if (asMarkdown()) return md`${children}`;

  const lesson = use(LessonContext);
  const meta = lesson?.steps[n - 1];
  if (!lesson || !meta) {
    throw new Error(`<Step n={${n}}> has no entry in the lesson's steps.`);
  }
  const total = lesson.steps.length;
  const nodes = Children.toArray(children);
  const check = nodes.filter(ofType(Check));
  const figure = nodes.filter(ofType(Figure));
  const fixes = nodes.filter(ofType(Fix));
  const caption = nodes.filter(
    (node) =>
      !check.includes(node) && !figure.includes(node) && !fixes.includes(node),
  );
  const { live } = lesson;
  const open = live === null || live.open === n;
  const ticked = live?.ticks.has(n) ?? false;
  const labelId = `step-${n}-label`;
  const titleId = `step-${n}-title`;
  const bodyId = `step-${n}-body`;

  const heading = (
    <>
      <span
        id={labelId}
        className={cn(
          labelClass,
          "block",
          live?.open === n && !ticked && "text-fd-primary",
        )}
      >
        {m.docs_learn_step_label({ number: n, total })}
      </span>
      <span
        id={titleId}
        className={cn(
          "mt-0.5 block text-lg leading-snug text-balance",
          ticked ? "text-fd-muted-foreground" : "font-semibold",
        )}
      >
        {meta.title}
      </span>
    </>
  );

  return (
    <li
      id={String(n)}
      className={cn(
        "scroll-mt-[calc(var(--fd-banner-height,0px)+5rem)]",
        live?.open === n
          ? "my-3 rounded-[14px] border border-transparent bg-fd-card p-4 shadow-ring"
          : "border-b border-fd-border px-1 py-3",
        live === null && preHydration.target,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "relative mt-0.5 grid size-7 shrink-0 place-items-center",
            preHydration.scripted,
          )}
        >
          <input
            type="checkbox"
            checked={ticked}
            disabled={live === null}
            onChange={(event) => live?.tick(n, event.target.checked)}
            aria-labelledby={`${labelId} ${titleId}`}
            className={cn(
              "peer size-7 cursor-pointer appearance-none rounded-lg bg-fd-card shadow-[inset_0_0_0_1.5px_var(--color-fd-muted-foreground)] transition-[background-color,box-shadow] duration-150 checked:bg-check-label checked:shadow-none hover:shadow-[inset_0_0_0_1.5px_var(--color-fd-foreground)] checked:hover:shadow-none",
              focusClass,
            )}
          />
          <CheckIcon
            aria-hidden
            strokeWidth={3}
            className="pointer-events-none absolute size-4 text-fd-background opacity-0 peer-checked:opacity-100"
          />
        </span>
        <h2 className="min-w-0 flex-1">
          {live ? (
            <button
              id={`step-${n}-toggle`}
              type="button"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => live.toggle(n)}
              className={cn(
                "flex w-full cursor-pointer items-start gap-3 rounded-sm text-start",
                focusClass,
              )}
            >
              <span className="min-w-0 flex-1">{heading}</span>
              <ChevronDown
                aria-hidden
                strokeWidth={1.5}
                className={cn(
                  "mt-2 size-5 shrink-0 text-fd-muted-foreground motion-safe:transition-transform motion-safe:duration-150",
                  open && "rotate-180",
                )}
              />
            </button>
          ) : (
            heading
          )}
        </h2>
      </div>
      <div
        id={bodyId}
        hidden={!open}
        className={cn(
          "mt-3 grid min-w-0 gap-4 [overflow-wrap:anywhere] motion-safe:animate-lesson-in min-[561px]:ps-10",
          live === null && preHydration.body,
        )}
      >
        <div className={captionClass}>{caption}</div>
        {/* From `xl` the media panel beside the checklist shows this picture instead. */}
        <div className="empty:hidden [html[data-lesson-js]_&]:xl:hidden">
          <StepPicture
            media={lesson.media}
            n={n}
            alt={meta.alt}
            active={live?.open === n && !live.wide}
          />
        </div>
        {check}
        {figure}
        <StepFixes
          ready={live !== null}
          action={live && <TickAction n={n} total={total} live={live} />}
        >
          {fixes}
        </StepFixes>
      </div>
    </li>
  );
}

/** Moves focus to row `n`'s title, or to the end, once the row it left has closed. */
function focusPart(n: number, total: number) {
  requestAnimationFrame(() => {
    const id = n > total ? "done" : `step-${n}-toggle`;
    document.getElementById(id)?.focus({ preventScroll: true });
  });
}

/** The open row's tick in place: "Tick step N", or "Ticked" and the way on once it is ticked. */
function TickAction({
  n,
  total,
  live,
}: {
  n: number;
  total: number;
  live: NonNullable<LessonState["live"]>;
}) {
  if (!live.ticks.has(n)) {
    return (
      <button
        type="button"
        onClick={() => focusPart(live.tick(n, true), total)}
        className={buttonClass}
      >
        <CheckIcon aria-hidden strokeWidth={3} className="size-4" />
        {m.docs_learn_tick_step({ number: n })}
      </button>
    );
  }
  const next = nextOpenStep(live.ticks, n, total) ?? total + 1;
  return (
    <>
      <span className="inline-flex items-center gap-1.5 text-base font-semibold text-check-label">
        <CircleCheck aria-hidden strokeWidth={2.25} className="size-[18px]" />
        {m.docs_learn_ticked()}
      </span>
      <button
        type="button"
        onClick={() => {
          live.go(next);
          focusPart(next, total);
        }}
        className={secondaryButtonClass}
      >
        {next > total
          ? m.docs_learn_see_end()
          : m.docs_learn_go_to_step({ number: next })}
        <ArrowDown aria-hidden strokeWidth={2.25} className="size-4" />
      </button>
    </>
  );
}

/** "Not what you see?": a disclosure that holds the step's fixes, after the row's tick in place. */
function StepFixes({
  ready,
  action,
  children,
}: {
  ready: boolean;
  action: ReactNode;
  children: ReactNode[];
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();

  return (
    <div className="grid gap-3">
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-5 gap-y-3",
          preHydration.scripted,
        )}
      >
        {action}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => setOpen(!open)}
          className={cn(
            "inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-sm text-base text-fd-muted-foreground underline decoration-1 underline-offset-4 transition-colors duration-150 hover:text-fd-foreground",
            focusClass,
          )}
        >
          {m.docs_learn_not_what_you_see()}
          <ChevronDown
            aria-hidden
            strokeWidth={1.5}
            className={cn(
              "size-4 motion-safe:transition-transform motion-safe:duration-150",
              open && "rotate-180",
            )}
          />
        </button>
      </div>
      <div
        id={panel}
        hidden={ready && !open}
        className={cn(
          "grid gap-3 rounded-[10px] bg-fd-accent p-3.5 motion-safe:animate-lesson-in",
          preHydration.unscripted,
        )}
      >
        {/* The button names the panel on a running page; without JavaScript
            the panel is always open and this heading names it. */}
        <h3 className={cn(labelClass, ready && "sr-only")}>
          {m.docs_learn_fix_heading()}
        </h3>
        {children}
        <p className="text-[17px]">
          <a
            href={localizeHref("/community")}
            className="font-medium text-fd-primary underline decoration-fd-primary/40 underline-offset-[3px] hover:decoration-fd-primary"
          >
            {children.length > 0
              ? m.docs_learn_ask_none_of_these()
              : m.docs_learn_ask()}
          </a>
        </p>
      </div>
    </div>
  );
}

/** The lesson's parts for its Markdown edition, each step bound to its frontmatter entry. */
export function lessonMarkdownComponents(lesson: {
  media: string;
  steps: LessonStepMeta[];
}) {
  function MarkdownStep({ n, children }: { n: number; children: ReactNode }) {
    asMarkdown();
    const meta = lesson.steps[n - 1];
    if (!meta)
      throw new Error(`<Step n={${n}}> has no entry in the lesson's steps.`);
    const entry = stepMedia(lesson.media, n);
    const picture = entry ? `![${meta.alt}](${entry.base}.webp)\n\n` : "";
    return md`\n## ${m.docs_learn_step_label({ number: n, total: lesson.steps.length })}. ${meta.title}\n\n${picture}${children}\n\n`;
  }
  return { Step: MarkdownStep, Check, Fix, Figure };
}
