export class AbortError extends DOMException {
  constructor(message = "Aborted") {
    super(message, "AbortError");
  }

  static test(err: unknown): err is DOMException {
    return err instanceof DOMException && err.name === "AbortError";
  }
}

/**
 * A rejection handler for a run nothing awaits: it passes over an
 * {@link AbortError}, such as a bridge run that unload interrupted, and
 * rethrows any other reason.
 */
export function passAborted(error: unknown): void {
  if (!AbortError.test(error)) throw error;
}
