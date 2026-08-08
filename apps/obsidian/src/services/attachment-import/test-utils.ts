// Test-only doubles shared by the attachment-import suites.

import type { DeviceStorage } from "./approved-folders";

/**
 * Obsidian's vault-scoped localStorage. One store stands for one vault on one
 * device: hand the same store to a second service to model a restart, a fresh
 * one to model another vault.
 */
export function makeDeviceStorage(): DeviceStorage {
  const store = new Map<string, unknown>();
  return {
    loadLocalStorage: (key) => store.get(key) ?? null,
    saveLocalStorage: (key, data) => {
      if (data === null) store.delete(key);
      else store.set(key, data);
    },
  };
}
