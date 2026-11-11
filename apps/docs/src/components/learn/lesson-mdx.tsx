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
// A step's strip name, title and picture text come from the lesson's
// frontmatter by `n`. The page renders every part in order, so the
// prerendered HTML reads as one whole lesson; `LessonView` then shows one step
// at a time. The Markdown edition binds the same parts to the lesson through
// `lessonMarkdownComponents`.

import { asMarkdown, md } from "fumadocs-core/server";
import { Children, isValidElement, use, useId, useState } from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import * as m from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";

import { LessonContext } from "./lesson-state";
import type { LessonStepMeta } from "./lesson-state";
import { stepMedia, StepPicture } from "./step-picture";

/**
 * Before the page runs, CSS alone shows one part: the one the hash targets,
 * or the cover. A reader without JavaScript has no `data-lesson-js` on the
 * root element and reads every part in order.
 */
export const preHydration = {
  /** A step or the end: hidden unless the hash targets it. */
  part: "[html[data-lesson-js]_[data-lesson]:not([data-ready])_&]:hidden [html[data-lesson-js]_[data-lesson]:not([data-ready])_&:target]:grid",
  /** Controls that only work with JavaScript. */
  scripted:
    "[html:not([data-lesson-js])_[data-lesson]:not([data-ready])_&]:hidden",
  /** Shown to a reader without JavaScript, hidden while the page starts. */
  unscripted: "[html[data-lesson-js]_[data-lesson]:not([data-ready])_&]:hidden",
};

export const labelClass =
  "font-mono text-[11px] leading-tight font-medium tracking-[0.08em] text-fd-muted-foreground uppercase";

/** Caption text: sans 19px, each ZotLit label as a UI chip. */
const captionClass =
  "text-[19px] leading-normal [&_code]:rounded-sm [&_code]:bg-fd-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.84em] [&_p+p]:mt-3 [&_strong]:rounded-[5px] [&_strong]:bg-fd-muted [&_strong]:px-1.5 [&_strong]:py-px [&_strong]:text-[0.94em] [&_strong]:font-semibold [&_strong]:[box-decoration-break:clone]";

export const buttonClass = {
  primary:
    "min-h-[46px] cursor-pointer rounded-[10px] bg-fd-foreground px-5 py-3 font-semibold text-fd-background transition-[background-color,scale] duration-150 hover:bg-fd-foreground/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring active:scale-[0.98]",
  accent:
    "min-h-[46px] cursor-pointer rounded-[10px] bg-fd-primary px-5 py-3 font-semibold text-fd-primary-foreground transition-[background-color,scale] duration-150 hover:bg-fd-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring active:scale-[0.98]",
  quiet:
    "min-h-[46px] cursor-pointer rounded-[10px] px-5 py-3 font-semibold text-fd-muted-foreground shadow-[inset_0_0_0_1px_var(--color-fd-border)] transition-colors duration-150 hover:bg-fd-card hover:text-fd-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring",
};

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
    <div className="flex items-start gap-2.5 rounded-[10px] bg-check-bg px-3.5 py-3 text-[17px] leading-normal text-check [&_strong]:font-semibold">
      <span aria-hidden>✓</span>
      <div className="[&>p+p]:mt-2">{children}</div>
    </div>
  );
}

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
      <div className="text-[17px] leading-normal [&>p+p]:mt-2">{children}</div>
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
  const shown = lesson.at === null || lesson.at === n;

  return (
    <section
      id={String(n)}
      data-part="step"
      aria-labelledby={`step-${n}-title`}
      hidden={!shown}
      className={cn(
        "grid gap-4.5 motion-safe:animate-lesson-in",
        lesson.at === null &&
          "not-first-of-type:border-t not-first-of-type:border-fd-border not-first-of-type:pt-8",
        preHydration.part,
      )}
    >
      <div>
        <p className={labelClass}>
          {m.docs_learn_step_label({ number: n, total })}
        </p>
        <h2
          id={`step-${n}-title`}
          tabIndex={-1}
          className="mt-1.5 font-serif text-[30px] leading-[1.15] font-medium tracking-[-0.01em] text-balance outline-none"
        >
          {meta.title}
        </h2>
      </div>
      <StepPicture
        media={lesson.media}
        n={n}
        alt={meta.alt}
        active={lesson.at === n}
      />
      <div className={captionClass}>{caption}</div>
      {check}
      {figure}
      <StepActions
        n={n}
        total={total}
        go={lesson.go}
        ready={lesson.at !== null}
      >
        {fixes}
      </StepActions>
    </section>
  );
}

function StepActions({
  n,
  total,
  go,
  ready,
  children,
}: {
  n: number;
  total: number;
  go: (at: number) => void;
  ready: boolean;
  children: ReactNode[];
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();

  return (
    <>
      <div className={cn("flex flex-wrap gap-2.5", preHydration.scripted)}>
        <button
          type="button"
          className={buttonClass.primary}
          onClick={() => go(n + 1)}
        >
          {n === total ? m.docs_learn_finish() : m.docs_learn_next()}
        </button>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          className={buttonClass.quiet}
          onClick={() => setOpen(!open)}
        >
          {m.docs_learn_something_else()}
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
    </>
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
