// The installation id: a random id naming this vault on this device, which the
// grant carries so the page can key its drafts. It is device state, never a
// path and never a secret — see `policies/local-storage.md`.

import type { App } from "obsidian";

import { randomHex } from "./random";

/** localStorage surface these helpers need — the vault-scoped store. */
export type DeviceStorage = Pick<App, "loadLocalStorage" | "saveLocalStorage">;

const STORAGE_KEY = "zotlit-local-bridge-installation";

/** 128 bits of randomness — long enough that two devices sharing a synced vault
 *  never mint the same id. */
const INSTALLATION_ID_BYTES = 16;

/**
 * The id this device uses for this vault, minted and stored on first read. A
 * record that is not a non-empty string reads as no id at all and is replaced,
 * so a corrupted entry costs the page its drafts rather than the connection.
 */
export function loadInstallationId(store: DeviceStorage): string {
  const held: unknown = store.loadLocalStorage(STORAGE_KEY);
  if (typeof held === "string" && held.length > 0) return held;
  const minted = randomHex(INSTALLATION_ID_BYTES);
  store.saveLocalStorage(STORAGE_KEY, minted);
  return minted;
}
