// The landing's first screen: the headline, the supporting line and actions
// on a research desk (see ./desk). The text and the desk render as static
// HTML in their final state; the objects drop onto the desk once on load
// (CSS, motion on only), and from 1280px they drift with a fine pointer.
//
// The drift writes `translate` on each object's own layer in one animation
// frame, and reads the hero's box in the pointer handler, so a frame lays out
// once and no inherited property changes under the hero.
// @see apps/docs/DESIGN.md → Landing (Hero)

import { useEffect, useRef } from "react";

import { Message } from "@/components/message";
import { m } from "@/paraglide/messages.js";

import { Desk, DeskStack } from "./desk";
import { Actions, Highlighter } from "./parts";

export function Hero() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const layers = [...el.querySelectorAll<HTMLElement>("[data-depth]")];
    let raf = 0;
    let x = 0;
    let y = 0;
    const apply = () => {
      raf = 0;
      for (const layer of layers) {
        const z = Number(layer.dataset["depth"]);
        layer.style.translate = `${(x * z * -7).toFixed(2)}px ${(y * z * -5).toFixed(2)}px`;
      }
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const move = (e: PointerEvent) => {
      if (!fine.matches || still.matches) return;
      const r = el.getBoundingClientRect();
      x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      y = ((e.clientY - r.top) / r.height - 0.5) * 2;
      queue();
    };
    const leave = () => {
      x = 0;
      y = 0;
      queue();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section
      ref={ref}
      aria-labelledby="landing-title"
      // The desk is designed at 1440 × 832 and scales in steps with the
      // window; the text scales with it. The hero fills the viewport below
      // the nav and the banner, between 720px and the desk's height, and
      // grows with its text when a larger font needs the room.
      className="relative overflow-hidden [--desk-s:1] min-[1280px]:max-[1360px]:[--desk-s:0.88] min-[1360px]:max-[1440px]:[--desk-s:0.94] min-[1800px]:[--desk-s:1.08] xl:flex xl:min-h-[max(720px,min(calc(100svh-56px-var(--fd-banner-height,0px)),calc(832px*var(--desk-s))))] xl:flex-col"
    >
      <Desk />
      <div className="relative z-20 mx-auto flex max-w-[640px] flex-col items-center px-4 pt-9 text-center sm:px-8 xl:w-full xl:max-w-none xl:flex-1 xl:justify-center xl:px-0 xl:pt-0 xl:pb-[110px]">
        <div className="flex w-full max-w-[640px] flex-col items-center xl:[zoom:var(--desk-s)]">
          <p className="font-mono text-[0.6875rem] font-medium tracking-[0.1em] text-fd-muted-foreground uppercase sm:text-xs sm:tracking-[0.14em]">
            {m.docs_home_eyebrow()}
          </p>
          <h1
            id="landing-title"
            className="mt-4 font-serif text-[2.6rem] leading-[1.06] font-medium tracking-[-0.02em] text-balance text-fd-foreground sm:text-6xl"
          >
            <Message
              text={m.docs_home_title({ mark: "{mark}" })}
              slots={{
                mark: <Highlighter>{m.docs_home_title_mark()}</Highlighter>,
              }}
            />
          </h1>
          <p className="mt-5 max-w-[34rem] text-lg text-pretty text-fd-muted-foreground sm:text-xl">
            {m.docs_home_lede()}
          </p>
          <Actions className="mt-7" />
          <p className="mt-4 text-sm text-fd-muted-foreground">
            {m.docs_home_requirements()}
          </p>
        </div>
      </div>
      <DeskStack />
    </section>
  );
}
