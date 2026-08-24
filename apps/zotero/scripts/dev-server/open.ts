#!/usr/bin/env node

// Opens one detached Paired Zotero and verifies the companion is installed.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { getInstalledAddon, installTemporaryAddon } from "./remote-firefox.ts";
import {
  resetCompanionReady,
  spawnZotero,
  waitForCompanionReady,
} from "./runner.ts";

const packageRoot = join(import.meta.dirname, "../..");
const binaryPath = requiredEnv("ZOTERO_PLUGIN_ZOTERO_BIN_PATH");
const profilePath = requiredEnv("ZOTERO_PLUGIN_PROFILE_PATH");
const dataDir = requiredEnv("ZOTERO_PLUGIN_DATA_DIR");
const addonPath = join(packageRoot, "dist-dev", "addon");
const addonId = await readAddonId();
const controller = new AbortController();

try {
  const session = await spawnZotero({
    root: packageRoot,
    binaryPath,
    profilePath,
    dataDir,
    devtools: false,
    detached: true,
    stdio: "ignore",
    signal: controller.signal,
  });
  using cleanup = new DisposableStack();
  cleanup.defer(() => session.client.disconnect());
  await resetCompanionReady(session);
  await installTemporaryAddon(session.client, addonPath);
  await getInstalledAddon(session.client, addonId);
  await waitForCompanionReady(session, controller.signal);
  session.child.unref();

  const { pid } = session.child;
  if (pid === undefined) throw new Error("Paired Zotero has no process id");
  console.log(JSON.stringify({ pid }));
} catch (error) {
  controller.abort(error);
  throw error;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  throw new Error(`${name} is required`);
}

async function readAddonId(): Promise<string> {
  const raw = await readFile(join(packageRoot, "package.json"), "utf-8");
  const pkg = JSON.parse(raw) as { zotero?: { id?: unknown } };
  if (typeof pkg.zotero?.id !== "string") {
    throw new Error("package.json is missing zotero.id");
  }
  return pkg.zotero.id;
}
