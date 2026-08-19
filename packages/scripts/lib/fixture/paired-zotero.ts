// Resolves a real Zotero application — an override or the managed install — and
// launches it on the Fixture's profile beside a personal Zotero. It also owns
// the preferences that profile carries, because they describe what a real
// Zotero does on a profile it has never opened.

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  access,
  constants,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { arch as hostArch, homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { promisify } from "node:util";
import { $ } from "zx";

const execFileAsync = promisify(execFile);

/**
 * The official Zotero build the Paired Zotero runs. A deliberate constant: it
 * fixes both the managed install and the schema era the Fixture targets.
 */
export const PINNED_ZOTERO_VERSION = "10.0";

export const ZOTERO_APP_ENV = "ZOTERO_APP";

const DOWNLOAD_ROOT = `https://download.zotero.org/client/release/${PINNED_ZOTERO_VERSION}`;

export interface ManagedZoteroLayout {
  applicationDir: string;
  archiveName: string;
  cacheDir: string;
  downloadUrl: string;
}

export function getManagedZoteroLayout({
  arch = hostArch(),
  env = process.env,
  home = homedir(),
  platform = process.platform,
}: {
  arch?: NodeJS.Architecture;
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
} = {}): ManagedZoteroLayout {
  if (platform === "darwin") {
    const cacheDir = join(
      home,
      "Library",
      "Caches",
      "zotlit",
      "zotero",
      PINNED_ZOTERO_VERSION,
    );
    const archiveName = `Zotero-${PINNED_ZOTERO_VERSION}.dmg`;
    return {
      applicationDir: join(cacheDir, "Zotero.app"),
      archiveName,
      cacheDir,
      downloadUrl: `${DOWNLOAD_ROOT}/${archiveName}`,
    };
  }
  if (platform === "win32") {
    const target =
      arch === "arm64"
        ? "win-arm64"
        : arch === "x64"
          ? "win-x64"
          : arch === "ia32"
            ? "win32"
            : undefined;
    if (!target) {
      throw new Error(`unsupported Windows architecture for Zotero: ${arch}.`);
    }
    const cacheDir = join(
      env.LOCALAPPDATA ?? join(home, "AppData", "Local"),
      "zotlit",
      "zotero",
      PINNED_ZOTERO_VERSION,
      target,
    );
    const archiveName = `Zotero-${PINNED_ZOTERO_VERSION}_${target}.zip`;
    return {
      applicationDir: join(cacheDir, `Zotero_${target}`),
      archiveName,
      cacheDir,
      downloadUrl: `${DOWNLOAD_ROOT}/${archiveName}`,
    };
  }
  throw new Error(
    `the Paired Zotero runs on macOS and Windows; this host reports ${platform}.`,
  );
}

export function getZoteroBinary(applicationDir: string): string {
  return process.platform === "win32"
    ? join(applicationDir, "zotero.exe")
    : join(applicationDir, "Contents", "MacOS", "zotero");
}

function isApplicationDir(applicationDir: string): Promise<boolean> {
  return access(getZoteroBinary(applicationDir), constants.X_OK).then(
    () => true,
    () => false,
  );
}

/**
 * The application folder the Paired Zotero runs: `ZOTERO_APP` when set, else the
 * managed install, downloaded on first use and reused from cache afterwards.
 *
 * @throws when the override names no application folder, or the download fails.
 */
export async function resolveZoteroApp(): Promise<string> {
  const layout = getManagedZoteroLayout();

  const override = process.env[ZOTERO_APP_ENV];
  if (override) {
    if (await isApplicationDir(override)) return override;
    throw new Error(
      `${ZOTERO_APP_ENV} names ${override}, which holds no ${getZoteroBinary(override)}.` +
        ` Point it at a Zotero application folder, or unset it to use the managed Zotero ${PINNED_ZOTERO_VERSION}.`,
    );
  }

  if (await isApplicationDir(layout.applicationDir)) {
    return layout.applicationDir;
  }

  await installManagedZotero(layout);
  if (!(await isApplicationDir(layout.applicationDir))) {
    throw new Error(
      `the managed Zotero archive did not contain ${getZoteroBinary(layout.applicationDir)}.`,
    );
  }
  return layout.applicationDir;
}

/**
 * Download the pinned archive and lay its application into `cacheDir`. Stages the
 * whole install beside the destination and renames it into place, so an
 * interrupted run leaves no half-copied bundle for the next run to trust.
 */
async function installManagedZotero(
  layout: ManagedZoteroLayout,
): Promise<void> {
  const staging = `${layout.cacheDir}.incomplete`;
  const archivePath = join(staging, layout.archiveName);

  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    console.log(
      `Downloading Zotero ${PINNED_ZOTERO_VERSION} from ${layout.downloadUrl}`,
    );
    await download(layout.downloadUrl, archivePath);
    await extractApplication(archivePath, staging);
    await rm(archivePath);
    await rm(layout.cacheDir, { recursive: true, force: true });
    await mkdir(dirname(layout.cacheDir), { recursive: true });
    await rename(staging, layout.cacheDir);
    console.log(`Installed the managed Zotero at ${layout.cacheDir}`);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw new Error(
      `could not install the managed Zotero ${PINNED_ZOTERO_VERSION} from ${layout.downloadUrl}:` +
        ` ${error instanceof Error ? error.message : String(error)}.` +
        ` Set ${ZOTERO_APP_ENV} to an existing Zotero application folder to skip the download.`,
      { cause: error },
    );
  }
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const total = Number(response.headers.get("content-length") ?? 0);
  const body = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
  await pipeline(reportProgress(body, total), createWriteStream(destination));
}

