import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import {
  connectWithRetry,
  findFreePort,
  type RdpClient,
} from "./rdp-client.js";

const DEV_DIR_NAME = ".zotero-dev";
const RDP_PREFS = [
  ["devtools.chrome.enabled", true],
  ["devtools.debugger.remote-enabled", true],
  ["devtools.debugger.prompt-connection", false],
  ["devtools.debugger.force-local", true],
] as const;

export interface SpawnZoteroOptions {
  root: string;
  binaryPath: string;
  profilePath?: string;
  dataDir?: string;
  devtools: boolean;
  signal: AbortSignal;
  onExit?: (error: Error) => void;
}

export interface ZoteroDevSession {
  child: ChildProcess;
  client: RdpClient;
  port: number;
  profilePath: string;
  dataDir?: string;
}

export async function spawnZotero({
  root,
  binaryPath,
  profilePath: rawProfilePath,
  dataDir: rawDataDir,
  devtools,
  signal,
  onExit,
}: SpawnZoteroOptions): Promise<ZoteroDevSession> {
  signal.throwIfAborted();

  const { profilePath, dataDir } = await prepareDevProfile({
    root,
    profilePath: rawProfilePath,
    dataDir: rawDataDir,
  });
  const port = await findFreePort();
  const args = zoteroArgs({ profilePath, dataDir, port, devtools });
  const childStopped = Promise.withResolvers<never>();
  const child = spawn(binaryPath, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      XPCOM_DEBUG_BREAK: "stack",
      NS_TRACE_MALLOC_DISABLE_STACKS: "1",
    },
  });

  const stopChild = (): void => {
    if (child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
    }
  };

  const onAbort = (): void => {
    stopChild();
  };
  signal.addEventListener("abort", onAbort, { once: true });

  child.once("error", (error) => {
    signal.removeEventListener("abort", onAbort);
    onExit?.(error);
    childStopped.reject(error);
  });

  child.once("exit", (code, exitSignal) => {
    signal.removeEventListener("abort", onAbort);
    const error = zoteroExitError(code, exitSignal);
    onExit?.(error);
    childStopped.reject(error);
  });

  try {
    const client = await Promise.race([
      connectWithRetry(port, { signal }),
      childStopped.promise,
    ]);

    return {
      child,
      client,
      port,
      profilePath,
      ...(dataDir === undefined ? {} : { dataDir }),
    };
  } catch (error) {
    stopChild();
    throw error;
  }
}

interface PrepareDevProfileOptions {
  root: string;
  profilePath?: string;
  dataDir?: string;
}

async function prepareDevProfile({
  root,
  profilePath: rawProfilePath,
  dataDir: rawDataDir,
}: PrepareDevProfileOptions): Promise<{
  profilePath: string;
  dataDir?: string;
}> {
  const profilePath = rawProfilePath ?? join(root, DEV_DIR_NAME, "profile");
  const dataDir =
    rawDataDir ??
    (rawProfilePath === undefined
      ? join(root, DEV_DIR_NAME, "data")
      : undefined);

  await mkdir(profilePath, { recursive: true });
  if (dataDir !== undefined) {
    await mkdir(dataDir, { recursive: true });
  }
  await applyRdpPrefs(profilePath);

  return {
    profilePath,
    ...(dataDir === undefined ? {} : { dataDir }),
  };
}

async function applyRdpPrefs(profilePath: string): Promise<void> {
  const userJsPath = join(profilePath, "user.js");
  const existing = await readExistingFile(userJsPath);
  const kept = existing
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
    .filter((line) => !isManagedPrefLine(line))
    .join("\n")
    .trimEnd();
  const managed = [
    "// ZotLit dev server: enable Firefox RDP for temporary add-on reloads.",
    ...RDP_PREFS.map(([name, value]) => formatUserPref(name, value)),
  ].join("\n");
  const next = `${[kept, managed].filter(Boolean).join("\n\n")}\n`;

  if (existing !== next) {
    await writeFile(userJsPath, next, "utf-8");
  }
}

async function readExistingFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return "";
    }
    throw error;
  }
}

function isManagedPrefLine(line: string): boolean {
  const trimmed = line.trimStart();
  return RDP_PREFS.some(([name]) =>
    trimmed.startsWith(`user_pref(${JSON.stringify(name)},`),
  );
}

function formatUserPref(
  name: (typeof RDP_PREFS)[number][0],
  value: boolean,
): string {
  return `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`;
}

interface ZoteroArgsOptions {
  profilePath: string;
  dataDir?: string;
  port: number;
  devtools: boolean;
}

function zoteroArgs({
  profilePath,
  dataDir,
  port,
  devtools,
}: ZoteroArgsOptions): string[] {
  const args = ["--purgecaches", "--new-instance", "--profile", profilePath];

  if (dataDir !== undefined) {
    args.push("--dataDir", dataDir);
  }
  if (devtools) {
    args.push("--jsdebugger");
  }
  args.push(`--start-debugger-server=${port}`);

  return args;
}

export function resolveDevPath(root: string, rawPath: string): string {
  const expanded = rawPath.startsWith("~/")
    ? join(homedir(), rawPath.slice(2))
    : rawPath;

  return isAbsolute(expanded) ? expanded : resolve(root, expanded);
}

function zoteroExitError(
  code: number | null,
  signal: NodeJS.Signals | null,
): Error {
  const status =
    signal === null ? `exit code ${code ?? "unknown"}` : `signal ${signal}`;
  return new Error(`Zotero exited with ${status}`);
}

interface NodeError extends Error {
  code?: string;
}

function isNodeError(error: unknown, code: string): error is NodeError {
  return error instanceof Error && (error as NodeError).code === code;
}
