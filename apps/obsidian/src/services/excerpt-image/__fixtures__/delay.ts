/**
 * Await one real timer, which is how a harness models a cost the pipeline
 * actually spends: a stand-in document load or crop render charges wall time,
 * so the queue schedules against work that lasts.
 */
export function delay(milliseconds: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, milliseconds);
  return promise;
}
