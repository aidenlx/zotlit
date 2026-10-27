import { obRun } from "./obsidian-cli.ts";
import type { WorkerDebugger, WorkerTimerGlobal } from "./page-query-types.ts";

/** Measure the real worker's task queue independently of sequential RPC calls. */
export async function measureWorkerResponsiveness<T>(
  vault: string,
  measure: () => Promise<T>,
): Promise<{ value: T; gaps: number[] }> {
  await obRun(vault, async ({ page }) => {
    const debuggerClient = (
      require("@electron/remote") as {
        getCurrentWebContents(): { debugger: WorkerDebugger };
      }
    ).getCurrentWebContents().debugger;
    const attached = debuggerClient.isAttached();
    if (!attached) debuggerClient.attach("1.3");
    const targets: string[] = [];
    const found = Promise.withResolvers<void>();
    const listener: Parameters<WorkerDebugger["on"]>[1] = (
      _event,
      method,
      params,
    ) => {
      if (
        method === "Target.attachedToTarget" &&
        params.targetInfo.title === "zotlit-zotero-reads"
      ) {
        targets.push(params.sessionId);
        found.resolve();
      }
    };
    debuggerClient.on("message", listener);
    try {
      await debuggerClient.sendCommand("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          found.promise,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Error("ZoteroReads worker did not attach")),
              3000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (targets.length !== 1)
        throw Error(`Expected one ZoteroReads worker; got ${targets.length}`);
      const session = targets[0]!;
      const install = () => {
        const worker = globalThis as WorkerTimerGlobal;
        const timer = {
          gaps: [] as number[],
          previous: performance.now(),
          id: undefined as ReturnType<typeof setInterval> | undefined,
        };
        worker.__zotlitTestTimer = timer;
        timer.id = setInterval(() => {
          const now = performance.now();
          timer.gaps.push(now - timer.previous);
          timer.previous = now;
        }, 50);
      };
      const installed = await debuggerClient.sendCommand(
        "Runtime.evaluate",
        { expression: `(${install.toString()})()` },
        session,
      );
      if (installed.exceptionDetails)
        throw Error("Worker timer probe did not start");
      page.scratch.__zotlitWorkerProbe = {
        debuggerClient,
        attached,
        listener,
        session,
      };
    } catch (error) {
      await debuggerClient.sendCommand("Target.setAutoAttach", {
        autoAttach: false,
        waitForDebuggerOnStart: false,
        flatten: true,
      });
      debuggerClient.removeListener("message", listener);
      if (!attached) debuggerClient.detach();
      throw error;
    }
  });
  let gaps: number[] = [];
  let value: T;
  try {
    value = await measure();
  } finally {
    gaps = await obRun(vault, async ({ page }) => {
      const { debuggerClient, attached, listener, session } =
        page.scratch.__zotlitWorkerProbe!;
      try {
        const stop = () => {
          const worker = globalThis as WorkerTimerGlobal;
          const timer = worker.__zotlitTestTimer!;
          clearInterval(timer.id);
          delete worker.__zotlitTestTimer;
          return timer.gaps;
        };
        const reply = await debuggerClient.sendCommand(
          "Runtime.evaluate",
          { expression: `(${stop.toString()})()`, returnByValue: true },
          session,
        );
        if (reply.exceptionDetails) throw Error("Worker timer probe failed");
        return reply.result!.value;
      } finally {
        await debuggerClient.sendCommand("Target.setAutoAttach", {
          autoAttach: false,
          waitForDebuggerOnStart: false,
          flatten: true,
        });
        debuggerClient.removeListener("message", listener);
        if (!attached) debuggerClient.detach();
        delete page.scratch.__zotlitWorkerProbe;
      }
    });
  }
  return { value, gaps };
}
