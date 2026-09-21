// Promise cancellation shared by the excerpt renderer and its canvas encoding.

/** Deadlines also cover hosts whose cancellation method does not settle. */
export async function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    // The caller may already have started work: observe its eventual rejection.
    void promise.catch(() => undefined);
    signal.throwIfAborted();
  }
  using cleanup = new DisposableStack();
  return await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      cleanup.defer(() => signal.removeEventListener("abort", abort));
      if (signal.aborted) abort();
    }),
  ]);
}
