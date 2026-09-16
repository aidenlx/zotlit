import { expect, it } from "vitest";

import { SecretWriteAuthorizationStore } from "./write-authorization";
import type { SecretStore } from "./write-authorization";

/** The Zotero database that granted the key in these records. */
const SERVER_ID = "A8sf5Zsz8ySw";
/** Another database, to check what a server change leaves alone. */
const OTHER_SERVER_ID = "Zzzz11119999";
/** A 32-character key, as `Zotero.Utilities.randomString(32)` writes one. */
const KEY = "5ixBzUhQfLu8i8RIhU6OEzENW4pAITLf";

/**
 * The one id ADR 0037 names. Written out here rather than imported, so a rename
 * of the constant shows up as a failing test rather than as a key the user's
 * Keychain has silently lost.
 */
const RECORD_ID = "zotlit-zotero-write-authorization";

it("keeps one record under the id ADR 0037 names, bound to the granting server", async () => {
  const { store, secrets } = setup();

  await store.remember(SERVER_ID, KEY);

  expect([...secrets.keys()]).toEqual([RECORD_ID]);
  expect(JSON.parse(secrets.get(RECORD_ID)!)).toEqual({
    version: 1,
    serverID: SERVER_ID,
    key: KEY,
  });
  expect(await store.read(SERVER_ID)).toBe(KEY);
  expect(await store.has()).toBe(true);
});

it("reads the record fresh, so one deleted in the Keychain is gone at once", async () => {
  const { store, secrets } = setup({
    version: 1,
    serverID: SERVER_ID,
    key: KEY,
  });

  expect(await store.read(SERVER_ID)).toBe(KEY);
  secrets.delete(RECORD_ID);

  expect(await store.read(SERVER_ID)).toBeNull();
  expect(await store.has()).toBe(false);
});

it("answers no key for another Zotero database, and leaves the record alone", async () => {
  const { store, secrets } = setup({
    version: 1,
    serverID: SERVER_ID,
    key: KEY,
  });

  expect(await store.read(OTHER_SERVER_ID)).toBeNull();

  // Switching back to the first database must keep editing without a dialog,
  // so the record the other database did not match is still there.
  expect(JSON.parse(secrets.get(RECORD_ID)!).key).toBe(KEY);
  expect(await store.read(SERVER_ID)).toBe(KEY);
});

it("invalidates by overwriting the record without a key", async () => {
  const { store, secrets } = setup({
    version: 1,
    serverID: SERVER_ID,
    key: KEY,
  });

  await store.forget();

  // The typed API has no delete, so the record stays and reads as no record.
  expect(JSON.parse(secrets.get(RECORD_ID)!)).toEqual({
    version: 1,
    serverID: SERVER_ID,
  });
  expect(await store.read(SERVER_ID)).toBeNull();
  expect(await store.has()).toBe(false);
});

it("writes nothing when there is nothing to invalidate", async () => {
  const { store, secrets } = setup();

  await store.forget();

  expect([...secrets.keys()]).toEqual([]);
});

it("reads a record of an unknown version, or an unreadable one, as no record", async () => {
  const laterVersion = setup({ version: 2, serverID: SERVER_ID, key: KEY });
  const unreadable = setup();
  unreadable.secrets.set(RECORD_ID, "not json");

  expect(await laterVersion.store.read(SERVER_ID)).toBeNull();
  expect(await laterVersion.store.has()).toBe(false);
  expect(await unreadable.store.read(SERVER_ID)).toBeNull();
});

it("reads a keystore that throws as no record", async () => {
  const store = new SecretWriteAuthorizationStore({
    secrets: {
      getSecret: () => {
        throw new Error("The keychain is locked");
      },
      setSecret: () => undefined,
    },
  });

  expect(await store.read(SERVER_ID)).toBeNull();
});

/** SecretStorage as a map, which is what the two calls this store makes need. */
function setup(record?: unknown) {
  const secrets = new Map<string, string>();
  if (record !== undefined) secrets.set(RECORD_ID, JSON.stringify(record));
  const port: SecretStore = {
    getSecret: (id) => secrets.get(id) ?? null,
    setSecret: (id, secret) => {
      secrets.set(id, secret);
    },
  };
  return {
    store: new SecretWriteAuthorizationStore({ secrets: port }),
    secrets,
  };
}
