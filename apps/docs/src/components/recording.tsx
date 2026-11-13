// A recording's player, loaded on demand: its still shows until the player arrives, so the first paint shows the poster.

import { lazy, Suspense } from "react";
import type { ReactNode } from "react";

import type { RecordingPlayerProps } from "./recording-player";

const RecordingPlayer = lazy(() => import("./recording-player"));

export function Recording({
  fallback,
  ...props
}: RecordingPlayerProps & {
  /** The still, which the page prerenders. */
  fallback: ReactNode;
}) {
  return (
    <Suspense fallback={fallback}>
      <RecordingPlayer {...props} />
    </Suspense>
  );
}
