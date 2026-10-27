// The Library presentation clock in plain code.
import { vi } from "vitest";

/** Hold the view's clock at `iso`; the returned spy restores it. */
export function holdNow(iso: string) {
  return vi
    .spyOn(Temporal.Now, "instant")
    .mockReturnValue(Temporal.Instant.from(iso));
}

