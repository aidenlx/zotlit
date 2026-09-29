/** One startup retry sequence, shared by Welcome's focus and service events. */
const RETRY_DELAYS = [1, 2, 4, 8].map((seconds) =>
  Temporal.Duration.from({ seconds }),
);

export interface CompanionRefresh extends Disposable {
  refresh(): Promise<void>;
}

/** Read fresh status without letting an older response overwrite a later request. */
export function createCompanionRefresh({
  readInstalled,
  publish,
}: {
  /** The profile reader reports unavailable or unreadable lists as false. */
  readInstalled: () => Promise<boolean>;
  publish: (installed: boolean) => void;
}): CompanionRefresh {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retry = 0;
  let generation = 0;
  let stopped = false;
  let disposed = false;

  const cancelRetry = (): void => {
    clearTimeout(timer);
    timer = undefined;
  };
  const refresh = async (): Promise<void> => {
    if (disposed) return;
    const current = ++generation;
    const installed = await readInstalled();
    if (disposed || current !== generation) return;

    if (installed) {
      stopped = true;
      cancelRetry();
    } else if (!stopped && timer === undefined) {
      const delay = RETRY_DELAYS[retry];
      if (delay) {
        timer = setTimeout(() => {
          timer = undefined;
          retry++;
          void refresh();
        }, delay.total("milliseconds"));
      }
    }
    publish(installed);
  };
  return {
    refresh,
    [Symbol.dispose]() {
      disposed = true;
      cancelRetry();
    },
  };
}
