// A lesson step's picture: the still, or the recording of the step when one
// exists and the page asks for it.
//
// Every picture prerenders its still, so a reader without JavaScript gets
// every picture. Only an active picture mounts its player (`Recording`), so
// only its clip loads; a picture with autoplay off shows the still with a play
// button until the reader plays it. The still is the step's poster when the
// build found one, the step's screenshot otherwise.

import { DocsImage } from "@/components/docs-image";
import { Recording } from "@/components/recording";
import { cn } from "@/lib/cn";
import type { StepMedia } from "@/lib/learn-media";

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
  autoplay = true,
  thumb = false,
}: {
  media: string;
  n: number;
  alt: string;
  /** The page runs and wants this step's recording. */
  active: boolean;
  /** The recording plays on its own while it crosses the middle of the window. */
  autoplay?: boolean;
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
  const still = (
    <DocsImage
      src={entry.still.src}
      width={entry.still.width}
      height={entry.still.height}
      alt={alt}
      loading={thumb ? "lazy" : undefined}
      className={thumb ? "max-h-none!" : "max-h-full object-contain"}
    />
  );

  return (
    <div
      className={cn(
        "relative flex justify-center overflow-hidden rounded-[10px] border border-transparent bg-fd-card shadow-ring",
        thumb ? "items-start" : "max-h-[min(70vh,560px)] items-center",
      )}
      style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
    >
      {active && entry.clip && !thumb ? (
        <Recording
          // A player starts in its autoplay mode, so a change of mode remounts it.
          key={`${entry.base}:${autoplay}`}
          base={entry.base}
          webm={entry.clip.webm}
          mp4={entry.clip.mp4}
          poster={entry.still.src}
          alt={alt}
          fit="contain"
          preload={autoplay ? "auto" : "metadata"}
          autoplay={autoplay}
          fallback={still}
        />
      ) : (
        still
      )}
    </div>
  );
}
