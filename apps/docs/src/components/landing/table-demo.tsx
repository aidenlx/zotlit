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
// (./loop), and a button beside the caption trail pauses it on the finished
// frame. The 768px split (the tree, the tool labels, the three columns
// phones leave out) is CSS, so the server and the client agree.
// @see apps/docs/DESIGN.md → Landing (Compare your papers)

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { m } from "@/paraglide/messages.js";

import { endTurn, takeTurn } from "./loop";
import { LessonLink, LoopToggle, SectionLabel } from "./parts";
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
  const [paused, setPaused] = useState(false);
  const figure = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  /** At least half the demo is on screen. */
  const inView = useRef(false);
  const [flip] = useState(makeFlip);
  const [me] = useState(() => Symbol("table demo"));

  /** Rests on the finished frame: paused, or another loop took the turn. */
  const rest = () => {
    setActive(false);
    setStep(FINAL);
    setFading(false);
  };
  /** Starts a cycle from the collection. */
  const play = () => {
    takeTurn(me, rest);
    setStep(0);
    setFading(false);
    setCycle((c) => c + 1);
    setActive(true);
  };
  const toggle = () => {
    if (paused) {
      setPaused(false);
      if (inView.current) play();
      else setStep(0);
    } else {
      setPaused(true);
      endTurn(me);
      rest();
    }
  };

  // Plays while at least half the demo is on screen; off screen it waits at
  // the collection. A paused demo stays on the finished frame.
  const onView = useEffectEvent((entry: IntersectionObserverEntry) => {
    if (entry.intersectionRatio >= 0.5) {
      if (inView.current) return;
      inView.current = true;
      if (!paused) play();
    } else if (!entry.isIntersecting) {
      if (inView.current) {
        inView.current = false;
        endTurn(me);
        setActive(false);
      }
      if (!paused) {
        setStep(0);
        setFading(false);
      }
    }
  });

  useEffect(() => {
    const el = figure.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(([entry]) => entry && onView(entry), {
      threshold: [0, 0.5],
    });
    io.observe(el);
    return () => {
      io.disconnect();
      endTurn(me);
    };
  }, [me]);

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
      <div className="mt-4 flex items-start gap-4">
        <Trail
          step={step}
          cycle={cycle}
          playing={active}
          className="min-w-0 flex-1"
        />
        <LoopToggle
          paused={paused}
          onToggle={toggle}
          pauseLabel={m.docs_home_table_pause()}
          playLabel={m.docs_home_table_play()}
          className="shrink-0"
        />
      </div>
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
            className="mt-4 font-serif text-3xl leading-[1.2] font-medium text-balance sm:text-5xl sm:leading-[1.15]"
          >
            {m.docs_home_table_title()}
          </h2>
          <p className="mt-6 text-lg text-pretty text-fd-muted-foreground">
            {m.docs_home_table_lede()}
          </p>
          <div className="mt-4">
            <LessonLink
              lesson="literature-review-table-from-zotero"
              label={m.docs_home_table_link()}
            />
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
