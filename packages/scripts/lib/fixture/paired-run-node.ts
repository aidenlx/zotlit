import type { FixtureLayout } from "#fixture";
import getPort from "get-port";
import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import type {
  DevelopmentSession,
  PairedRunPorts,
  PairedRunReady,
} from "./paired-run.ts";

import { DEV_VAULT_CASE_ENV, getDevVaultDir } from "#dev-vault";
import { LIVE_UPDATE_HOSTNAME } from "#fixture";
import {
  getZoteroBinary,
  installBetterBibtex,
  resolveZoteroApp,
} from "#paired-zotero";

type ManagedProcess = ChildProcessByStdio<null, Readable, Readable>;

const ZOTERO_READY_EVENT = "paired-zotero-ready";

/** How long a Paired Zotero gets to close its database after each signal. */
const ZOTERO_QUIT_TIMEOUT_MS = 20_000;
const ZOTERO_KILL_TIMEOUT_MS = 5_000;
const ZOTERO_EXIT_POLL_INTERVAL_MS = 250;

/** A Zotero process that holds the Fixture database open. */
export interface LivePairedZotero {
  command: string;
  pid: number;
}

export function createNodePairedRunPorts({
  workspaceRoot,
  layout,
}: {
  workspaceRoot: string;
  layout: FixtureLayout;
}): PairedRunPorts {
  const vaultScript = join(
    workspaceRoot,
    "packages/scripts/scripts/obsidian-vault.ts",
  );
  const zoteroOpenScript = join(
    workspaceRoot,
    "apps/zotero/scripts/dev-server/open.ts",
  );

  const zoteroEnvironment = async (): Promise<{
    applicationDir: string;
    env: NodeJS.ProcessEnv;
  }> => {
    await installBetterBibtex(layout.profileDir);
    const applicationDir = await resolveZoteroApp();
    return {
      applicationDir,
      env: {
        ...process.env,
        ZOTERO_PLUGIN_ZOTERO_BIN_PATH: getZoteroBinary(applicationDir),
        ZOTERO_PLUGIN_PROFILE_PATH: layout.profileDir,
        ZOTERO_PLUGIN_DATA_DIR: layout.dataDir,
      },
    };
  };

  return {
    async assertObsidianHost() {
      await runCaptured(process.execPath, [vaultScript, "check"], {
        cwd: workspaceRoot,
      });
    },

    async stopLivePairedZotero() {
      const findLive = (): Promise<LivePairedZotero[]> =>
        findLivePairedZotero(layout, workspaceRoot);
      let live = await findLive();
      if (live.length === 0) return;

      console.log(`Closing the live Paired Zotero: ${describeLive(live)}`);
      // SIGTERM lets Zotero close its database. SIGKILL is the fallback for an
      // instance that never answers, because the rebuild that follows deletes
      // the whole Fixture root under it.
      for (const [signal, timeoutMs] of [
        ["SIGTERM", ZOTERO_QUIT_TIMEOUT_MS],
        ["SIGKILL", ZOTERO_KILL_TIMEOUT_MS],
      ] as const) {
        for (const { pid } of live) {
          try {
            process.kill(pid, signal);
          } catch {
            // The process exited between the scan and the signal.
          }
        }
        live = await waitForFixtureRelease(findLive, timeoutMs);
        if (live.length === 0) return;
      }

      throw new Error(
        `the Fixture database stays open by ${describeLive(live)}. Close Paired Zotero before starting a new Paired Run.`,
      );
    },

    allocateLiveUpdatePort() {
      return allocatePort();
    },

    allocateZoteroHttpPort() {
      return allocatePort();
    },

    async prepareDevelopmentVault({
      scopeCase,
      vaultCase,
      purge,
      liveUpdatePort,
      zoteroHttpPort,
    }) {
      const result = await runCaptured(
        process.execPath,
        [
          vaultScript,
          "open",
          `--scope-case=${scopeCase}`,
          ...(vaultCase === undefined ? [] : [`--vault-case=${vaultCase}`]),
          `--live-update-port=${liveUpdatePort}`,
          `--zotero-http-port=${zoteroHttpPort}`,
          ...(purge ? ["--purge"] : []),
        ],
        { cwd: workspaceRoot, forwardStderr: true },
      );
      const id = result.stdout.trim().split("\n").at(-1);
      if (!id)
        throw new Error("Obsidian did not return a Development Vault id");
      return { id, path: getDevVaultDir(workspaceRoot, vaultCase) };
    },

    async openPairedZotero() {
      const { applicationDir, env } = await zoteroEnvironment();
      const result = await runCaptured(process.execPath, [zoteroOpenScript], {
        cwd: workspaceRoot,
        env,
        forwardStderr: true,
      });
      const report = parseOpenReport(result.stdout);
      if (typeof report.pid !== "number") {
        throw new Error("Paired Zotero did not return a process id");
      }
      return { applicationDir, pid: report.pid };
    },

    async startDevelopmentSession({ vaultCase }) {
      const { applicationDir, env } = await zoteroEnvironment();
      return startDevelopmentSession({
        applicationDir,
        env,
        workspaceRoot,
        vaultCase,
      });
    },

    reportReady(result) {
      printReady(result);
    },
  };
}

