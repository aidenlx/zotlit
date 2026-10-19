/** A live read, retaining the Attachment and the exact instant for write-back. */
export interface PdfRead {
  attachmentKey: string;
  itemKey: string;
  instant: Temporal.Instant;
}

interface PdfReadsDeps {
  record: (read: PdfRead) => void;
  now: () => Temporal.Instant;
}

/** One throttle shared by every view of an Attachment in this workspace. */
export class PdfReads {
  readonly #last = new Map<string, Temporal.Instant>();
  readonly #record;
  readonly #now;

  constructor({ record, now }: PdfReadsDeps) {
    this.#record = record;
    this.#now = now;
  }

  record(
    target: { attachmentKey: string; itemKey: string | null },
    event: "open" | "page" | "close",
    instant = this.#now(),
  ): void {
    const { attachmentKey, itemKey } = target;
    if (itemKey === null) return;
    const last = this.#last.get(attachmentKey);
    if (
      event === "page" &&
      last &&
      instant.epochMilliseconds - last.epochMilliseconds < 5 * 60 * 1000
    )
      return;
    if (!last || Temporal.Instant.compare(instant, last) > 0)
      this.#last.set(attachmentKey, instant);
    this.#record({ attachmentKey, itemKey, instant });
  }
}
