// How a harness waits for a card's display to change: the display's own Node
// harness and the Chromium refresh trial watch the same demand, and both wait on
// its notifications rather than on a clock.
import type {
  ExcerptDisplayDemand,
  ExcerptImageDisplay,
} from "@/services/excerpt-image/display";

/**
 * The next snapshot that answers `matches`, resolved from the demand's own
 * notification, and unsubscribed as soon as it does.
 */
export function settledDisplay(
  demand: ExcerptDisplayDemand,
  matches: (display: ExcerptImageDisplay) => boolean,
): Promise<ExcerptImageDisplay> {
  const next = Promise.withResolvers<ExcerptImageDisplay>();
  const onChange = () => {
    const snapshot = demand.snapshot();
    if (matches(snapshot)) next.resolve(snapshot);
  };
  const off = demand.subscribe(onChange);
  onChange();
  return next.promise.finally(off);
}
