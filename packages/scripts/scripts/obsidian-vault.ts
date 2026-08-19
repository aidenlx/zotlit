#!/usr/bin/env node

// Registers and unregisters this worktree's Obsidian debug vault.
//
// Obsidian holds its vault registry in main-process memory and overwrites
// `obsidian.json` on many events, so editing that file is safe only while the
// app is shut. While it runs, the registry is reachable on the `vault-open` /
// `vault-remove` / `vault-list` IPC channels, which the Obsidian CLI `eval`
// command reaches from inside a vault window. This drives whichever route
// applies, so cleanup never has to wake a shut app.
//
// Creating needs Obsidian 1.12.7+ with "Command line interface" enabled
// (Settings → General) and one open vault window to host the eval calls.

import {
  access,
  constants,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { connect } from "node:net";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { $ } from "zx";

import { getDevVaultDir, getFixtureVaultDir } from "#dev-vault";
import { buildFixture, getFixtureLayout, getFixtureRoot } from "#fixture";
import { getWorkspaceRoot } from "#package-roots";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);

const defaultVault = getDevVaultDir(workspaceRoot);
const fixtureLayout = getFixtureLayout(getFixtureRoot(workspaceRoot));
const fixtureVault = getFixtureVaultDir(workspaceRoot);
const pluginId = "zotlit";
const CONTRACT_VERSION = 1;
const OBSIDIAN_CLI_ENV = "OBSIDIAN_CLI";
const HOST_VAULT_ENV = "ZT_HOST_VAULT";

const cliCandidates = [
  "/Applications/Obsidian.app/Contents/MacOS/obsidian-cli",
  join(homedir(), "Applications/Obsidian.app/Contents/MacOS/obsidian-cli"),
  join(homedir(), ".local/bin/obsidian-cli"),
];

interface VaultEntry {
  path: string;
  ts: number;
  open?: boolean;
}

let cliPath: string | undefined;

async function getCli(): Promise<string> {
  if (cliPath) return cliPath;
  const override = process.env[OBSIDIAN_CLI_ENV];
  if (override) return (cliPath = override);

  const found = await $({ nothrow: true })`which obsidian-cli`;
  if (found.exitCode === 0) return (cliPath = found.stdout.trim());

  for (const candidate of cliCandidates) {
    try {
      await access(candidate, constants.X_OK);
      return (cliPath = candidate);
    } catch {
      continue;
    }
  }
  throw new Error(
    `obsidian-cli not found. Set ${OBSIDIAN_CLI_ENV} to its path.`,
  );
}

/** Where Obsidian keeps `obsidian.json`, the per-vault state, and Partitions. */
function obsidianUserData(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library/Application Support/obsidian");
  }
  if (process.platform === "linux") {
    return join(
      process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
      "obsidian",
    );
  }
  throw new Error(
    `unsupported platform for vault cleanup: ${process.platform}`,
  );
}

/** Obsidian creates this socket at start and unlinks it when it quits. */
function cliSocketPath(): string {
  const base =
    process.platform === "darwin"
      ? homedir()
      : (process.env.XDG_RUNTIME_DIR ?? homedir());
  return join(base, ".obsidian-cli.sock");
}

/**
 * Whether a live Obsidian answers its CLI socket. Connecting proves the app is
 * up without launching it. This probes the socket rather than the `obsidian-cli`
 * binary, because a missing binary or a disabled CLI setting would otherwise
 * read as "closed" and send a live registry down the offline edit path.
 */
function isObsidianRunning(): Promise<boolean> {
  return new Promise((settle) => {
    const socket = connect(cliSocketPath());
    const finish = (running: boolean) => {
      socket.destroy();
      settle(running);
    };
    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
  });
}

/** The Obsidian CLI always exits 0 — failures come back only as output text. */
async function cli(args: string[]): Promise<string> {
  const bin = await getCli();
  const result = await $({ nothrow: true })`${bin} ${args}`;
  return `${result.stdout}${result.stderr}`.trim();
}

/** Run JavaScript in a vault window. Without `target`, the focused one answers. */
async function obEval(code: string, target?: string): Promise<string> {
  const text = await cli([
    ...(target ? [`vault=${target}`] : []),
    "eval",
    `code=${code}`,
  ]);
  if (text === "") return "";
  if (!text.startsWith("=> ")) {
    throw new Error(`obsidian-cli eval failed: ${text}`);
  }
  return text.slice(3);
}

