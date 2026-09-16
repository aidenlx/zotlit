// The clock a test hands the query client, for the reads whose cooldown is read against it.

import { FAILURE_COOLDOWN } from "./service";

export interface TestClock {
  /** The clock to hand {@link QueryClientService}. */
  readonly now: () => Temporal.Instant;
  /**
   * Moves one step past the failure cooldown deadline, which is what rearms a
   * key whose last read failed.
   */
  passCooldown: () => void;
}

export function testClock(): TestClock {
  let instant = Temporal.Now.instant();
  return {
    now: () => instant,
    passCooldown: () => {
      instant = instant.add(FAILURE_COOLDOWN).add({ milliseconds: 1 });
    },
  };
}
