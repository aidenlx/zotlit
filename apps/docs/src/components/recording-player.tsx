// A recording in a Video.js player: play, seek, time and fullscreen, and no volume control because the clips are silent.
// It plays in the middle of the viewport one at a time, in a loop or once, obeys the reader once they play or pause, and rests under reduced motion.
// A clip that plays once ends on its last frame, dimmed, under a replay button and any actions its page adds.
// @see apps/docs/DESIGN.md → Illustration (The recording player)

import {
  bufferFeature,
  Container,
  Controls,
  controlsFeature,
  createPlayer,
  FullscreenButton,
  fullscreenFeature,
  Hotkey,
  I18nProvider,
  PlayButton,
  playbackFeature,
  sourceFeature,
  StatusAnnouncer,
  Time,
  TimeSlider,
  timeFeature,
} from "@videojs/react";
import { Video } from "@videojs/react/video";
import { Maximize, Minimize, Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import {
  askTurn,
  awaitTurn,
  endTurn,
  holdTurn,
  stopWaiting,
  takeTurn,
} from "@/components/recording-turn";
import { cn } from "@/lib/cn";
import * as m from "@/paraglide/messages.js";
import { getLocale } from "@/paraglide/runtime.js";

const { Player } = createPlayer({
  features: [
    playbackFeature,
    timeFeature,
    sourceFeature,
    bufferFeature,
    fullscreenFeature,
    controlsFeature,
  ],
});

export interface RecordingPlayerProps {
  /** The path of the clip's MP4 without its extension. */
  base: string;
  poster: string;
  /** What the recording shows, which names the player. */
  alt: string;
  /** How the clip fills its frame. */
  fit: "contain" | "cover";
  /** How much of the clip loads before it plays, with motion on. */
  preload: "auto" | "metadata";
  /**
   * Plays the clip in a loop; false plays it once, then rests it on its last
   * frame, dimmed, under a replay button, until the reader plays it again.
   * @default true
   */
  loop?: boolean;
  /** Controls the dimmed last frame shows before the replay button, for a clip that plays once. */
  endActions?: ReactNode;
  /** The reader asked for this clip with a press elsewhere, so it plays at once, as if they had pressed play (not under reduced motion). */
  playNow?: boolean;
}

/** The URL a clip plays from: the media store's in a deployed build, the site path otherwise. @see src/lib/media-store.ts */
const videoSrc = (path: string) => __MEDIA_URLS__[path] ?? path;

const buttonClass =
  "group/button grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-fd-foreground transition-[background-color,scale] duration-150 ease-out hover:bg-fd-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring motion-safe:active:scale-[0.96]";

/** One icon of a pair that share a place and swap on a state attribute. */
const iconClass =
  "col-start-1 row-start-1 size-4 motion-safe:transition-opacity motion-safe:duration-150";

export default function RecordingPlayer({
  base,
  poster,
  alt,
  fit,
  preload,
  loop = true,
  endActions,
  playNow = false,
}: RecordingPlayerProps) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  // This mounts after hydration only, so the preference is safe to read here.
  const [reduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  // The reader's choice for this clip, a play or pause here or a press elsewhere (`playNow`).
  const [chosen, setChosen] = useState<"manual" | "paused" | null>(() =>
    playNow && !reduced ? "manual" : null,
  );
  // A clip that plays once has reached its end, and rests there until the reader plays it again.
  const [ended, setEnded] = useState(false);
  // "auto" plays mid-viewport, "manual" plays from the reader's press until it leaves view, "paused" stays still.
  const mode = ended ? "paused" : (chosen ?? (reduced ? "paused" : "auto"));
  // The reader has played or paused the clip, so its changes are announced.
  const [touched, setTouched] = useState(false);
  // The play and the pause this player asked for itself, which the reader did not.
  const askedPlay = useRef(false);
  const askedPause = useRef(false);
  const [me] = useState(() => Symbol(base));

  const rest = useCallback(() => {
    const v = video.current;
    if (!v || v.paused) return;
    askedPause.current = true;
    v.pause();
  }, []);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (mode === "paused") {
      // A clip the reader paused keeps the turn while in view, so no waiting loop starts behind the pause.
      const held = new IntersectionObserver(([entry]) => {
        if (!entry?.isIntersecting) endTurn(me);
      });
      held.observe(v);
      return () => held.disconnect();
    }
    function play() {
      if (!v) return;
      stopWaiting(me);
      // A loop that takes the turn while this clip is in view leaves it waiting to play again.
      const started = askTurn(me, () => {
        rest();
        awaitTurn(me, play);
      });
      // A clip the reader paused in view holds the turn, so this one waits for it to leave.
      if (!started) {
        awaitTurn(me, play);
        return;
      }
      if (!v.paused) return;
      askedPlay.current = true;
      void v.play().catch(() => {
        askedPlay.current = false;
      });
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) {
          rest();
          stopWaiting(me);
          endTurn(me);
        } else if (mode === "auto") {
          play();
        }
      },
      mode === "auto" ? { rootMargin: "-40% 0px -40% 0px" } : undefined,
    );
    observer.observe(v);
    return () => {
      observer.disconnect();
      stopWaiting(me);
    };
  }, [mode, me, rest]);

  useEffect(
    () => () => {
      rest();
      endTurn(me);
    },
    [me, rest],
  );

  // A clip asked for by a press plays once it mounts, and takes the turn.
  useEffect(() => {
    const v = video.current;
    if (!v || !playNow || reduced) return;
    takeTurn(me, rest);
    askedPlay.current = true;
    void v.play().catch(() => {
      askedPlay.current = false;
    });
  }, [playNow, reduced, me, rest]);

  function onPlay() {
    setEnded(false);
    if (askedPlay.current) {
      askedPlay.current = false;
      return;
    }
    takeTurn(me, rest);
    setTouched(true);
    setChosen("manual");
  }

  function onPause() {
    if (askedPause.current) {
      askedPause.current = false;
      return;
    }
    // The browser pauses a clip that reaches its end; `onEnded` follows.
    if (video.current?.ended) return;
    holdTurn(me);
    setTouched(true);
    setChosen("paused");
  }

  // A clip that plays once gives its turn back at its end, so a waiting loop can start.
  function onEnded() {
    setEnded(true);
    stopWaiting(me);
    endTurn(me);
  }

  return (
    <I18nProvider locale={getLocale()}>
      <Player>
        <Container
          ref={frame}
          aria-label={alt}
          className="group/player @container relative size-full bg-fd-card outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fd-ring"
          style={
            { "--media-accent-color": "var(--color-fd-ring)" } as CSSProperties
          }
        >
          <Video
            ref={video}
            poster={poster}
            muted
            loop={loop}
            playsInline
            preload={reduced ? "metadata" : preload}
            onPlay={onPlay}
            onPause={onPause}
            onEnded={onEnded}
            className={cn(
              "size-full",
              fit === "cover"
                ? "object-cover [:fullscreen_&]:object-contain"
                : "object-contain",
            )}
          >
            <source src={videoSrc(`${base}.mp4`)} type="video/mp4" />
          </Video>
          {ended && (
            <div className="pointer-events-none absolute inset-0 flex flex-wrap content-center items-center justify-center gap-3 bg-black/55 p-4 transition-opacity duration-150 ease-out *:pointer-events-auto starting:opacity-0">
              {endActions}
              <button
                type="button"
                onClick={() => {
                  // The button leaves with the end, so focus stays on the player, where Space pauses.
                  frame.current?.focus({ preventScroll: true });
                  void video.current?.play().catch(() => {});
                }}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-transparent bg-fd-background px-5 py-2.5 text-[0.9375rem] leading-[1.45] font-semibold text-fd-foreground shadow-ring transition-[box-shadow,scale] duration-150 ease-out hover:shadow-ring-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring motion-safe:active:scale-[0.96]"
              >
                <RotateCcw aria-hidden strokeWidth={2.25} className="size-4" />
                {m.docs_learn_recording_replay()}
              </button>
            </div>
          )}
          <Controls.Root>
            <Controls.Content className="pointer-events-none absolute inset-x-2.5 bottom-2.5 transition-opacity duration-150 ease-out not-data-visible:not-has-focus-visible:opacity-0">
              <Controls.Group
                aria-label={m.docs_learn_recording_controls()}
                className="pointer-events-auto flex items-center gap-1 rounded-full border border-transparent bg-fd-card p-0.5 shadow-ring"
              >
                <PlayButton className={buttonClass}>
                  <Pause
                    aria-hidden
                    strokeWidth={2.25}
                    className={cn(
                      iconClass,
                      "group-data-paused/button:opacity-0",
                    )}
                  />
                  <Play
                    aria-hidden
                    strokeWidth={2.25}
                    className={cn(
                      iconClass,
                      "opacity-0 group-data-paused/button:opacity-100",
                    )}
                  />
                </PlayButton>
                <TimeSlider.Root
                  step={0.5}
                  largeStep={2}
                  className="group/slider relative mx-1.5 flex h-9 min-w-0 flex-1 cursor-pointer touch-none items-center"
                >
                  <TimeSlider.Track className="relative h-1 w-full overflow-hidden rounded-full bg-fd-muted-foreground/70">
                    <TimeSlider.Buffer className="absolute inset-y-0 left-0 w-(--media-slider-buffer) bg-fd-foreground/10" />
                    <TimeSlider.Fill className="absolute inset-y-0 left-0 w-(--media-slider-fill) bg-(--media-accent-color) group-data-dragging/slider:w-(--media-slider-pointer)" />
                  </TimeSlider.Track>
                  <TimeSlider.Thumb className="absolute left-(--media-slider-fill) size-3.5 -translate-x-1/2 rounded-full border-2 border-fd-card bg-(--media-accent-color) shadow-ring group-data-dragging/slider:left-(--media-slider-pointer) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring" />
                </TimeSlider.Root>
                <Time.Group className="shrink-0 px-1 font-mono text-[0.6875rem] text-fd-muted-foreground tabular-nums @max-[18rem]:hidden">
                  <Time.Value type="current" />
                  <Time.Separator className="mx-1" />
                  <Time.Value type="duration" />
                </Time.Group>
                <FullscreenButton
                  className={cn(buttonClass, "data-hidden:hidden")}
                >
                  <Maximize
                    aria-hidden
                    strokeWidth={2.25}
                    className={cn(
                      iconClass,
                      "group-data-fullscreen/button:opacity-0",
                    )}
                  />
                  <Minimize
                    aria-hidden
                    strokeWidth={2.25}
                    className={cn(
                      iconClass,
                      "opacity-0 group-data-fullscreen/button:opacity-100",
                    )}
                  />
                </FullscreenButton>
              </Controls.Group>
            </Controls.Content>
          </Controls.Root>
          <Hotkey keys="Space" action="togglePaused" />
          <Hotkey keys="ArrowLeft" action="seekStep" value={-1} />
          <Hotkey keys="ArrowRight" action="seekStep" value={1} />
          {touched && <StatusAnnouncer className="sr-only" />}
        </Container>
      </Player>
    </I18nProvider>
  );
}
