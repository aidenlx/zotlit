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
// Creating needs Obsidian 1.13.4+ with "Command line interface" enabled
// (Settings → General) and one open vault window to host the eval calls.

import { execFile } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { getDevVaultDir, getFixtureVaultDir } from "#dev-vault";
import {
  buildFixture,
  DEFAULT_SCOPE_CASE,
  getFixtureLayout,
  getFixtureRoot,
  SCOPE_CASES,
} from "#fixture";
import { getWorkspaceRoot } from "#package-roots";

const execFileAsync = promisify(execFile);

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);

const defaultVault = getDevVaultDir(workspaceRoot);
const fixtureLayout = getFixtureLayout(getFixtureRoot(workspaceRoot));
const fixtureVault = getFixtureVaultDir(workspaceRoot);
const pluginId = "zotlit";
const CONTRACT_VERSION = 2;
const HOST_VAULT_ENV = "ZT_HOST_VAULT";

interface VaultEntry {
  path: string;
  ts: number;
  open?: boolean;
}

/** Where Obsidian keeps `obsidian.json`, per-vault state, and Partitions. */
function obsidianUserData(): string {
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      "obsidian",
    );
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "obsidian");
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

/** The Obsidian CLI always exits 0 — failures come back only as output text. */
async function cli(args: string[]): Promise<string> {
  const result = await execFileAsync("obsidian", args, { windowsHide: true });
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
    throw new Error(`obsidian eval failed: ${text}`);
  }
  return text.slice(3);
}

function isObsidianRunning(): Promise<boolean> {
  return obEval("true").then(
    (answer) => answer === "true",
    () => false,
  );
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

  const focused = await obEval("app.appId").catch(() => "");
  if (!focused) {
    throw new Error(
      `no Obsidian window answered. Open a vault, or set ${HOST_VAULT_ENV}.`,
    );
  }
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

interface SeedOptions {
  purge?: boolean;
  scopeCase?: string;
}

async function create(
  vaultPath: string,
  { purge = false, scopeCase = DEFAULT_SCOPE_CASE }: SeedOptions = {},
): Promise<void> {
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

  await rebuildFixtureVault(abs, scopeCase);
  if (purge) {
    const exists = await access(abs).then(
      () => true,
      () => false,
    );
    if (exists) await purgeVault(abs);
  }

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
  await linkFixture(id);
}

/** Release Windows file handles while the generated Fixture is replaced. */
async function suspendLoadedPlugin(abs: string): Promise<AsyncDisposableStack> {
  await using suspension = new AsyncDisposableStack();
  if (process.platform !== "win32" || !(await isObsidianRunning())) {
    return suspension.move();
  }

  const host = await resolveHost();
  const vaults = await vaultList(host);
  const id = findVaultId(vaults, abs);
  if (!id || vaults[id]?.open !== true) return suspension.move();

  const loaded = await obEval(
    `String(${JSON.stringify(pluginId)} in app.plugins.plugins)`,
    id,
  ).catch(() => "false");
  if (loaded !== "true") return suspension.move();

  const disabled = await cli([
    `vault=${id}`,
    "plugin:disable",
    `id=${pluginId}`,
  ]);
  if (!disabled.toLowerCase().startsWith("disabled:")) {
    throw new Error(`could not disable ZotLit in ${id}: ${disabled}`);
  }
  suspension.defer(async () => {
    const enabled = await cli([
      `vault=${id}`,
      "plugin:enable",
      `id=${pluginId}`,
    ]);
    if (!enabled.toLowerCase().startsWith("enabled:")) {
      throw new Error(`could not re-enable ZotLit in ${id}: ${enabled}`);
    }
  });
  return suspension.move();
}

/**
 * Rebuild and re-copy the Fixture Vault over an existing Development Vault.
 * The vault folder path stays the same, so Obsidian's registry needs no update.
 */
async function sync(
  vaultPath: string,
  { purge = false, scopeCase = DEFAULT_SCOPE_CASE }: SeedOptions = {},
): Promise<void> {
  const abs = resolve(vaultPath);

  await access(abs).catch(() => {
    throw new Error(`no vault at ${abs}. Run 'create' first.`);
  });

  {
    await using _pluginSuspension = await suspendLoadedPlugin(abs);
    // Build before a purge so the generated seed captures the current dev bundle.
    await rebuildFixtureVault(abs, scopeCase);

    // `--purge` deletes the folder first, so renamed or removed Fixture files
    // drop out too, not just the ones the Fixture Vault still has.
    if (purge) {
      await purgeVault(abs);
      await mkdir(abs, { recursive: true });
    }

    if (abs !== resolve(fixtureVault)) {
      await cp(fixtureVault, abs, { recursive: true, force: true });
    }
  }

  console.error(`synced ${fixtureVault} -> ${abs}`);
}

async function rebuildFixtureVault(
  target: string,
  scopeCase = DEFAULT_SCOPE_CASE,
): Promise<void> {
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
    scopeCase,
    pluginBundleDir: hasBundle ? pluginBundleDir : undefined,
  });
}