async function vaultList(host?: string): Promise<Record<string, VaultEntry>> {
  const raw = await obEval(
    `require('electron').ipcRenderer.sendSync('vault-list')`,
    host,
  );
  return JSON.parse(raw) as Record<string, VaultEntry>;
}

function findVaultId(
  vaults: Record<string, VaultEntry>,
  abs: string,
): string | undefined {
  return Object.keys(vaults).find((id) => resolve(vaults[id]!.path) === abs);
}

async function waitFor(
  check: () => Promise<boolean>,
  tries = 40,
): Promise<boolean> {
  for (let attempt = 0; attempt < tries; attempt++) {
    if (await check()) return true;
    await delay(250);
  }
  return false;
}

/**
 * Pick a window to run the eval calls in. `exclude` is a vault id to keep away
 * from: a `vault=<id>` request re-opens a closed vault instead of failing, so
 * the window of a vault under removal must never host its own removal.
 */
async function resolveHost(exclude?: string): Promise<string> {
  const preferred = process.env[HOST_VAULT_ENV];
  if (preferred) {
    const id = await obEval("app.appId", preferred);
    if (id === exclude) {
      throw new Error(`${HOST_VAULT_ENV} points at the vault being removed`);
    }
    return id;
  }

  const focused = await obEval("app.appId").catch(() => {
    throw new Error(
      `no Obsidian window answered. Open a vault, or set ${HOST_VAULT_ENV}.`,
    );
  });
  if (focused !== exclude) return focused;

  const vaults = await vaultList(focused);
  const other = Object.keys(vaults).find(
    (id) => id !== exclude && vaults[id]!.open,
  );
  if (!other) {
    throw new Error(
      `no other open vault can host the removal. Open one, or set ${HOST_VAULT_ENV}.`,
    );
  }
  return other;
}

async function create(vaultPath: string): Promise<void> {
  const abs = resolve(vaultPath);
  const host = await resolveHost();
  const vaults = await vaultList(host);

  const existing = findVaultId(vaults, abs);
  if (existing) throw new Error(`already registered as ${existing}: ${abs}`);

  // A duplicate folder name would make `vault=<name>` ambiguous, because
  // Obsidian resolves that to the first basename match.
  const name = basename(abs);
  const clash = Object.keys(vaults).find(
    (id) => basename(resolve(vaults[id]!.path)) === name,
  );
  if (clash) {
    throw new Error(
      `vault name "${name}" is taken by ${clash} at ${vaults[clash]!.path}. Rename this worktree folder.`,
    );
  }

  await rebuildFixtureVault(abs);

  // `force: false` preserves the bundle that `build:dev` copied into the dev
  // vault before this script generated its seed.
  await mkdir(join(abs, ".obsidian", "plugins"), { recursive: true });
  if (abs !== resolve(fixtureVault)) {
    await cp(fixtureVault, abs, { recursive: true, force: false });
  }

  // Obsidian loads the plugin from the vault, so the bundle has to be in place
  // before the window opens; registering first would only show an empty vault.
  const bundle = join(abs, ".obsidian", "plugins", pluginId, "main.js");
  await access(bundle).catch(() => {
    throw new Error(
      `${pluginId} is not built into ${abs}. Run 'pnpm --filter @zotlit/obsidian build:dev' first.`,
    );
  });

  // `vault-open` registers the path and opens its window. Pass create=false
  // because the folder is already there; create=true rejects an existing one.
  const opened = await obEval(
    `require('electron').ipcRenderer.sendSync('vault-open',${JSON.stringify(abs)},false)`,
    host,
  );
  if (opened !== "true") {
    throw new Error(`vault-open refused: ${opened || "unknown error"}`);
  }

  let registered: string | undefined;
  await waitFor(async () => {
    registered = findVaultId(await vaultList(host), abs);
    return Boolean(registered);
  });
  if (!registered) {
    throw new Error(`vault registered but no id appeared for ${abs}`);
  }
  const id = registered;
  const windowOpen = await waitFor(
    async () => (await vaultList(host))[id]?.open === true,
  );
  if (!windowOpen) {
    throw new Error(`vault ${id} registered but its window never opened`);
  }

  console.log(id);
  console.error(`created vault ${id} at ${abs}`);

  // A window answers `eval` before its command registry is built, so wait for
  // the vault to report a Restricted Mode state before acting on it.
  const answered = await waitFor(async () => {
    const state = await cli([`vault=${id}`, "plugins:restrict"]);
    return state === "on" || state === "off";
  });
  if (!answered) {
    throw new Error(`vault ${id} opened but never answered plugins:restrict`);
  }

  // A fresh vault starts in Restricted Mode, which makes it ignore the seeded
  // `community-plugins.json`. Trusting the vault reloads the window, and the
  // plugin loads from that file — no separate `plugin:enable` needed.
  const trusted = await cli([`vault=${id}`, "plugins:restrict", "off"]);
  if (!/disabled|^off$/i.test(trusted)) {
    throw new Error(`could not leave Restricted Mode in ${id}: ${trusted}`);
  }

  // Confirm the plugin object exists — `enabledPlugins` only mirrors
  // `community-plugins.json` and says nothing about what actually loaded.
  const loaded = await waitFor(async () => {
    const answer = await obEval(
      `String(${JSON.stringify(pluginId)} in app.plugins.plugins)`,
      id,
    ).catch(() => "");
    return answer === "true";
  });
  if (!loaded) {
    throw new Error(
      `${pluginId} did not load in ${id}. Run 'pnpm --filter @zotlit/obsidian build:dev' and create again.`,
    );
  }
}

