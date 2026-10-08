// Test support: a fake device for Managed Binary services, with an in-memory store and consent record.
import type { BinaryStore, ManagedBinaryPorts } from "./service";

/**
 * The device: one origin-wide store root with a directory per Managed Binary,
 * and the consent storage of its first vault.
 */
export function memoryDevice() {
  const directories = new Map<string, Map<string, Uint8Array<ArrayBuffer>>>();
  const files = (directory: string) => {
    let entries = directories.get(directory);
    if (!entries) directories.set(directory, (entries = new Map()));
    return entries;
  };
  const openStore = (directory: string): BinaryStore => ({
    list: () => Promise.resolve([...files(directory).keys()]),
    read: (name) => {
      const stored = files(directory).get(name);
      return Promise.resolve(stored && new Blob([stored]));
    },
    write: (name, written) => {
      files(directory).set(name, written);
      return Promise.resolve();
    },
    rename: (from, to) => {
      const entries = files(directory);
      const moved = entries.get(from);
      if (!moved) throw new Error(`No entry named ${from}`);
      entries.delete(from);
      entries.set(to, moved);
      return Promise.resolve();
    },
    remove: (name) => {
      files(directory).delete(name);
      return Promise.resolve();
    },
    clear: () => {
      directories.delete(directory);
      return Promise.resolve();
    },
  });
  /** The names stored in one directory, sorted. */
  const names = (directory: string) =>
    [...(directories.get(directory)?.keys() ?? [])].sort();
  return { openStore, consent: vaultConsent(), files, names };
}

/** One vault's local storage, where a dismissed install offer is remembered. */
export function vaultConsent(): ManagedBinaryPorts["consent"] {
  const values = new Map<string, unknown>();
  return {
    loadLocalStorage: (key) => values.get(key) ?? null,
    saveLocalStorage: (key, value) => {
      if (value === null) values.delete(key);
      else values.set(key, value);
    },
  };
}