/** Coarse progress, because the download is around 190 MB. */
async function* reportProgress(
  source: AsyncIterable<Uint8Array>,
  total: number,
): AsyncGenerator<Uint8Array> {
  let received = 0;
  let reported = 0;
  for await (const chunk of source) {
    received += chunk.length;
    const percent = total === 0 ? 0 : Math.floor((received / total) * 100);
    if (percent >= reported + 10) {
      reported = percent;
      console.log(`  ${percent}%`);
    }
    yield chunk;
  }
}

/**
 * `hdiutil` and `ditto` rather than a JavaScript unpacker: the app bundle
 * carries symlinks, extended attributes, and a code signature that only the
 * macOS tools reproduce faithfully.
 */
async function extractApplication(
  archivePath: string,
  destination: string,
): Promise<void> {
  if (process.platform === "win32") {
    await execFileAsync("tar.exe", ["-xf", archivePath, "-C", destination]);
    return;
  }
  const mountPoint = await mkdtemp(join(tmpdir(), "zotlit-zotero-"));
  try {
    await $`hdiutil attach ${archivePath} -nobrowse -readonly -quiet -mountpoint ${mountPoint}`;
    await $`ditto ${join(mountPoint, "Zotero.app")} ${join(destination, "Zotero.app")}`;
  } finally {
    await $`hdiutil detach ${mountPoint} -quiet`.nothrow();
    await rm(mountPoint, { recursive: true, force: true });
  }
}

/**
 * What Zotero does on a profile it has never opened: it loads the start page in
 * the developer's browser, shows guidance popups and an upgrade banner, asks
 * to enable sideloaded add-ons and set up sync, and starts backing the database
 * up. Each preference here turns one of those off, and `app.update.auto` holds
 * {@link PINNED_ZOTERO_VERSION} in place. Zotero rides Gecko 140, where
 * `app.update.auto` is the live knob: it ships the pref as `true` and patches
 * `UpdateUtils` to keep reading it from `prefs.js`.
 *
 * @see {@link https://github.com/zotero/zotero/blob/22f08d1ced/chrome/content/zotero/zoteroPane.js#L636}
 * for the branch that opens the start page.
 * @see {@link https://github.com/zotero/zotero/blob/22f08d1ced/test/runtests.sh#L143-L166}
 * for the same Zotero preference names in Zotero's own test harness.
 * @see {@link https://github.com/zotero/zotero/blob/22f08d1ced/app/scripts/fetch_xulrunner#L155}
 * for the patch that keeps `app.update.auto` live.
 */
