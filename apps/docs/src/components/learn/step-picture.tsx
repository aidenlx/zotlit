// A lesson step's picture: the still, or the recording of the step when one
// exists and the page asks for it.
//
// Every picture prerenders its still, so a reader without JavaScript gets
// every picture. Only an active picture mounts its `<video>`, so only its clip
// loads. The clip loops muted while it crosses the middle of the viewport, one
// loop at a time; with reduced motion it rests on its poster until the reader
// plays it. The still is the step's poster when the build found one, the
// step's screenshot otherwise.

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { DocsImage } from "@/components/docs-image";
import { endTurn, takeTurn } from "@/components/landing/loop";
import { cn } from "@/lib/cn";
import type { StepMedia } from "@/lib/learn-media";
import * as m from "@/paraglide/messages.js";

/** The media the build found for one step, or undefined when it has none yet. */
export function stepMedia(media: string, n: number) {
  const key = `${media}/step-${n}`;
  const entry: StepMedia | undefined = __LEARN_MEDIA__[key];
  if (!entry) return undefined;
  const base = `/img/learn/${key}`;
  const still = entry.poster
    ? { src: `${base}.poster.webp`, ...entry.poster }
    : { src: `${base}.webp`, width: entry.width, height: entry.height };
  return { ...entry, base, still };
}

export function StepPicture({
  media,
  n,
  alt,
  active,
  thumb = false,
}: {
  media: string;
  n: number;
  alt: string;
  /** The page runs and wants this step's recording. */
  active: boolean;
  /** A card's picture: the still in a window-shaped frame, cropped from its top. */
  thumb?: boolean;
}) {
  const entry = stepMedia(media, n);
  if (!entry) return null;
  // A clip and its still can differ in shape; the frame takes the clip's, so
  // the picture does not jump when the clip replaces the still.
  const frame = thumb
    ? { width: 1440, height: 860 }
    : (entry.clip?.size ?? entry.still);

  return (
    <div
      className={cn(
        "relative flex justify-center overflow-hidden rounded-[10px] border border-transparent bg-fd-card shadow-ring",
        thumb ? "items-start" : "max-h-[min(70vh,560px)] items-center",
      )}
      style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
    >
      {active && entry.clip && !thumb ? (
        <StepClip
          base={entry.base}
          poster={entry.still.src}
          clip={entry.clip}
          alt={alt}
        />
      ) : (
        <DocsImage
          src={entry.still.src}
          width={entry.still.width}
          height={entry.still.height}
          alt={alt}
          loading={thumb ? "lazy" : undefined}
          className={thumb ? "max-h-none!" : "max-h-full object-contain"}
        />
      )}
    </div>
  );
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function StepClip({
  base,
  poster,
  clip,
  alt,
}: {
  base: string;
  poster: string;
  clip: NonNullable<StepMedia["clip"]>;
  alt: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  // This mounts after hydration only, so the preference is safe to read here.
  const [still] = useState(prefersReducedMotion);
  // "auto" plays in the middle of the viewport; "manual" plays from the
  // reader's press until it leaves the viewport; "paused" stays still.
  const [mode, setMode] = useState<"auto" | "manual" | "paused">(
    still ? "paused" : "auto",
  );
  // The video's own state, which the button shows.
  const [playing, setPlaying] = useState(false);
  const [me] = useState(() => Symbol(base));

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (mode === "paused") {
      video.pause();
      return;
    }
    const rest = () => video.pause();
    const play = () => {
      takeTurn(me, rest);
      void video.play().catch(() => {});
    };
    if (mode === "manual") play();
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) {
          rest();
          endTurn(me);
        } else if (mode === "auto") {
          play();
        }
      },
      mode === "auto" ? { rootMargin: "-40% 0px -40% 0px" } : undefined,
    );
    observer.observe(video);
    return () => {
      observer.disconnect();
      rest();
      endTurn(me);
    };
  }, [mode, me]);

  function press() {
    const video = ref.current;
    if (!video) return;
    if (!video.paused) {
      setMode("paused");
      video.pause();
      return;
    }
    // A change of mode plays through the effect; within "manual", play here.
    if (mode !== "manual") {
      setMode("manual");
      return;
    }
    takeTurn(me, () => video.pause());
    void video.play().catch(() => {});
  }

  const Icon = playing ? Pause : Play;
  return (
    <>
      <video
        ref={ref}
        aria-label={alt}
        poster={poster}
        muted
        loop
        playsInline
        preload={still ? "none" : "auto"}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="size-full object-contain"
      >
        {clip.webm && <source src={`${base}.webm`} type="video/webm" />}
        {clip.mp4 && <source src={`${base}.mp4`} type="video/mp4" />}
      </video>
      <button
        type="button"
        onClick={press}
        aria-label={playing ? m.docs_learn_pause() : m.docs_learn_play()}
        className="absolute end-2.5 bottom-2.5 flex size-9 items-center justify-center rounded-full border border-transparent bg-fd-card text-fd-foreground shadow-ring transition-[box-shadow] duration-150 ease-out hover:shadow-ring-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
      >
        <Icon aria-hidden strokeWidth={2.25} className="size-4" />
      </button>
    </>
  );
}
