// The landing page: the hero with Figure 1, the eight job sections beside the
// contents column, and the setup section. Past the hero, the desk shrinks into
// the contents column (from 1024px, with motion on); below 1024px a bar of the
// eight objects takes the column's place.
//
// The scroll handler writes the phase (hero, moving, docked) on the page
// element and the progress `--desk-p` on each element that reads it, in one
// animation frame, so the hero desk, the moving copy and the docked desk hand
// over in the same frame and React stays idle while the page scrolls. It reads
// every position before it writes, so the frame lays out once; `--desk-p` is
// not inherited, so a write restyles only its readers. Without JavaScript the page reads
// as a document: the contents column shows its list, and every jump is an
// anchor link.
// @see apps/docs/DESIGN.md → Landing

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  Contents,
  DockedDesk,
  MovingDesk,
  PhoneBar,
  readCurrentJob,
  setCurrentJob,
} from "./contents";
import { DeskSprite } from "./desk";
import { Hero } from "./hero";
import { JobSection } from "./job-section";
import { JOBS } from "./jobs";
import { Setup } from "./setup";

/** The shared home nav's height: it sticks at the viewport top (src/layouts/home/slots/header.tsx). */
const HEADER = 56;
/** px from the viewport top where the contents column sticks: 32px below the nav. */
const STICKY = HEADER + 32;
/** The hero desk starts to shrink once its top passes this line: 16px below the nav. */
const START = HEADER + 16;

const clamp = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function LandingPage({
  repo,
  footer,
}: {
  /** The repository link with its live counters, beside the licence line. */
  repo: ReactNode;
  footer: ReactNode;
}) {
  const page = useRef<HTMLDivElement>(null);
  const heroSlot = useRef<HTMLDivElement>(null);
  const heroFigure = useRef<HTMLElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const dockSlot = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const [morph, setMorph] = useState(false);

  // The moving copy exists only from 1024px with motion on.
  useEffect(() => {
    const mq = window.matchMedia(
      "(min-width: 1024px) and (prefers-reduced-motion: no-preference)",
    );
    const sync = () => setMorph(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const root = page.current;
    if (!root) return;
    const bar = root.querySelector<HTMLElement>("[data-landing-bar]");
    const wide = window.matchMedia("(min-width: 1024px)");
    let raf = 0;
    let lastP = "";
    let lastWidth = "";
    const update = () => {
      raf = 0;
      // Reads first: the job in view and every position this frame needs.
      const job = readCurrentJob();
      const hs = heroSlot.current;
      const g = grid.current;
      if (!hs || !g) return setCurrentJob(job);
      if (!wide.matches) {
        const fig = heroFigure.current;
        const show = !!fig && fig.getBoundingClientRect().bottom < 0;
        root.toggleAttribute("data-bar", show);
        if (bar) bar.inert = !show;
        root.dataset["phase"] = "hero";
        return setCurrentJob(job);
      }
      const hr = hs.getBoundingClientRect();
      const gr = g.getBoundingClientRect();
      const el = layer.current;
      const dr =
        morph && el ? dockSlot.current?.getBoundingClientRect() : undefined;
      // Writes.
      root.removeAttribute("data-bar");
      if (bar) bar.inert = true;
      // p: 0 while the hero desk's top is above START, 1 once the job column reaches the sticky line.
      const start = START + hr.height + (gr.top - hr.bottom);
      const p = clamp((start - gr.top) / Math.max(1, start - STICKY));
      const pText = p.toFixed(4);
      if (pText !== lastP) {
        lastP = pText;
        for (const n of root.querySelectorAll<HTMLElement | SVGElement>(
          "[data-desk-p]",
        ))
          n.style.setProperty("--desk-p", pText);
      }
      const phase =
        p <= 0 ? "hero" : p >= 1 ? "docked" : morph ? "moving" : "hero";
      if (root.dataset["phase"] !== phase) root.dataset["phase"] = phase;
      if (el && dr) {
        // The desk narrows to the column width over the first 55% of the way,
        // so it never covers the text scrolling up beside it.
        const e = smoothstep(p);
        const es = smoothstep(clamp(p / 0.55));
        const s = lerp(1, dr.width / hr.width, es);
        const right = lerp(hr.right, dr.right, es);
        const top = lerp(hr.top, dr.top, e);
        const width = `${hr.width}px`;
        if (width !== lastWidth) {
          lastWidth = width;
          el.style.width = width;
        }
        el.style.transform = `translate3d(${right - hr.width * s}px, ${top}px, 0) scale(${s})`;
      }
      // Last: a new job in view re-renders the desks.
      setCurrentJob(job);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(raf);
    };
  }, [morph]);

  return (
    <div
      ref={page}
      data-morph={morph ? "" : undefined}
      className="group/landing flex w-full flex-1 flex-col overflow-x-clip"
    >
      <DeskSprite />
      <PhoneBar />
      <div className="mx-auto w-full max-w-[1304px] px-4 sm:px-8">
        <Hero slotRef={heroSlot} figureRef={heroFigure} />
        <div
          ref={grid}
          className="mt-16 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-x-16"
        >
          <aside className="max-lg:hidden lg:col-start-2 lg:row-start-1">
            <div className="sticky pb-10" style={{ top: STICKY }}>
              <div
                ref={dockSlot}
                className="transition-[opacity,visibility] duration-150 ease-out group-data-[morph]/landing:transition-none group-data-[phase=hero]/landing:invisible group-data-[phase=hero]/landing:opacity-0 group-data-[phase=moving]/landing:invisible group-data-[phase=moving]/landing:opacity-0"
              >
                <DockedDesk />
              </div>
              <div
                data-desk-p=""
                className="mt-6 transition-[opacity,visibility] duration-150 ease-out group-data-[morph]/landing:opacity-(--desk-p) group-data-[morph]/landing:transition-none group-data-[phase=hero]/landing:invisible group-data-[phase=hero]/landing:opacity-0"
              >
                <Contents />
              </div>
            </div>
          </aside>
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            {JOBS.map((j, i) => (
              <JobSection key={j.id} job={j} index={i} />
            ))}
          </div>
        </div>
        <Setup repo={repo} />
        {footer}
      </div>
      {morph && (
        <div
          ref={layer}
          aria-hidden
          className="pointer-events-none invisible fixed top-0 left-0 z-30 origin-top-left group-data-[phase=moving]/landing:visible"
        >
          <MovingDesk />
        </div>
      )}
    </div>
  );
}
