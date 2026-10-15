// Bounded Obsidian vault-host discovery and registry-based recovery diagnostics.

import { basename, resolve } from "node:path";

export const OBSIDIAN_HOST_TIMEOUT_MS = 5_000;
/** Opening a closed vault loads a new window, so its probe waits longer. */
export const OBSIDIAN_VAULT_OPEN_TIMEOUT_MS = 30_000;
export const OBSIDIAN_HOST_VAULT_ENV = "ZT_HOST_VAULT";

const CHECK_COMMAND = "packages/scripts/scripts/obsidian-vault.ts check";
const HOST_PROBE =
  "JSON.stringify({id:app.appId,path:app.vault.adapter.basePath})";
/**
 * Obsidian's reply to a call without `vault=` when no vault window is open and
 * the working directory is outside every registered vault.
 */
const NO_VAULT_WINDOW = "Vault not found.";
const LIVE_VAULTS_PROBE =
  "JSON.stringify(require('electron').ipcRenderer.sendSync('vault-list'))";

interface RegistryVaultEntry {
  open?: boolean;
  path: string;
  ts?: number;
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
  /** Obsidian's sandbox vault folder, the preferred host to open when no vault window is open. */
  sandboxVaultPath?: string;
  timeoutMs?: number;
  vaultOpenTimeoutMs?: number;
}

interface HostCheckOptions {
  /** A vault folder the check must not open as the host. */
  avoidPath?: string;
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

function selectOpenHost(
  vaults: Array<ObsidianHost & { open?: boolean }>,
  selected: string,
): ObsidianHost | undefined {
  const exact = vaults.filter((vault) => vault.id === selected);
  const matches =
    exact.length > 0
      ? exact
      : vaults.filter((vault) => basename(vault.path) === selected);
  return matches.length === 1 && matches[0]!.open === true
    ? matches[0]
    : undefined;
}

export function createObsidianHostReadiness(
  effects: HostReadinessEffects,
  {
    environment = process.env,
    sandboxVaultPath,
    timeoutMs = OBSIDIAN_HOST_TIMEOUT_MS,
    vaultOpenTimeoutMs = OBSIDIAN_VAULT_OPEN_TIMEOUT_MS,
  }: HostReadinessConfig = {},
): (options?: HostCheckOptions) => Promise<ObsidianHost> {
  const noLiveHost = `No live Obsidian vault answered within ${timeoutLabel(timeoutMs)}.`;

  return async ({ avoidPath }: HostCheckOptions = {}) => {
    const fail = async (message: string): Promise<never> => {
      throw await readinessError(message, effects);
    };
    const run = async (
      code: string,
      target?: string,
      { limitMs, timeoutMessage } = {
        limitMs: timeoutMs,
        timeoutMessage: noLiveHost,
      },
    ): Promise<string> => {
      try {
        return await runWithTimeout(
          (signal) =>
            effects.runObsidian(
              [...(target ? [`vault=${target}`] : []), "eval", `code=${code}`],
              signal,
            ),
          limitMs,
        );
      } catch {
        return fail(timeoutMessage);
      }
    };
    const evaluate = async (code: string, target?: string): Promise<string> => {
      const output = await run(code, target);
      if (!output.startsWith("=> ")) return fail(noLiveHost);
      return output.slice(3);
    };
    // A call with `vault=<id>` makes Obsidian open that registered vault's
    // window and holds the call until the window has loaded, so a running
    // Obsidian with no vault window can still host calls. The sandbox vault is
    // preferred; else the most recently opened registered vault.
    const openRegisteredVault = async (): Promise<string> => {
      const noVaultWindow = "Obsidian is running, but no vault window is open.";
      let registry: Record<string, RegistryVaultEntry>;
      try {
        registry = await effects.readRegistry();
      } catch {
        return fail(
          `${noVaultWindow} Cannot read the Obsidian vault registry to find a vault to open.`,
        );
      }
      const isSandbox = (path: string): boolean =>
        sandboxVaultPath !== undefined &&
        resolve(path) === resolve(sandboxVaultPath);
      const candidates = Object.entries(registry)
        .filter(
          ([, vault]) =>
            avoidPath === undefined ||
            resolve(vault.path) !== resolve(avoidPath),
        )
        .sort(
          ([, a], [, b]) =>
            Number(isSandbox(b.path)) - Number(isSandbox(a.path)) ||
            (b.ts ?? 0) - (a.ts ?? 0),
        );
      let hostId: string | undefined;
      for (const [id, vault] of candidates) {
        if (await effects.pathExists(vault.path)) {
          hostId = id;
          break;
        }
      }
      if (!hostId) {
        return fail(
          `${noVaultWindow} No registered vault can be opened as the host.`,
        );
      }
      const output = await run(HOST_PROBE, hostId, {
        limitMs: vaultOpenTimeoutMs,
        timeoutMessage: `Obsidian vault ${hostId} did not open within ${timeoutLabel(vaultOpenTimeoutMs)}.`,
      });
      if (!output.startsWith("=> ")) {
        return fail(`Obsidian vault ${hostId} did not open.`);
      }
      if (parseHost(output.slice(3))?.id !== hostId) {
        return fail(`Obsidian vault ${hostId} returned a different vault ID.`);
      }
      return output.slice(3);
    };

    const selected = environment[OBSIDIAN_HOST_VAULT_ENV];
    if (!selected) {
      const output = await run(HOST_PROBE);
      if (output !== NO_VAULT_WINDOW && !output.startsWith("=> ")) {
        return fail(noLiveHost);
      }
      const focused = parseHost(
        output === NO_VAULT_WINDOW
          ? await openRegisteredVault()
          : output.slice(3),
      );
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
      return focused;
    }

    let registry: Record<string, RegistryVaultEntry>;
    try {
      registry = await effects.readRegistry();
    } catch {
      return fail(
        `Cannot read the Obsidian vault registry to select ${selected}.`,
      );
    }
    const registeredVaults = Object.entries(registry).map(([id, vault]) => ({
      ...vault,
      id,
    }));
    const host = selectOpenHost(registeredVaults, selected);
    if (!host) {
      return fail(
        `${OBSIDIAN_HOST_VAULT_ENV} does not identify one open vault: ${selected}`,
      );
    }
    // Obsidian resolves IDs and case-insensitive folder names in one pass.
    const collision = registeredVaults.find(
      (vault) =>
        vault.id !== host.id &&
        basename(vault.path).toLowerCase() === host.id.toLowerCase(),
    );
    if (collision) {
      return fail(
        `Selected Obsidian vault ${host.id} conflicts with vault ${collision.id}: its folder name can select a different vault. Select a different host vault or remove the conflicting registration from Obsidian.`,
      );
    }
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
    const liveVaults = parseLiveVaults(
      await evaluate(LIVE_VAULTS_PROBE, host.id),
    );
    if (!liveVaults) {
      return fail("Obsidian answered, but its live vault list was invalid.");
    }
    const liveHost = selectOpenHost(liveVaults, selected);
    if (!liveHost) {
      return fail(
        `${OBSIDIAN_HOST_VAULT_ENV} does not identify one open vault: ${selected}`,
      );
    }
    if (liveHost.id !== host.id || liveHost.path !== host.path) {
      return fail(
        `Selected Obsidian vault ${host.id} returned a different vault ID or base path.`,
      );
    }
    return responding;
  };
}