/**
 * A free port on the loopback host used by both servers. The result stays free
 * only until something claims it, so the Paired Run writes it to the generated
 * configuration before it starts the corresponding server.
 */
function allocatePort(): Promise<number> {
  return getPort({ host: LIVE_UPDATE_HOSTNAME });
}

async function findWindowsFixtureZoteroProcesses(
  dataDir: string,
  cwd: string,
): Promise<LivePairedZotero[]> {
  const script =
    "$target = [IO.Path]::GetFullPath($env:ZT_FIXTURE_DATA_DIR); " +
    `Get-CimInstance Win32_Process -Filter "Name = 'zotero.exe'" | ` +
    "Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($target, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | " +
    'ForEach-Object { "$($_.ProcessId) $($_.Name)" }';
  const result = await runCaptured(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      cwd,
      env: { ...process.env, ZT_FIXTURE_DATA_DIR: dataDir },
    },
  );
  return findWindowsPairedZoteroProcesses(result.stdout);
}

/** Reads the `<pid> <name>` rows the Windows scan above writes. */
export function findWindowsPairedZoteroProcesses(
  output: string,
): LivePairedZotero[] {
  const processes: LivePairedZotero[] = [];
  for (const line of output.split("\n")) {
    const [rawPid, ...rest] = line.trim().split(" ");
    const pid = Number(rawPid);
    if (Number.isInteger(pid) && rest.length > 0) {
      processes.push({ command: rest.join(" "), pid });
    }
  }
  return processes;
}

/**
 * The Zotero processes that hold this Fixture's database open, or none when the
 * Fixture has no database yet.
 */
async function findLivePairedZotero(
  layout: FixtureLayout,
  cwd: string,
): Promise<LivePairedZotero[]> {
  const databaseExists = await access(layout.databasePath).then(
    () => true,
    () => false,
  );
  if (!databaseExists) return [];

  if (process.platform === "win32") {
    return findWindowsFixtureZoteroProcesses(layout.dataDir, cwd);
  }

  const result = await runCaptured(
    "/usr/sbin/lsof",
    ["-Fpc", "--", layout.databasePath],
    { acceptExitCodes: [0, 1], cwd },
  );
  // lsof answers 1 when nothing holds the file open.
  return result.code === 0 ? findPairedZoteroProcesses(result.stdout) : [];
}

/** Polls until nothing holds the Fixture database, or the deadline passes. */
async function waitForFixtureRelease(
  findLive: () => Promise<LivePairedZotero[]>,
  timeoutMs: number,
): Promise<LivePairedZotero[]> {
  const deadline = Date.now() + timeoutMs;
  let live = await findLive();
  while (live.length > 0 && Date.now() < deadline) {
    await delay(ZOTERO_EXIT_POLL_INTERVAL_MS);
    live = await findLive();
  }
  return live;
}

function describeLive(processes: readonly LivePairedZotero[]): string {
  return processes
    .map(({ command, pid }) => `${command} (pid ${pid})`)
    .join(", ");
}