/** Rebuild, synchronize, and ensure the Development Vault window is open. */
async function open(
  vaultPath: string,
  { purge = false, scopeCase = DEFAULT_SCOPE_CASE }: SeedOptions = {},
): Promise<void> {
  const abs = resolve(vaultPath);
  const host = await resolveHost();
  const registered = findVaultId(await vaultList(host), abs);

  if (!registered) {
    await create(abs, { purge, scopeCase });
    return;
  }

  await sync(abs, { purge, scopeCase });
  if ((await vaultList(host))[registered]?.open !== true) {
    const opened = await obEval(
      `require('electron').ipcRenderer.sendSync('vault-open',${JSON.stringify(abs)},false)`,
      host,
    );
    if (opened !== "true") {
      throw new Error(`vault-open refused: ${opened || "unknown error"}`);
    }
    const windowOpen = await waitFor(
      async () => (await vaultList(host))[registered]?.open === true,
    );
    if (!windowOpen) {
      throw new Error(
        `vault ${registered} registered but its window never opened`,
      );
    }
  }

  const reloaded = await cli([
    `vault=${registered}`,
    "plugin:reload",
    `id=${pluginId}`,
  ]);
  if (!reloaded.toLowerCase().startsWith("reloaded:")) {
    throw new Error(`could not reload ZotLit in ${registered}: ${reloaded}`);
  }

  const loaded = await waitFor(async () => {
    const answer = await obEval(
      `String(${JSON.stringify(pluginId)} in app.plugins.plugins)`,
      registered,
    ).catch(() => "");
    return answer === "true";
  });
  if (!loaded) {
    throw new Error(`ZotLit did not load in ${registered}`);
  }
  await linkFixture(registered);

  console.log(registered);
  console.error(`opened vault ${registered} at ${abs}`);
}

interface FixtureLinkReport {
  databasePath?: unknown;
  dbState?: unknown;
  profileDir?: unknown;
}

async function linkFixture(vaultId: string): Promise<void> {
  const profileDir = fixtureLayout.profileDir;
  const databasePath = fixtureLayout.databasePath;
  const dataDir = fixtureLayout.dataDir;
  const configured = await waitFor(async () => {
    const answer = await obEval(
      `{const pref=app.plugins.plugins.${pluginId}.services.zoteroPref;pref.setProfileDir(${JSON.stringify(profileDir)});pref.setDataDir(${JSON.stringify(dataDir)});"configured"}`,
      vaultId,
    ).catch(() => "");
    return answer === "configured";
  });
  if (!configured) {
    throw new Error(`could not configure Fixture paths in ${vaultId}`);
  }

  const resolved = await waitFor(async () => {
    const report = await readFixtureLink(vaultId).catch(() => undefined);
    return (
      report?.profileDir === profileDir && report.databasePath === databasePath
    );
  });
  if (!resolved) {
    throw new Error(
      `ZotLit in ${vaultId} did not resolve the Fixture profile and database`,
    );
  }

  const refreshed = await waitFor(async () => {
    const raw = await obEval(
      `(async()=>{const services=app.plugins.plugins.${pluginId}.services;await services.db.refresh();return JSON.stringify({profileDir:services.zoteroPref.resolvedProfileDir,databasePath:services.zoteroPref.databasePath,dbState:services.db.state})})()`,
      vaultId,
    ).catch(() => "");
    if (!raw) return false;
    const report = JSON.parse(raw) as FixtureLinkReport;
    return (
      report.profileDir === profileDir &&
      report.databasePath === databasePath &&
      report.dbState === "ready"
    );
  });
  if (!refreshed) {
    throw new Error(`ZotLit in ${vaultId} did not open the Fixture database`);
  }
}

