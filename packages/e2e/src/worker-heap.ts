import { setTimeout as delay } from "node:timers/promises";

import {
  DEFAULT_CDP_PORT,
  listObsidianWindows,
  openCdpSession,
  selectWindow,
} from "@zotlit/scripts/obsidian-cdp";

interface HeapReading {
  before: number;
  peak: number;
  after: number;
}

export type WorkerHeap = Record<string, HeapReading>;

/** Sample used JS heap in this vault's workers; CDP is optional and never enabled here. */
export async function measureWorkerHeap<T>(
  vault: string,
  measure: () => Promise<T>,
): Promise<{ value: T; workerHeap: WorkerHeap | null }> {
  try {
    const response = await fetch(
      `http://127.0.0.1:${DEFAULT_CDP_PORT}/json/version`,
      {
        signal: AbortSignal.timeout(3_000),
      },
    );
    if (!response.ok) throw new Error(`CDP HTTP ${response.status}`);
    await response.json();
  } catch {
    return { value: await measure(), workerHeap: null };
  }

  const page = selectWindow(await listObsidianWindows(), { vault });
  using session = await openCdpSession(page.webSocketDebuggerUrl);
  const sessions = new Set<string>();
  using _subscription = session.onEvent(({ method, params }) => {
    const target = params as
      | { sessionId: string; targetInfo?: { type: string } }
      | undefined;
    if (
      method === "Target.attachedToTarget" &&
      target?.targetInfo?.type === "worker"
    )
      sessions.add(target.sessionId);
    if (method === "Target.detachedFromTarget" && target)
      sessions.delete(target.sessionId);
  });

  await session.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
  const workers = new Map<string, string>();
  await Promise.all(
    [...sessions].map(async (sessionID) => {
      const reply = await session.send(
        "Runtime.evaluate",
        { expression: "self.name", returnByValue: true },
        { sessionId: sessionID, timeoutMs: 3_000 },
      );
      const name = (reply.result as { value?: string }).value;
      if (name === "zotlit-zotero-reads" || name === "zotlit-citation-reads")
        workers.set(sessionID, name);
    }),
  );
  if (workers.size === 0)
    throw new Error("CDP answered but no ZotLit workers attached");

  const workerHeap: WorkerHeap = {};
  async function sample(phase: "before" | "peak" | "after"): Promise<void> {
    await Promise.all(
      [...workers].map(async ([sessionID, name]) => {
        const { usedSize } = await session.send(
          "Runtime.getHeapUsage",
          {},
          { sessionId: sessionID, timeoutMs: 3_000 },
        );
        if (typeof usedSize !== "number")
          throw new Error(`No used heap for ${name}`);
        const reading = (workerHeap[name] ??= {
          before: usedSize,
          peak: usedSize,
          after: usedSize,
        });
        if (phase !== "peak") reading[phase] = usedSize;
        reading.peak = Math.max(reading.peak, usedSize);
      }),
    );
  }
  await sample("before");
  const stop = new AbortController();
  const sampling = (async () => {
    while (!stop.signal.aborted) {
      await sample("peak");
      await delay(25, undefined, { signal: stop.signal }).catch(
        () => undefined,
      );
    }
  })();
  const [measurement, sampler] = await Promise.allSettled([
    Promise.resolve()
      .then(measure)
      .finally(() => stop.abort()),
    sampling,
  ]);
  if (sampler.status === "rejected") throw sampler.reason;
  if (measurement.status === "rejected") throw measurement.reason;
  await sample("after");
  return { value: measurement.value, workerHeap };
}
