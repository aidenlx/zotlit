// The clock a test hands the query client, for the reads whose cooldown is read against it.

import { FAILURE_COOLDOWN } from "./service";

export interface TestClock {
  /** The clock to hand the QueryClients fixture. */
  readonly now: () => Temporal.Instant;
  /**
   * Moves one step past the failure cooldown deadline, which is what rearms a
   * key whose last read failed.
   */
  passCooldown: () => void;
}

/**
 * Wall time shifted by what the consumer test has passed. The fixture provides
 * this clock to the QueryClients layer for both failure stamps and cooldowns.
 */
export function testClock(): TestClock {
  let offset = Temporal.Duration.from({ milliseconds: 0 });
  return {
    now: () => Temporal.Now.instant().add(offset),
    passCooldown: () => {
      offset = offset.add(FAILURE_COOLDOWN).add({ milliseconds: 1 });
    },
  };
}