/**
 * Rebuild and re-copy the Fixture Vault over an already-created dev vault.
 * The vault folder path stays the same, so Obsidian's registry needs no update.
 */
async function sync(vaultPath: string, purge: boolean): Promise<void> {
  const abs = resolve(vaultPath);

  await access(abs).catch(() => {
    throw new Error(`no vault at ${abs}. Run 'create' first.`);
  });

  // Build before a purge so the generated seed captures the current dev bundle.
  await rebuildFixtureVault(abs);

  // `--purge` deletes the folder first, so renamed or removed Fixture files
  // drop out too, not just the ones the Fixture Vault still has.
  if (purge) {
    await purgeVault(abs);
    await mkdir(abs, { recursive: true });
  }

  if (abs !== resolve(fixtureVault)) {
    await cp(fixtureVault, abs, { recursive: true, force: true });
  }

  console.error(`synced ${fixtureVault} -> ${abs}`);
}

async function rebuildFixtureVault(target: string): Promise<void> {
  if (resolve(target) === resolve(fixtureVault)) return;

  const pluginBundleDir = join(
    resolve(target),
    ".obsidian",
    "plugins",
    pluginId,
  );
  const hasBundle = await access(join(pluginBundleDir, "main.js")).then(
    () => true,
    () => false,
  );
  await buildFixture(fixtureLayout, {
    pluginBundleDir: hasBundle ? pluginBundleDir : undefined,
  });
}

/**
 * Unregister without a running app, by editing the registry file directly.
 * Safe only while Obsidian is shut: a running main process holds the registry
 * in memory and would overwrite the file on its next save. The shared-origin
 * localStorage and IndexedDB keys need a live window, so they stay behind —
 * a few stale LevelDB keys that Obsidian ignores.
 */
