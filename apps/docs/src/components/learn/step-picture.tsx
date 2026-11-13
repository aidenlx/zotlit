// A lesson step's picture: the still, or the recording of the step when one
// exists and the step is on screen.
//
// Every step prerenders its still, so a reader without JavaScript gets every
// picture. Only the current step mounts its `<video>`, so only its clip loads.
// The clip loops muted and pauses while it is out of view; with reduced
// motion it rests on its poster, the still, until the reader plays it.

import { Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { DocsImage } from "@/components/docs-image";
import { cn } from "@/lib/cn";
import type { StepMedia } from "@/lib/learn-media";
import * as m from "@/paraglide/messages.js";

/** The media the build found for one step, or undefined when it has none yet. */
export function stepMedia(media: string, n: number) {
  const key = `${media}/step-${n}`;
  const entry: StepMedia | undefined = __LEARN_MEDIA__[key];
  return entry && { ...entry, base: `/img/learn/${key}` };
}

export function StepPicture({
  media,
  n,
  alt,
  active,
  className,
}: {
  media: string;
  n: number;
  alt: string;
  /** The step is on screen in a running page. */
  active: boolean;
  className?: string;
}) {
  const entry = stepMedia(media, n);
  if (!entry) return null;
  // A clip and its still can differ in shape; the frame takes the clip's, so
  // the picture does not jump when the clip replaces the still.
  const frame = entry.clip?.size ?? entry;

  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-[10px] bg-fd-card shadow-ring",
        className,
      )}
      style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
    >
      {active && entry.clip ? (
        <StepClip base={entry.base} clip={entry.clip} alt={alt} />
      ) : (
        <DocsImage
          src={`${entry.base}.webp`}
          width={entry.width}
          height={entry.height}
          alt={alt}
          className="max-h-full object-contain"
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
  clip,
  alt,
}: {
  base: string;
  clip: NonNullable<StepMedia["clip"]>;
  alt: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  // This mounts after hydration only, so the preference is safe to read here.
  const [still] = useState(prefersReducedMotion);
  const [playing, setPlaying] = useState(!still);

  // Play while the clip is in view and the reader wants it moving.
  useEffect(() => {
    const video = ref.current;
    if (!video || !playing) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void video.play().catch(() => {});
      else video.pause();
    });
    observer.observe(video);
    return () => {
      observer.disconnect();
      video.pause();
    };
  }, [playing]);

  return (
    <>
      <video
        ref={ref}
        aria-label={alt}
        poster={`${base}.webp`}
        muted
        loop
        playsInline
        preload={still ? "none" : "auto"}
        controls={still && playing}
        className="size-full object-contain"
      >
        {clip.webm && <source src={`${base}.webm`} type="video/webm" />}
        {clip.mp4 && <source src={`${base}.mp4`} type="video/mp4" />}
      </video>
      {!playing && (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="absolute inset-0 m-auto flex size-16 items-center justify-center rounded-full bg-fd-foreground/85 text-fd-background transition-colors hover:bg-fd-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring"
        >
          <Play aria-hidden strokeWidth={2.25} className="ms-1 size-7" />
          <span className="sr-only">{m.docs_learn_play()}</span>
        </button>
      )}
    </>
  );
}
