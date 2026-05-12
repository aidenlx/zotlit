import {
  type LogRecord,
  type Sink,
  getJsonLinesFormatter,
} from "@logtape/logtape";
import type { DataAdapter } from "obsidian";

const FLUSH_INTERVAL_MS = 1000;

/**
 * JSON-lines log sink backed by an Obsidian {@link DataAdapter}.
 *
 * Records are buffered in memory and flushed on a timer; the sink is
 * async-disposable so the timer is cleared and pending writes drain before
 * the resource is released. The target file is truncated on open so a fresh
 * session never inherits the previous session's log lines.
 *
 * @throws if the initial `adapter.write(path, "")` truncate fails.
 */
export async function createVaultFileSink(
  adapter: DataAdapter,
  path: string,
): Promise<Sink & AsyncDisposable> {
  const format = getJsonLinesFormatter();

  await adapter.write(path, "");

  let pending = "";
  let inFlight: Promise<void> = Promise.resolve();
  let accepting = true;
  let disposePromise: Promise<void> | undefined;

  const flushPending = (): void => {
    if (pending.length === 0) return;
    const data = pending;
    pending = "";
    inFlight = inFlight.then(() => adapter.append(path, data));
  };

  const timer = setInterval(() => {
    flushPending();
    inFlight = inFlight.catch((err: unknown) => {
      console.error("Failed to write to plugin log file", err);
    });
  }, FLUSH_INTERVAL_MS);

  const sink: Sink & AsyncDisposable = (record: LogRecord) => {
    if (!accepting) return;
    pending += format(record);
  };
  sink[Symbol.asyncDispose] = () => {
    disposePromise ??= (async () => {
      accepting = false;
      clearInterval(timer);
      flushPending();
      try {
        await inFlight;
      } catch (err) {
        console.error("Failed to flush plugin log file on dispose", err);
      }
    })();
    return disposePromise;
  };
  return sink;
}