function startDevelopmentSession({
  applicationDir,
  env,
  workspaceRoot,
  vaultCase,
}: {
  applicationDir: string;
  env: NodeJS.ProcessEnv;
  workspaceRoot: string;
  vaultCase?: string;
}): DevelopmentSession {
  // The Vite dev build copies each bundle into the Development Vault of this
  // run's Vault Case, so hot reload reaches a case vault too.
  const obsidian = spawnWatcher(
    "Obsidian watcher",
    ["--filter", "@zotlit/obsidian", "dev"],
    {
      cwd: workspaceRoot,
      env:
        vaultCase === undefined
          ? process.env
          : { ...process.env, [DEV_VAULT_CASE_ENV]: vaultCase },
    },
  );
  const zotero = spawnWatcher(
    "Zotero watcher",
    ["--filter", "@zotlit/zotero", "dev"],
    { cwd: workspaceRoot, env },
  );
  const processes = [obsidian, zotero];
  const ready = Promise.withResolvers<{
    applicationDir: string;
    pid: number;
  }>();
  const closed = Promise.withResolvers<void>();
  const exited = new Set<ManagedProcess>();
  let readySettled = false;
  let readySucceeded = false;
  let stopping = false;
  let failure: Error | undefined;

  pipeOutput(obsidian.child.stdout, process.stdout);
  pipeOutput(obsidian.child.stderr, process.stderr);
  pipeOutput(zotero.child.stderr, process.stderr);
  pipeLines(zotero.child.stdout, (line) => {
    process.stdout.write(`${line}\n`);
    const event = parseReadyEvent(line);
    if (!event || readySettled || failure) return;
    readySettled = true;
    readySucceeded = true;
    ready.resolve({ applicationDir, pid: event.pid });
  });

  const finish = (): void => {
    if (exited.size !== processes.length) return;
    cleanupSignals();
    if (!readySettled) {
      readySettled = true;
      ready.reject(failure ?? new Error("development session stopped"));
    }
    if (failure && readySucceeded) closed.reject(failure);
    else closed.resolve();
  };

  const stop = (signal: NodeJS.Signals): void => {
    stopping = true;
    for (const watcher of processes) {
      if (watcher.child.exitCode === null && !watcher.child.killed) {
        watcher.child.kill(signal);
      }
    }
  };

  for (const watcher of processes) {
    watcher.child.once("error", (error) => {
      if (!stopping && !failure) failure = error;
      stop("SIGTERM");
    });
    watcher.child.once("close", (code, signal) => {
      exited.add(watcher.child);
      if (!stopping && !failure) {
        const status = signal ?? `exit code ${code ?? "unknown"}`;
        failure = new Error(`${watcher.name} stopped with ${status}`);
        stop("SIGTERM");
      }
      finish();
    });
  }

  const onSigint = (): void => stop("SIGINT");
  const onSigterm = (): void => stop("SIGTERM");
  const cleanupSignals = (): void => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  return { ready: ready.promise, closed: closed.promise };
}

function spawnWatcher(
  name: string,
  args: string[],
  { cwd, env }: { cwd: string; env: NodeJS.ProcessEnv },
): { name: string; child: ManagedProcess } {
  return {
    name,
    child: spawn("pnpm", args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  };
}

function pipeOutput(source: Readable, destination: NodeJS.WriteStream): void {
  source.on("data", (chunk: Buffer) => destination.write(chunk));
}

function pipeLines(source: Readable, receive: (line: string) => void): void {
  let pending = "";
  source.setEncoding("utf-8");
  source.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) receive(line);
  });
  source.on("end", () => {
    if (pending) receive(pending);
  });
}

function parseReadyEvent(line: string): { pid: number } | undefined {
  const prefix = "[zotero-dev] ";
  if (!line.startsWith(prefix)) return undefined;
  try {
    const event = JSON.parse(line.slice(prefix.length)) as {
      event?: unknown;
      pid?: unknown;
    };
    if (event.event === ZOTERO_READY_EVENT && typeof event.pid === "number") {
      return { pid: event.pid };
    }
  } catch {
    // Ordinary Zotero dev logs are not JSON events.
  }
  return undefined;
}

function parseOpenReport(output: string): { pid?: unknown } {
  try {
    return JSON.parse(output) as { pid?: unknown };
  } catch {
    throw new Error("Paired Zotero returned an invalid launch report");
  }
}

export function findPairedZoteroProcesses(output: string): LivePairedZotero[] {
  const processes: LivePairedZotero[] = [];
  let pid: number | undefined;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) {
      const parsed = Number(line.slice(1));
      pid = Number.isInteger(parsed) ? parsed : undefined;
    }
    if (line.startsWith("c")) {
      const command = line.slice(1);
      if (command.toLowerCase() === "zotero" && pid !== undefined) {
        processes.push({ command, pid });
      }
    }
  }
  return processes;
}

function printReady({
  mode,
  vault,
  zotero,
  liveUpdatePort,
  zoteroHttpPort,
}: PairedRunReady): void {
  console.log(`Paired Run ready (${mode})`);
  console.log(`Development Vault  ${vault.path} (${vault.id})`);
  console.log(
    `Paired Zotero      ${zotero.applicationDir} (pid ${zotero.pid})`,
  );
  console.log(`Live Updates port  ${liveUpdatePort}`);
  console.log(`Zotero HTTP port   ${zoteroHttpPort}`);
  if (mode === "dev") console.log("Press Ctrl-C to stop the live Paired Run.");
}

interface RunOptions {
  acceptExitCodes?: number[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  forwardStderr?: boolean;
}

function runCaptured(
  command: string,
  args: string[],
  {
    acceptExitCodes = [0],
    cwd,
    env = process.env,
    forwardStderr = false,
  }: RunOptions,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (forwardStderr) process.stderr.write(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code !== null && acceptExitCodes.includes(code)) {
        resolve({ code, stdout });
        return;
      }
      const status = signal ?? `exit code ${code ?? "unknown"}`;
      reject(
        new Error(
          `${command} stopped with ${status}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
        ),
      );
    });
  });
}
