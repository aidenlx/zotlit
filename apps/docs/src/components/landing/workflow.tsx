// "From Zotero to finished chapter.": the research sequence as five steps in
// a zig-zag, each with a recording of the real app beside its text.
//
// Each recording prerenders as its still, the poster. After mount, a step
// whose case has a clip mounts its player (`Recording`) once it comes near
// the viewport; the player owns playback, seeking and reduced motion.
// @see apps/docs/DESIGN.md → Landing (Workflow)

import { useEffect, useRef, useState } from "react";

import { DocsImage } from "@/components/docs-image";
import { Recording as RecordingPlayer } from "@/components/recording";
import { m } from "@/paraglide/messages.js";

import { LessonLink } from "./parts";

type Text = () => string;

/** The recordings under public/img/landing/, in step order. */
type Case = "find" | "read" | "note" | "cite" | "word";

/** Which cases have a clip (`.webm` and `.mp4`); the others show their still. */
const CLIPS: Readonly<Record<Case, boolean>> = {
  find: true,
  read: true,
  note: true,
  cite: true,
  word: false,
};

interface Step {
  id: Case;
  title: Text;
  line: Text;
  /** A requirement worth knowing before the step. */
  note?: Text;
  alt: Text;
  /** The `/learn` lesson that walks through the step. */
  lesson: string;
  /** The text of the link to that lesson. */
  link: Text;
}

const STEPS: readonly Step[] = [
  {
    id: "find",
    title: m.docs_home_flow_find,
    line: m.docs_home_flow_find_line,
    alt: m.docs_home_flow_find_alt,
    lesson: "connect-zotero-to-obsidian",
    link: m.docs_home_flow_find_link,
  },
  {
    id: "read",
    title: m.docs_home_flow_read,
    line: m.docs_home_flow_read_line,
    alt: m.docs_home_flow_read_alt,
    lesson: "annotate-zotero-pdfs-in-obsidian",
    link: m.docs_home_flow_read_link,
  },
  {
    id: "note",
    title: m.docs_home_flow_note,
    line: m.docs_home_flow_note_line,
    alt: m.docs_home_flow_note_alt,
    lesson: "connect-zotero-to-obsidian",
    link: m.docs_home_flow_note_link,
  },
  {
    id: "cite",
    title: m.docs_home_flow_cite,
    line: m.docs_home_flow_cite_line,
    note: m.docs_home_flow_cite_note,
    alt: m.docs_home_flow_cite_alt,
    lesson: "cite-in-obsidian-with-zotero",
    link: m.docs_home_flow_cite_link,
  },
  {
    id: "word",
    title: m.docs_home_flow_word,
    line: m.docs_home_flow_word_line,
    alt: m.docs_home_flow_word_alt,
    lesson: "export-obsidian-to-word-with-citations",
    link: m.docs_home_flow_word_link,
  },
];

/** The 16:10 frame every recording fills. */
function Recording({ id, alt }: { id: Case; alt: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const base = `/img/landing/${id}`;

  // Mount the player once the frame comes near the viewport.
  useEffect(() => {
    const el = frame.current;
    if (!el || !CLIPS[id]) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setNear(true);
        io.disconnect();
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [id]);

  const still = (
    <DocsImage
      src={`${base}.webp`}
      width={1600}
      height={1000}
      alt={alt}
      loading="lazy"
      className="size-full object-cover"
    />
  );
  return (
    <div
      ref={frame}
      className="relative aspect-[16/10] overflow-hidden rounded-xl border border-transparent bg-fd-card shadow-ring"
    >
      {near ? (
        <RecordingPlayer
          base={base}
          webm
          mp4
          poster={`${base}.webp`}
          alt={alt}
          fit="cover"
          preload="metadata"
          fallback={still}
        />
      ) : (
        still
      )}
    </div>
  );
}

function StepItem({ step, n, flip }: { step: Step; n: number; flip: boolean }) {
  return (
    <li className="relative grid items-center gap-8 lg:grid-cols-2 lg:gap-24">
      {/* The step's number on the connecting line, from 1024px. */}
      <span
        aria-hidden
        className="absolute top-1/2 left-1/2 hidden size-9 -translate-1/2 items-center justify-center rounded-full border border-fd-border bg-fd-background font-mono text-sm text-fd-primary tabular-nums lg:flex"
      >
        {n}
      </span>
      <div className={flip ? "lg:order-2" : undefined}>
        <Recording id={step.id} alt={step.alt()} />
      </div>
      <div
        className={
          flip ? "max-w-xl lg:order-1 lg:justify-self-end" : "max-w-xl"
        }
      >
        <h3 className="font-serif text-3xl leading-[1.2] font-medium text-balance sm:text-4xl">
          {step.title()}
        </h3>
        <p className="mt-4 text-lg text-pretty text-fd-muted-foreground">
          {step.line()}
        </p>
        {step.note && (
          <p className="mt-4 rounded-[10px] bg-fd-muted px-4 py-3 text-base text-fd-muted-foreground">
            {step.note()}
          </p>
        )}
        <div className="mt-6">
          <LessonLink lesson={step.lesson} label={step.link()} />
        </div>
      </div>
    </li>
  );
}

export function Workflow() {
  return (
    <section
      aria-labelledby="landing-flow-title"
      className="border-t border-fd-border bg-fd-card/40 py-20 sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2
            id="landing-flow-title"
            className="font-serif text-3xl leading-[1.2] font-medium text-balance sm:text-5xl sm:leading-[1.15]"
          >
            {m.docs_home_flow_title()}
          </h2>
        </div>
        <div className="relative mt-16 sm:mt-20">
          <span
            aria-hidden
            className="absolute inset-y-0 left-1/2 hidden w-px -translate-x-1/2 bg-fd-border lg:block"
          />
          <ol className="relative grid gap-20 lg:gap-32">
            {STEPS.map((s, i) => (
              <StepItem key={s.id} step={s} n={i + 1} flip={i % 2 === 1} />
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
