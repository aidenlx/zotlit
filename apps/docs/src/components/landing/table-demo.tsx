// "Compare your papers side by side.": the collection-to-table demo. In the
// Library View, the Reproducibility collection is saved as a query file; it
// opens as a table whose column tracks are reserved from the first frame and
// fill in place, left to right; the rows sort by year; then the reader's
// rating is typed for the two papers that have a literature note, while the
// two without one show "No note" and offer Create. The window is drawn in
// ./table-window.
//
// The page prerenders the finished frame, which is also what reduced motion
// shows. After mount, with motion on, the demo rewinds to the collection and
// plays while at least half of it is on screen, one cycle after another; it
// rewinds again once it has left the screen. One loop plays at a time
// (./loop). The 768px split (the tree, the tool labels, the three columns
// phones leave out) is CSS, so the server and the client agree.
// @see apps/docs/DESIGN.md → Landing (Compare your papers)

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { m } from "@/paraglide/messages.js";

import { endTurn, takeTurn } from "./loop";
import { LessonLink, SectionLabel } from "./parts";
import { DemoWindow, FINAL, Trail, makeFlip } from "./table-window";

/** The beats: [ms from the cycle start, step]. */
const TIMELINE: readonly (readonly [number, number])[] = [
  [2000, 1],
  [2650, 2],
  [3900, 3],
  [4250, 4],
  [5900, 5],
  [6450, 6],
  [7050, 7],
  [7650, 8],
  [8250, 9],
  [9700, 10],
  [10200, 11],
  [12000, 12],
  [12650, 13],
  [13200, 14],
  [13750, 15],
  [14300, 16],
  [14950, FINAL],
];
/** The cycle's length; the stage fades out over its last 650 ms. */
const END = 19800;

function Demo() {
  const [step, setStep] = useState(FINAL);
  const [cycle, setCycle] = useState(0);
  const [fading, setFading] = useState(false);
  const [active, setActive] = useState(false);
  const figure = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [flip] = useState(makeFlip);

  // With motion on, rewind to the collection, play while at least half the
  // demo is on screen, and rewind again once it has left the screen.
  useEffect(() => {
    const el = figure.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const me = Symbol("table demo");
    let seen = false;
    // Another loop took the turn: rest on the finished frame.
    const rest = () => {
      setActive(false);
      setStep(FINAL);
      setFading(false);
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.intersectionRatio >= 0.5) {
          if (seen) return;
          seen = true;
          takeTurn(me, rest);
          setStep(0);
          setFading(false);
          setCycle((c) => c + 1);
          setActive(true);
        } else if (!entry.isIntersecting) {
          // Off screen, on load or after a cycle: wait at the collection.
          if (seen) {
            seen = false;
            endTurn(me);
            setActive(false);
          }
          setStep(0);
          setFading(false);
        }
      },
      { threshold: [0, 0.5] },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      endTurn(me);
    };
  }, []);

  useLayoutEffect(() => {
    flip.play(stage.current);
  }, [flip, step]);

  useEffect(() => {
    if (!active) return;
    const ids = TIMELINE.map(([t, s]) =>
      window.setTimeout(() => {
        flip.snap(stage.current);
        setStep(s);
      }, t),
    );
    ids.push(window.setTimeout(() => setFading(true), END - 650));
    ids.push(
      window.setTimeout(() => {
        setStep(0);
        setFading(false);
        setCycle((c) => c + 1);
      }, END),
    );
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [flip, active, cycle]);

  return (
    <figure ref={figure} className="relative">
      <div aria-hidden>
        <DemoWindow step={step} fading={fading} stageRef={stage} />
      </div>
      <figcaption className="sr-only">{m.docs_home_table_alt()}</figcaption>
      <Trail step={step} cycle={cycle} playing={active} />
    </figure>
  );
}

const POINTS = [
  [m.docs_home_table_point_zotero, m.docs_home_table_point_zotero_line],
  [m.docs_home_table_point_yours, m.docs_home_table_point_yours_line],
  [m.docs_home_table_point_unread, m.docs_home_table_point_unread_line],
] as const;

export function TableDemo() {
  return (
    <section
      aria-labelledby="landing-table-title"
      className="border-t border-fd-border py-20 sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <div className="max-w-2xl">
          <SectionLabel>{m.docs_home_table_label()}</SectionLabel>
          <h2
            id="landing-table-title"
            className="mt-3 font-serif text-3xl font-medium text-balance sm:text-5xl"
          >
            {m.docs_home_table_title()}
          </h2>
          <p className="mt-4 text-lg text-pretty text-fd-muted-foreground">
            {m.docs_home_table_lede()}
          </p>
          <div className="mt-4">
            <LessonLink lesson="literature-review-table-from-zotero" />
          </div>
        </div>
        <div className="mt-10 sm:mt-12">
          <Demo />
        </div>
        <ul className="mt-8 grid gap-x-10 gap-y-4 text-base sm:grid-cols-3">
          {POINTS.map(([lead, line]) => (
            <li
              key={lead()}
              className="border-t border-fd-border pt-4 text-pretty"
            >
              <strong className="font-semibold text-fd-foreground">
                {lead()}
              </strong>{" "}
              <span className="text-fd-muted-foreground">{line()}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