async function removeOffline(abs: string): Promise<string | undefined> {
  const userData = obsidianUserData();
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

async function removeOnline(abs: string): Promise<string | undefined> {
  let host = await resolveHost();
  const id = findVaultId(await vaultList(host), abs);

  if (id) {
    if (id === host) host = await resolveHost(id);

    // `vault-remove` refuses while the vault window is open. Close it only when
    // it is open, because targeting a closed vault would re-open it.
    if ((await vaultList(host))[id]?.open) {
      await obEval("window.close()", id).catch(() => undefined);
      await waitFor(async () => !(await vaultList(host))[id]?.open);
    }

    // localStorage and IndexedDB live in the shared `app://obsidian.md` origin,
    // so a surviving window clears the keys that `vault-remove` leaves behind.
    await obEval(
      `(function(){var id=${JSON.stringify(id)};` +
        `Object.keys(localStorage).filter(function(k){return k.indexOf(id+'-')===0||k==='enable-plugin-'+id})` +
        `.forEach(function(k){localStorage.removeItem(k)});` +
        `['cache','webview','backup','sync'].forEach(function(n){indexedDB.deleteDatabase(id+'-'+n)});` +
        `return 'ok'})()`,
      host,
    ).catch(() => undefined);

    const removed = await obEval(
      `require('electron').ipcRenderer.sendSync('vault-remove',${JSON.stringify(abs)})`,
      host,
    );
    if (removed !== "true") {
      throw new Error(`vault-remove refused for ${abs} (window still open?)`);
    }
  }
  return id;
}

async function purgeVault(abs: string): Promise<void> {
  await access(join(abs, ".obsidian")).catch(() => {
    throw new Error(`refusing to purge a folder with no .obsidian: ${abs}`);
  });

  // A folder outside any repo has nothing tracked, but any other git failure
  // means the guard never ran — refuse rather than delete on an unproven check.
  const tracked = await $({
    nothrow: true,
    quiet: true,
    cwd: abs,
  })`git ls-files -- .`;
  if (tracked.exitCode !== 0 && !/not a git repository/i.test(tracked.stderr)) {
    throw new Error(
      `could not check tracked files in ${abs}: ${tracked.stderr.trim() || `git exited ${tracked.exitCode}`}`,
    );
  }
  if (tracked.stdout.trim()) {
    throw new Error(
      `refusing to purge a folder holding git-tracked files: ${abs}`,
    );
  }

  await rm(abs, { recursive: true, force: true });
  console.error(`deleted folder ${abs}`);
}

async function remove(vaultPath: string, purge: boolean): Promise<void> {
  const abs = resolve(vaultPath);

  // Cleanup must never wake a shut app, so branch on whether one answers.
  const running = await isObsidianRunning();
  let id: string | undefined;
  let failure: unknown;
  try {
    id = running ? await removeOnline(abs) : await removeOffline(abs);
  } catch (error) {
    failure = error;
  }

  if (id) {
    console.error(`removed vault ${id}${running ? "" : " (Obsidian closed)"}`);
  } else if (!failure) {
    console.error(`not registered: ${abs}`);
  }

  // Purge even when unregistering failed. Obsidian drops registry entries whose
  // folder has gone at its next start, so removing the folder lets a stranded
  // entry heal itself instead of outliving the worktree.
  if (purge) await purgeVault(abs);
  if (failure) throw failure;
}

const vaultPathPosition = {
  describe: `vault path (default: ${defaultVault})`,
  type: "string",
} as const;

const syncPurgeOption = {
  describe:
    "delete the dev-vault folder before restoring the complete generated seed",
  type: "boolean",
  default: false,
} as const;

const removePurgeOption = {
  describe: "delete the dev-vault folder after unregistering it",
  type: "boolean",
  default: false,
} as const;

const reference = `contractVersion: ${CONTRACT_VERSION}

The create and sync commands rebuild the Fixture Vault first. Run the Obsidian
dev build before create so its bundle is available to copy into the generated
seed. Sync keeps extra dev-vault files unless --purge is set. Remove keeps the
folder unless --purge is set.

Environment:
  ${OBSIDIAN_CLI_ENV}   path to the obsidian-cli binary
  ${HOST_VAULT_ENV}  vault name or id whose window hosts eval calls`;

const vaultCli = yargs(hideBin(process.argv))
  .scriptName("obsidian-vault.ts")
  .command(
    "create [vault-path]",
    "seed and register this worktree's dev vault",
    (y) => y.positional("vault-path", vaultPathPosition),
    async (argv) => {
      await create(argv["vault-path"] ?? defaultVault);
    },
  )
  .command(
    "sync [vault-path]",
    "rebuild and copy the Fixture Vault over an existing dev vault",
    (y) =>
      y
        .positional("vault-path", vaultPathPosition)
        .option("purge", syncPurgeOption),
    async (argv) => {
      await sync(argv["vault-path"] ?? defaultVault, argv.purge);
    },
  )
  .command(
    "remove [vault-path]",
    "unregister this worktree's dev vault",
    (y) =>
      y
        .positional("vault-path", vaultPathPosition)
        .option("purge", removePurgeOption),
    async (argv) => {
      await remove(argv["vault-path"] ?? defaultVault, argv.purge);
    },
  )
  .command(
    "list",
    "list known vaults",
    () => {},
    async () => {
      console.log(
        await cli([`vault=${await resolveHost()}`, "vaults", "verbose"]),
      );
    },
  )
  .command(
    "id [vault-path]",
    "print the registered id for a vault path",
    (y) => y.positional("vault-path", vaultPathPosition),
    async (argv) => {
      const host = await resolveHost();
      const target = argv["vault-path"] ?? defaultVault;
      console.log(findVaultId(await vaultList(host), resolve(target)) ?? "");
    },
  )
  .epilogue(reference)
  .demandCommand(1, 1)
  .strict()
  .version(false)
  .fail((message, error) => {
    console.error(
      `obsidian-vault: ${error instanceof Error ? error.message : (message ?? String(error))}`,
    );
    process.exitCode = 1;
    throw error instanceof Error ? error : new Error(String(message));
  });

try {
  await vaultCli.parseAsync();
} catch {
  // The fail handler reported the error and set the exit code.
}
