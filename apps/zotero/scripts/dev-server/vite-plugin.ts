import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { loadEnv } from "vite";
import type { Plugin } from "vite";

import { installTemporaryAddon, reloadAddon } from "./remote-firefox.js";
import { resolveDevPath, spawnZotero } from "./runner.js";
import type { ZoteroDevSession } from "./runner.js";

const PREFIX = "[zotero-dev]";
const ENV_EXAMPLE_PATH = "apps/zotero/.env.example";

export interface ZoteroDevServerPluginOptions {
  root: string;
  mode: string;
}

interface ZoteroDevServerEnv {
  binaryPath: string;
  profilePath?: string;
  dataDir?: string;
  devtools: boolean;
}

export function zoteroDevServerPlugin({
  root,
  mode,
}: ZoteroDevServerPluginOptions): Plugin {
  const env = resolveZoteroDevServerEnv(root, mode);
  const addonId = readAddonId(root);
  const addonPath = resolve(root, "dist-dev/addon");
  const abortController = new AbortController();
  let sessionPromise: Promise<ZoteroDevSession> | undefined;
  let session: ZoteroDevSession | undefined;
  let installed = false;
  let pendingReload = false;
  let syncPromise: Promise<void> | undefined;
  let stopping = false;
  let processHandlersRegistered = false;

  const stop = (reason: Error): void => {
    if (!abortController.signal.aborted) {
      abortController.abort(reason);
    }
    session?.client.disconnect();
  };

  const onProcessSignal = (signal: NodeJS.Signals): void => {
    stopping = true;
    stop(new Error(`Received ${signal}`));
    setTimeout(() => {
      process.exit(signal === "SIGINT" ? 130 : 143);
    }, 100).unref();
  };

  const registerProcessHandlers = (): void => {
    if (processHandlersRegistered) return;
    processHandlersRegistered = true;
    process.once("SIGINT", onProcessSignal);
    process.once("SIGTERM", onProcessSignal);
  };

  const unregisterProcessHandlers = (): void => {
    if (!processHandlersRegistered) return;
    processHandlersRegistered = false;
    process.off("SIGINT", onProcessSignal);
    process.off("SIGTERM", onProcessSignal);
  };

  const ensureSession = async (): Promise<ZoteroDevSession> => {
    if (sessionPromise === undefined) {
      throw new Error(`${PREFIX} Zotero runner was not started`);
    }
    return await sessionPromise;
  };

  const runSync = async (): Promise<void> => {
    const activeSession = await ensureSession();

    if (!installed) {
      info(`Installing ${addonId} from ${addonPath}`);
      await installTemporaryAddon(activeSession.client, addonPath);
      installed = true;
      info(`Installed ${addonId}`);
    } else {
      await reload(activeSession);
    }

    while (pendingReload) {
      pendingReload = false;
      await reload(activeSession);
    }
  };

  const reload = async (activeSession: ZoteroDevSession): Promise<void> => {
    info(`Reloading ${addonId}`);
    await reloadAddon(activeSession.client, addonId);
    info(`Reloaded ${addonId}`);
  };

  const syncAddon = async (): Promise<void> => {
    abortController.signal.throwIfAborted();

    if (syncPromise !== undefined) {
      pendingReload = true;
      await syncPromise;
      return;
    }

    syncPromise = runSync();
    try {
      await syncPromise;
    } finally {
      syncPromise = undefined;
    }
  };

  const startZotero = (): void => {
    registerProcessHandlers();
    info(`Launching Zotero from ${env.binaryPath}`);
    sessionPromise = spawnZotero({
      root,
      binaryPath: env.binaryPath,
      profilePath: env.profilePath,
      dataDir: env.dataDir,
      devtools: env.devtools,
      signal: abortController.signal,
      onExit(error) {
        if (stopping) return;
        errorLog(error.message);
        stopping = true;
        stop(error);
        process.exitCode = 1;
        setTimeout(() => {
          process.exit(1);
        }, 100).unref();
      },
    }).then((readySession) => {
      session = readySession;
      readySession.client.on("error", (error) => {
        if (stopping || abortController.signal.aborted) return;
        errorLog(error.message);
        stopping = true;
        stop(error);
        process.exitCode = 1;
        setTimeout(() => {
          process.exit(1);
        }, 100).unref();
      });
      info(`RDP connected on port ${readySession.port}`);
      return readySession;
    });
    sessionPromise.catch((error: unknown) => {
      if (abortController.signal.aborted) return;
      errorLog(formatUnknownError(error));
    });
  };

  const teardown = (): void => {
    stopping = true;
    unregisterProcessHandlers();
    stop(new Error("Zotero dev server stopped"));
  };

  return {
    name: "zotero-dev-server",
    apply: "build",
    configResolved() {
      startZotero();
    },
    async writeBundle() {
      await syncAddon();
    },
    closeBundle() {
      if (!this.meta.watchMode) {
        teardown();
      }
    },
    closeWatcher() {
      teardown();
    },
  };
}

function resolveZoteroDevServerEnv(
  root: string,
  mode: string,
): ZoteroDevServerEnv {
  const env = loadEnv(mode, root, "ZOTERO_PLUGIN_");
  const rawBinaryPath = env.ZOTERO_PLUGIN_ZOTERO_BIN_PATH?.trim();

  if (!rawBinaryPath) {
    throw new Error(
      `${PREFIX} Missing ZOTERO_PLUGIN_ZOTERO_BIN_PATH. Create apps/zotero/.env from ${ENV_EXAMPLE_PATH}.`,
    );
  }

  const binaryPath = resolveDevPath(root, rawBinaryPath);
  assertExistingFile(binaryPath, "ZOTERO_PLUGIN_ZOTERO_BIN_PATH");

  const rawProfilePath = env.ZOTERO_PLUGIN_PROFILE_PATH?.trim();
  const rawDataDir = env.ZOTERO_PLUGIN_DATA_DIR?.trim();

  return {
    binaryPath,
    ...(rawProfilePath
      ? { profilePath: resolveDevPath(root, rawProfilePath) }
      : {}),
    ...(rawDataDir ? { dataDir: resolveDevPath(root, rawDataDir) } : {}),
    devtools: env.ZOTERO_PLUGIN_DEVTOOLS?.trim() !== "false",
  };
}

function assertExistingFile(path: string, envName: string): void {
  try {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      throw new Error(`${envName} points to a directory: ${path}`);
    }
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      throw new Error(
        `${PREFIX} ${envName} must point to an existing Zotero 9 binary: ${path}. See ${ENV_EXAMPLE_PATH}.`,
        { cause: error },
      );
    }
    throw error;
  }
}

function readAddonId(root: string): string {
  const pkgPath = join(root, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
    zotero?: { id?: unknown };
  };
  if (typeof pkg.zotero?.id !== "string") {
    throw new Error(`${PREFIX} package.json is missing zotero.id`);
  }
  return pkg.zotero.id;
}

function info(message: string): void {
  console.info(`${PREFIX} ${message}`);
}

function errorLog(message: string): void {
  console.error(`${PREFIX} ${message}`);
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : inspect(error);
}
