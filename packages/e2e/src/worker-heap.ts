import { setTimeout as delay } from "node:timers/promises";

import {
  DEFAULT_CDP_PORT,
  listObsidianWindows,
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
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  using cleanup = new DisposableStack();
  cleanup.defer(() => socket.close());
  const pending = new Map<
    number,
    ReturnType<typeof Promise.withResolvers<Record<string, unknown>>>
  >();
  const sessions = new Set<string>();
  let nextID = 0;
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data)) as {
      id?: number;
      method?: string;
      params?: { sessionId: string; targetInfo?: { type: string } };
      result?: Record<string, unknown>;
      error?: { message: string };
    };
    if (
      message.method === "Target.attachedToTarget" &&
      message.params?.targetInfo?.type === "worker"
    ) {
      sessions.add(message.params.sessionId);
    }
    if (message.method === "Target.detachedFromTarget" && message.params) {
      sessions.delete(message.params.sessionId);
    }
    if (message.id === undefined) return;
    const call = pending.get(message.id);
    if (message.error) call?.reject(new Error(message.error.message));
    else call?.resolve(message.result ?? {});
  });
  socket.addEventListener("close", () => {
    for (const call of pending.values())
      call.reject(new Error("Worker heap CDP connection closed"));
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Worker heap CDP connect timed out")),
      3_000,
    );
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timeout);
        reject(new Error("Worker heap CDP connect failed"));
      },
      { once: true },
    );
  });

  async function send(
    method: string,
    params = {},
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const id = ++nextID;
    const call = Promise.withResolvers<Record<string, unknown>>();
    pending.set(id, call);
    const timeout = setTimeout(
      () => call.reject(new Error(`Worker heap CDP ${method} timed out`)),
      3_000,
    );
    try {
      socket.send(JSON.stringify({ id, method, params, sessionId }));
      return await call.promise;
    } finally {
      clearTimeout(timeout);
      pending.delete(id);
    }
  }

  await send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
  const workers = new Map<string, string>();
  await Promise.all(
    [...sessions].map(async (sessionID) => {
      const reply = await send(
        "Runtime.evaluate",
        { expression: "self.name", returnByValue: true },
        sessionID,
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
        const { usedSize } = await send("Runtime.getHeapUsage", {}, sessionID);
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
  try {
    const [value] = await Promise.all([
      measure().finally(() => stop.abort()),
      sampling,
    ]);
    await sample("after");
    return { value, workerHeap };
  } finally {
    stop.abort();
    await sampling;
  }
}
