export class AbortError extends DOMException {
  constructor(message = "Aborted") {
    super(message, "AbortError");
  }

  static test(err: unknown): err is DOMException {
    return err instanceof DOMException && err.name === "AbortError";
  }
}
