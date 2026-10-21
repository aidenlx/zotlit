// Obsidian's vault registry file, `obsidian.json` in its user data folder.

import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface VaultEntry {
  path: string;
  ts: number;
  open?: boolean;
}

export function findVaultId(
  vaults: Record<string, VaultEntry>,
  abs: string,
): string | undefined {
  return Object.keys(vaults).find((id) => resolve(vaults[id]!.path) === abs);
}

/**
 * Unregister the vault at `abs` by editing the registry file directly, and
 * delete its per-vault state and Partition. Safe only while Obsidian is shut:
 * a running main process holds the registry in memory and would overwrite the
 * file on its next save. Returns the removed vault ID, or `undefined` when the
 * registry holds no vault at `abs`.
 */
export async function unregisterVaultFile(
  userData: string,
  abs: string,
): Promise<string | undefined> {
  const configPath = join(userData, "obsidian.json");

  // No registry file means nothing was ever registered.
  const raw = await readFile(configPath, "utf-8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (raw === undefined) return undefined;

  let config: { vaults?: Record<string, VaultEntry> };
  try {
    config = JSON.parse(raw) as typeof config;
  } catch {
    throw new Error(
      `${configPath} holds invalid JSON — refusing to rewrite it`,
    );
  }

  const vaults = config.vaults ?? {};
  const id = findVaultId(vaults, abs);
  if (!id) return undefined;

  delete vaults[id];
  config.vaults = vaults;
  // Write through a temp file, so an interrupted run cannot truncate the
  // registry and cost every other vault its entry.
  const staging = `${configPath}.zt-tmp`;
  await writeFile(staging, JSON.stringify(config));
  await rename(staging, configPath);

  await rm(join(userData, `${id}.json`), { force: true });
  await rm(join(userData, "Partitions", `vault-${id}`), {
    recursive: true,
    force: true,
  });
  return id;
}
