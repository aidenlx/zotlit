// Bounded Obsidian vault-host discovery and registry-based recovery diagnostics.

import { basename } from "node:path";

export const OBSIDIAN_HOST_TIMEOUT_MS = 5_000;
export const OBSIDIAN_HOST_VAULT_ENV = "ZT_HOST_VAULT";

const CHECK_COMMAND = "packages/scripts/scripts/obsidian-vault.ts check";
const HOST_PROBE =
  "JSON.stringify({id:app.appId,path:app.vault.adapter.basePath})";
const LIVE_VAULTS_PROBE =
  "JSON.stringify(require('electron').ipcRenderer.sendSync('vault-list'))";

interface RegistryVaultEntry {
  open?: boolean;
  path: string;
}

interface HostReadinessEffects {
  pathExists(path: string): Promise<boolean>;
  readRegistry(): Promise<Record<string, RegistryVaultEntry>>;
  runObsidian(args: string[], signal: AbortSignal): Promise<string>;
}

export interface ObsidianHost {
  id: string;
  path: string;
}

interface HostReadinessConfig {
  environment?: Record<string, string | undefined>;
  timeoutMs?: number;
}

function timeoutLabel(timeoutMs: number): string {
  return timeoutMs % 1_000 === 0
    ? `${timeoutMs / 1_000} seconds`
    : `${timeoutMs} milliseconds`;
}

async function runWithTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timeout = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    controller.abort();
    timeout.reject(new Error("Obsidian CLI probe timed out"));
  }, timeoutMs);
  try {
    return await Promise.race([run(controller.signal), timeout.promise]);
  } finally {
    clearTimeout(timer);
  }
}

async function readinessError(
  message: string,
  effects: HostReadinessEffects,
): Promise<Error> {
  let diagnosis: string;
  try {
    const existing: string[] = [];
    const missing: string[] = [];
    const vaults = await effects.readRegistry();
    for (const [id, vault] of Object.entries(vaults)) {
      const detail = `${vault.path} (${id}${vault.open === undefined ? "" : `; persisted open: ${String(vault.open)}`})`;
      ((await effects.pathExists(vault.path)) ? existing : missing).push(
        detail,
      );
    }
    existing.sort();
    missing.sort();
    diagnosis = `Existing registered vaults:\n${existing.map((entry) => `  - ${entry}`).join("\n") || "  none"}\n\nRegistered paths that are missing:\n${missing.map((entry) => `  - ${entry}`).join("\n") || "  none"}`;
  } catch (error) {
    diagnosis = `Registry diagnosis unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }

  return new Error(
    `${message}\n\n${diagnosis}\n\nOpen a host vault in Obsidian, then rerun:\n  ${CHECK_COMMAND}\n\nTo select the open host explicitly:\n  ${OBSIDIAN_HOST_VAULT_ENV}=<vault-id-or-folder-name> ${CHECK_COMMAND}`,
  );
}

function parseHost(raw: string): ObsidianHost | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const host = value as { id?: unknown; path?: unknown };
  if (
    typeof host.id !== "string" ||
    !host.id ||
    typeof host.path !== "string" ||
    !host.path
  ) {
    return undefined;
  }
  return { id: host.id, path: host.path };
}

function parseLiveVaults(
  raw: string,
): Array<{ id: string; open: boolean; path: string }> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const vaults: Array<{ id: string; open: boolean; path: string }> = [];
  for (const [id, entry] of Object.entries(value)) {
    if (typeof entry !== "object" || entry === null) return undefined;
    const vault = entry as { open?: unknown; path?: unknown };
    if (typeof vault.path !== "string") return undefined;
    vaults.push({ id, open: vault.open === true, path: vault.path });
  }
  return vaults;
}

export function createObsidianHostReadiness(
  effects: HostReadinessEffects,
  {
    environment = process.env,
    timeoutMs = OBSIDIAN_HOST_TIMEOUT_MS,
  }: HostReadinessConfig = {},
): () => Promise<ObsidianHost> {
  const noLiveHost = `No live Obsidian vault answered within ${timeoutLabel(timeoutMs)}.`;

  return async () => {
    const fail = async (message: string): Promise<never> => {
      throw await readinessError(message, effects);
    };
    const evaluate = async (code: string, target?: string): Promise<string> => {
      let output: string;
      try {
        output = await runWithTimeout(
          (signal) =>
            effects.runObsidian(
              [...(target ? [`vault=${target}`] : []), "eval", `code=${code}`],
              signal,
            ),
          timeoutMs,
        );
      } catch {
        return fail(noLiveHost);
      }
      if (!output.startsWith("=> ")) return fail(noLiveHost);
      return output.slice(3);
    };

    const focused = parseHost(await evaluate(HOST_PROBE));
    if (!focused) {
      return fail(
        "Obsidian answered, but it did not return a valid vault ID and base path.",
      );
    }
    if (!(await effects.pathExists(focused.path))) {
      return fail(
        `Obsidian vault ${focused.id} answered, but its base path is missing: ${focused.path}`,
      );
    }

    const selected = environment[OBSIDIAN_HOST_VAULT_ENV];
    if (
      !selected ||
      selected === focused.id ||
      selected === basename(focused.path)
    ) {
      return focused;
    }

    const liveVaults = parseLiveVaults(
      await evaluate(LIVE_VAULTS_PROBE, focused.id),
    );
    if (!liveVaults) {
      return fail("Obsidian answered, but its live vault list was invalid.");
    }
    const exact = liveVaults.filter((vault) => vault.id === selected);
    const matches =
      exact.length > 0
        ? exact
        : liveVaults.filter((vault) => basename(vault.path) === selected);
    if (matches.length !== 1 || matches[0]!.open !== true) {
      return fail(
        `${OBSIDIAN_HOST_VAULT_ENV} does not identify one open vault: ${selected}`,
      );
    }
    const host = matches[0]!;
    if (!(await effects.pathExists(host.path))) {
      return fail(
        `Selected Obsidian vault ${host.id} has a missing base path: ${host.path}`,
      );
    }
    const responding = parseHost(await evaluate(HOST_PROBE, host.id));
    if (
      !responding ||
      responding.id !== host.id ||
      responding.path !== host.path
    ) {
      return fail(
        `Selected Obsidian vault ${host.id} returned a different vault ID or base path.`,
      );
    }
    if (!(await effects.pathExists(responding.path))) {
      return fail(
        `Selected Obsidian vault ${responding.id} has a missing base path: ${responding.path}`,
      );
    }
    return responding;
  };
}
