import type { UtilityProcess } from "electron";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isErrno } from "@/lib/errno";
import { getLogger } from "@/lib/log";
import { requireElectronRemote } from "@/lib/require";
import { sweepTempDirectory } from "@/lib/temp-sweep";

export interface IsolatedProcess extends Pick<
  EventEmitter,
  "on" | "removeAllListeners"
> {
  postMessage(message: unknown): void;
  terminate(): Promise<unknown>;
}

const logger = getLogger(["utility-process"]);

/** One owned entry file shared by this service's isolated Node processes. */
export async function isolatedProcessRuntime(
  source: string,
  { prefix, serviceName }: { prefix: string; serviceName: string },
) {
  const parent = tmpdir();
  await sweepTempDirectory({
    directory: parent,
    kind: `${serviceName} process code`,
    isResidue: (name) => {
      if (!name.startsWith(prefix)) return false;
      const owner = Number(name.slice(prefix.length).split("-")[0]);
      if (!Number.isSafeInteger(owner) || owner <= 0 || owner === process.pid)
        return false;
      try {
        process.kill(owner, 0);
        return false;
      } catch (error) {
        return isErrno(error, "ESRCH");
      }
    },
  });
  const directory = await mkdtemp(join(parent, `${prefix}${process.pid}-`));
  const path = join(directory, "worker.cjs");
  try {
    await writeFile(path, source, { mode: 0o600 });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    create: (): IsolatedProcess => {
      const { utilityProcess } = requireElectronRemote().require(
        "electron",
      ) as typeof import("electron");
      return new OwnedProcess(
        utilityProcess.fork(path, [String(process.pid)], {
          stdio: "ignore",
          serviceName,
        }),
      );
    },
    [Symbol.asyncDispose]: () =>
      rm(directory, { recursive: true, force: true }),
  };
}

/** A process exits without waiting for V8 to reclaim a large query heap. */
class OwnedProcess extends EventEmitter implements IsolatedProcess {
  readonly #child;
  readonly #exited: Promise<void>;
  #stopping = false;
  #pid: number | undefined;

  constructor(child: UtilityProcess) {
    super();
    this.#child = child;
    this.#pid = child.pid;
    child.on("spawn", () => {
      this.#pid = child.pid;
      if (this.#stopping) this.#stop();
    });
    this.#exited = new Promise((resolve) =>
      child.once("exit", (code) => {
        this.#pid = undefined;
        this.emit("exit", code);
        resolve();
      }),
    );
    child.on("message", (message: unknown) => {
      // Electron can emit spawn before its remote listener is attached.
      // The readiness message proves that pid is now available.
      this.#pid ??= child.pid;
      this.emit("message", message);
    });
    child.on("error", (type, location, report) =>
      this.emit("error", new Error(`${type} in ${location}: ${report}`)),
    );
  }

  postMessage(message: unknown): void {
    this.#child.postMessage(message);
  }

  #stop(): void {
    // A local signal stops the owned process without Electron remote's
    // synchronous main-process call.
    try {
      // Covers cancellation before readiness when spawn was already missed.
      this.#pid ??= this.#child.pid;
      if (this.#pid === undefined) return;
      process.kill(this.#pid, "SIGKILL");
    } catch (error) {
      if (isErrno(error, "ESRCH")) return;
      logger.warn(
        "Utility process direct stop failed; asking Electron to stop it",
        { error },
      );
      try {
        this.#child.kill();
      } catch (fallbackError) {
        // Keep ownership and the source lease until an exit is confirmed.
        logger.error("Utility process could not be stopped; waiting for exit", {
          error: fallbackError,
        });
      }
    }
  }

  async terminate(): Promise<void> {
    this.#stopping = true;
    this.#stop();
    await this.#exited;
    this.#child.removeAllListeners();
  }
}