async function readFixtureLink(vaultId: string): Promise<FixtureLinkReport> {
  const raw = await obEval(
    `{const services=app.plugins.plugins.${pluginId}.services;JSON.stringify({profileDir:services.zoteroPref.resolvedProfileDir,databasePath:services.zoteroPref.databasePath,dbState:services.db.state})}`,
    vaultId,
  );
  return JSON.parse(raw) as FixtureLinkReport;
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
  let tracked = "";
  try {
    ({ stdout: tracked } = await execFileAsync("git", ["ls-files", "--", "."], {
      cwd: abs,
      windowsHide: true,
    }));
  } catch (error) {
    const result = error as { code?: unknown; stderr?: string };
    if (!/not a git repository/i.test(result.stderr ?? "")) {
      throw new Error(
        `could not check tracked files in ${abs}: ${result.stderr?.trim() || `git exited ${String(result.code)}`}`,
      );
    }
  }
  if (tracked.trim()) {
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
    "delete the Development Vault folder before restoring the complete generated seed",
  type: "boolean",
  default: false,
} as const;

const removePurgeOption = {
  describe: "delete the Development Vault folder after unregistering it",
  type: "boolean",
  default: false,
} as const;

const scopeCaseOption = {
  describe: "Scope Case to build",
  type: "string",
  choices: SCOPE_CASES.map(({ id }) => id),
  default: DEFAULT_SCOPE_CASE,
} as const;

const reference = `contractVersion: ${CONTRACT_VERSION}

The open, create, and sync commands rebuild the Fixture Vault first. Run the
Obsidian dev build before them so its bundle is available to copy into the
generated seed. Open and sync keep extra Development Vault files unless
--purge is set. Remove keeps the folder unless --purge is set.

Environment:
  ${HOST_VAULT_ENV}  vault name or id whose window hosts eval calls`;

const vaultCli = yargs(hideBin(process.argv))
  .scriptName("obsidian-vault.ts")
  .command(
    "check",
    "verify that a live Obsidian vault can host CLI calls",
    () => {},
    async () => {
      console.log(await resolveHost());
    },
  )
  .command(
    "open [vault-path]",
    "rebuild, synchronize, and open this worktree's Development Vault",
    (y) =>
      y
        .positional("vault-path", vaultPathPosition)
        .option("purge", syncPurgeOption)
        .option("scope-case", scopeCaseOption),
    async (argv) => {
      await open(argv["vault-path"] ?? defaultVault, {
        purge: argv.purge,
        scopeCase: argv["scope-case"],
      });
    },
  )
  .command(
    "create [vault-path]",
    "seed and register this worktree's Development Vault",
    (y) => y.positional("vault-path", vaultPathPosition),
    async (argv) => {
      await create(argv["vault-path"] ?? defaultVault);
    },
  )
  .command(
    "sync [vault-path]",
    "rebuild and copy the Fixture Vault over an existing Development Vault",
    (y) =>
      y
        .positional("vault-path", vaultPathPosition)
        .option("purge", syncPurgeOption),
    async (argv) => {
      await sync(argv["vault-path"] ?? defaultVault, { purge: argv.purge });
    },
  )
  .command(
    "remove [vault-path]",
    "unregister this worktree's Development Vault",
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
    "status",
    "print whether a live Obsidian answers the registered CLI command",
    () => {},
    async () => {
      console.log((await isObsidianRunning()) ? "running" : "stopped");
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