export const QUIET_FIRST_RUN_PREFS = [
  'user_pref("extensions.autoDisableScopes", 0);',
  'user_pref("extensions.zotero.firstRun2", false);',
  'user_pref("extensions.zotero.firstRunGuidance", false);',
  'user_pref("extensions.zotero.showPostUpgradeBanner", false);',
  'user_pref("extensions.zotero.sync.autoSync", false);',
  'user_pref("extensions.zotero.sync.reminder.setUp.enabled", false);',
  'user_pref("extensions.zotero.sync.reminder.autoSync.enabled", false);',
  'user_pref("extensions.zotero.backup.numBackups", 0);',
  'user_pref("extensions.zotero.automaticScraperUpdates", false);',
  'user_pref("app.update.auto", false);',
] as const;

/** The profile and data directory a Zotero process opens. */
export interface ZoteroTarget {
  profileDir: string;
  dataDir: string;
}

interface CompanionManifest {
  applications?: { zotero?: { id?: unknown } };
}

async function installCompanionProxy(
  profileDir: string,
  companionDir: string,
): Promise<void> {
  const manifestPath = join(companionDir, "manifest.json");
  const rawManifest = await readFile(manifestPath, "utf-8").catch((error) => {
    throw new Error(
      `no companion build at ${companionDir}. Build it with 'pnpm fixture' before launching the Paired Zotero.`,
      { cause: error },
    );
  });

  let manifest: CompanionManifest | undefined;
  try {
    const parsed: unknown = JSON.parse(rawManifest);
    if (typeof parsed === "object" && parsed !== null) {
      manifest = parsed as CompanionManifest;
    }
  } catch (error) {
    throw new Error(`the companion manifest at ${manifestPath} is not JSON.`, {
      cause: error,
    });
  }

  const addonId = manifest?.applications?.zotero?.id;
  if (typeof addonId !== "string" || addonId.length === 0) {
    throw new Error(
      `the companion manifest at ${manifestPath} has no applications.zotero.id.`,
    );
  }

  const extensionsDir = join(profileDir, "extensions");
  await mkdir(extensionsDir, { recursive: true });
  await writeFile(join(extensionsDir, addonId), resolve(companionDir));
}

/**
 * Start `applicationDir` on `target`, beside a personal Zotero.
 *
 * @param options.detached `true` lets the instance outlive the command;
 * `false` keeps the child attached, so a caller can wait for it and signal it.
 */
export function spawnZotero(
  applicationDir: string,
  target: ZoteroTarget,
  options: { detached: boolean },
): ChildProcess {
  return spawn(
    getZoteroBinary(applicationDir),
    ["-profile", target.profileDir, "-datadir", target.dataDir],
    {
      detached: options.detached,
      stdio: "ignore",
      // Gecko otherwise hands the command line to an already-running Zotero,
      // which would raise a window on the personal library instead.
      env: { ...process.env, MOZ_NO_REMOTE: "1" },
    },
  );
}

export interface PairedZotero {
  applicationDir: string;
  pid: number;
}

/**
 * Start the Paired Zotero on the Fixture's profile and data directory,
 * detached so the command returns and the instance outlives it.
 *
 * @throws when the Fixture or companion build is missing, the companion
 * manifest is invalid, or no application directory resolves.
 */
export async function launchPairedZotero(
  target: ZoteroTarget,
  companionDir: string,
): Promise<PairedZotero> {
  for (const dir of [target.profileDir, target.dataDir]) {
    await access(dir).catch(() => {
      throw new Error(
        `no Fixture at ${dir}. Build it with 'pnpm fixture' first.`,
      );
    });
  }

  await installCompanionProxy(target.profileDir, companionDir);
  const applicationDir = await resolveZoteroApp();
  const child = spawnZotero(applicationDir, target, { detached: true });
  child.unref();

  const { pid } = child;
  if (pid === undefined) throw new Error(`could not start ${applicationDir}.`);
  return { applicationDir, pid };
}
