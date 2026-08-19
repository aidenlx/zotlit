// Resolves a real Zotero app bundle — an override or the managed install — and
// launches it on the Fixture's profile beside a personal Zotero.

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  access,
  constants,
  mkdir,
  mkdtemp,
  rename,
  rm,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { $ } from "zx";

/**
 * The official Zotero build the Paired Zotero runs. A deliberate constant: it
 * fixes both the managed install and the schema era the Fixture targets.
 */
export const PINNED_ZOTERO_VERSION = "10.0";

/** Environment variable that points the launcher at any app bundle. */
export const ZOTERO_APP_ENV = "ZOTERO_APP";

const APP_BUNDLE_NAME = "Zotero.app";
const BINARY_SUBPATH = join("Contents", "MacOS", "zotero");

const DOWNLOAD_URL = `https://download.zotero.org/client/release/${PINNED_ZOTERO_VERSION}/Zotero-${PINNED_ZOTERO_VERSION}.dmg`;

/** Per-user cache keyed by version, so one download serves every worktree. */
function getManagedZoteroDir(): string {
  return join(
    homedir(),
    "Library",
    "Caches",
    "zotlit",
    "zotero",
    PINNED_ZOTERO_VERSION,
  );
}

function getZoteroBinary(appBundle: string): string {
  return join(appBundle, BINARY_SUBPATH);
}

function isAppBundle(appBundle: string): Promise<boolean> {
  return access(getZoteroBinary(appBundle), constants.X_OK).then(
    () => true,
    () => false,
  );
}

/**
 * The app bundle the Paired Zotero runs: `ZOTERO_APP` when set, else the
 * managed install, downloaded on first use and reused from cache afterwards.
 *
 * @throws when the override names no app bundle, or the download fails.
 */
export async function resolveZoteroApp(): Promise<string> {
  requireMacOS();

  const override = process.env[ZOTERO_APP_ENV];
  if (override) {
    if (await isAppBundle(override)) return override;
    throw new Error(
      `${ZOTERO_APP_ENV} names ${override}, which holds no ${BINARY_SUBPATH}.` +
        ` Point it at a Zotero app bundle, or unset it to use the managed Zotero ${PINNED_ZOTERO_VERSION}.`,
    );
  }

  const cacheDir = getManagedZoteroDir();
  const appBundle = join(cacheDir, APP_BUNDLE_NAME);
  if (await isAppBundle(appBundle)) return appBundle;

  await installManagedZotero(cacheDir);
  return appBundle;
}

function requireMacOS(): void {
  if (process.platform === "darwin") return;
  throw new Error(
    `the Paired Zotero runs on macOS; this host reports ${process.platform}.`,
  );
}

/**
 * Download the pinned DMG and lay its app bundle into `cacheDir`. Stages the
 * whole install beside the destination and renames it into place, so an
 * interrupted run leaves no half-copied bundle for the next run to trust.
 */
async function installManagedZotero(cacheDir: string): Promise<void> {
  const staging = `${cacheDir}.incomplete`;
  const dmgPath = join(staging, `Zotero-${PINNED_ZOTERO_VERSION}.dmg`);

  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    console.log(
      `Downloading Zotero ${PINNED_ZOTERO_VERSION} from ${DOWNLOAD_URL}`,
    );
    await download(DOWNLOAD_URL, dmgPath);
    await extractAppBundle(dmgPath, staging);
    await rm(dmgPath);
    await rm(cacheDir, { recursive: true, force: true });
    await mkdir(dirname(cacheDir), { recursive: true });
    await rename(staging, cacheDir);
    console.log(`Installed the managed Zotero at ${cacheDir}`);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw new Error(
      `could not install the managed Zotero ${PINNED_ZOTERO_VERSION} from ${DOWNLOAD_URL}:` +
        ` ${error instanceof Error ? error.message : String(error)}.` +
        ` Set ${ZOTERO_APP_ENV} to an existing Zotero app bundle to skip the download.`,
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
async function extractAppBundle(
  dmgPath: string,
  destination: string,
): Promise<void> {
  const mountPoint = await mkdtemp(join(tmpdir(), "zotlit-zotero-"));
  try {
    await $`hdiutil attach ${dmgPath} -nobrowse -readonly -quiet -mountpoint ${mountPoint}`;
    await $`ditto ${join(mountPoint, APP_BUNDLE_NAME)} ${join(destination, APP_BUNDLE_NAME)}`;
  } finally {
    await $`hdiutil detach ${mountPoint} -quiet`.nothrow();
    await rm(mountPoint, { recursive: true, force: true });
  }
}

/** The Fixture directories the Paired Zotero opens. */
export interface PairedZoteroTarget {
  profileDir: string;
  dataDir: string;
}

export interface PairedZotero {
  appBundle: string;
  pid: number;
}

/**
 * Start the Paired Zotero on the Fixture's profile and data directory,
 * detached so the command returns and the instance outlives it.
 *
 * @throws when the Fixture is not built, or no app bundle resolves.
 */
export async function launchPairedZotero(
  target: PairedZoteroTarget,
): Promise<PairedZotero> {
  for (const dir of [target.profileDir, target.dataDir]) {
    await access(dir).catch(() => {
      throw new Error(
        `no Fixture at ${dir}. Build it with 'pnpm fixture' first.`,
      );
    });
  }

  const appBundle = await resolveZoteroApp();
  const child = spawn(
    getZoteroBinary(appBundle),
    ["-profile", target.profileDir, "-datadir", target.dataDir],
    {
      detached: true,
      stdio: "ignore",
      // Gecko otherwise hands the command line to an already-running Zotero,
      // which would raise a window on the personal library instead.
      env: { ...process.env, MOZ_NO_REMOTE: "1" },
    },
  );
  child.unref();

  const { pid } = child;
  if (pid === undefined) throw new Error(`could not start ${appBundle}.`);
  return { appBundle, pid };
}
