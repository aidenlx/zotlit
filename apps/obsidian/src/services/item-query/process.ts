import type { UtilityProcess } from "electron";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isErrno } from "@/lib/errno";
import { getLogger } from "@/lib/log";
import { requireElectronRemote } from "@/lib/require";
import { sweepTempDirectory } from "@/lib/temp-sweep";

import type { QueryWorker } from "./workers";

const logger = getLogger(["item-query"]);
const PREFIX = "zotlit-query-process-";

/** One owned entry file shared by this service's isolated Node processes. */
export async function queryProcessRuntime(source: string) {
  const parent = tmpdir();
  await sweepTempDirectory({
    directory: parent,
    kind: "Item Query process code",
    isResidue: (name) => {
      if (!name.startsWith(PREFIX)) return false;
      const owner = Number(name.slice(PREFIX.length).split("-")[0]);
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
  const directory = await mkdtemp(join(parent, `${PREFIX}${process.pid}-`));
  const path = join(directory, "query.cjs");
  try {
    await writeFile(path, source, { mode: 0o600 });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    create: (): QueryWorker => {
      const { utilityProcess } = requireElectronRemote().require(
        "electron",
      ) as typeof import("electron");
      return new QueryProcess(
        utilityProcess.fork(path, [String(process.pid)], {
          stdio: "ignore",
          serviceName: "ZotLit Item Query",
        }),
      );
    },
    [Symbol.asyncDispose]: () =>
      rm(directory, { recursive: true, force: true }),
  };
}

/** A process exits without waiting for V8 to reclaim a large query heap. */
class QueryProcess extends EventEmitter implements QueryWorker {
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
    child.on("message", (message: string) => {
      // Electron can emit spawn before its remote listener is attached.
      // The readiness message proves that pid is now available.
      this.#pid ??= child.pid;
      this.emit("message", message);
    });
    child.on("error", (type, location, report) =>
      this.emit("error", new Error(`${type} in ${location}: ${report}`)),
    );
  }

  postMessage(text: string): void {
    this.#child.postMessage(text);
  }

  #stop(): void {
    // The process owns only a read-only database and unpublished output. A
    // local signal avoids Electron remote's synchronous main-process call.
    try {
      // Covers cancellation before readiness when spawn was already missed.
      this.#pid ??= this.#child.pid;
      if (this.#pid === undefined) return;
      process.kill(this.#pid, "SIGKILL");
    } catch (error) {
      if (isErrno(error, "ESRCH")) return;
      logger.warn(
        "Item Query direct process stop failed; asking Electron to stop it",
        { error },
      );
      try {
        this.#child.kill();
      } catch (fallbackError) {
        // Keep ownership and the source lease until an exit is confirmed.
        logger.error(
          "Item Query process could not be stopped; waiting for exit",
          { error: fallbackError },
        );
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
