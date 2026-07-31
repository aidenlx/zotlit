export const Temporal = globalThis.Temporal;
export function toTemporalInstant(this: Date): Temporal.Instant {
  return this.toTemporalInstant();
}
