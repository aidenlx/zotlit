// The Remembered Write Authorization: one SecretStorage record, read fresh at
// every write and invalidated by overwriting it without a key.

import type { SecretStorage } from "obsidian";
import * as v from "valibot";

import { getLogger } from "@/lib/log";
import { parseJson } from "@/lib/zotero-http";

const logger = getLogger(["zotero-local-api", "write-authorization"]);

/**
 * Where the record lives in Obsidian's Keychain: per vault, per device,
 * encrypted through the OS keystore where one exists, and listed for the user
 * with a delete button beside it. One id for the whole plugin, so the user sees
 * one entry rather than one per Zotero database.
 *
 * SecretStorage accepts a lower-case alphanumeric id with dashes, and throws on
 * anything else.
 *
 * @see apps/obsidian/docs/adr/0037-a-remembered-authorization-is-a-per-device-secret-bound-to-the-zotero-server-id.md
 */
const RECORD_ID = "zotlit-zotero-write-authorization";

/**
 * The record shape this reader understands. A record written by a later ZotLit
 * reads as no record rather than as a key this version cannot interpret, so a
 * downgrade asks for a fresh authorization instead of sending something wrong.
 */
const RECORD_VERSION = 1;

const recordSchema = v.object({
  version: v.pipe(v.number(), v.safeInteger()),
  /** The Zotero database that granted the key; a Zotero Server ID. */
  serverID: v.string(),
  /** Absent in an invalidated record, which is how invalidation is written. */
  key: v.optional(v.string()),
});

type StoredRecord = v.InferOutput<typeof recordSchema>;

/**
 * The Remembered Write Authorization, read fresh on every write rather than
 * held, so a grant the user deleted in Obsidian's Keychain or cleared in Zotero
 * is simply gone by the next attempt.
 *
 * @see apps/obsidian/docs/adr/0037-a-remembered-authorization-is-a-per-device-secret-bound-to-the-zotero-server-id.md
 */
export interface WriteAuthorizationStore {
  /**
   * @param serverID the Zotero database the key must be bound to.
   * @returns the remembered key, or null where none is remembered for it.
   */
  read(serverID: string): Promise<string | null>;
  /**
   * Whether a key is remembered at all, whichever database granted it — what
   * the settings row offers "Forget authorization" for, with Zotero closed and
   * no Zotero Server ID in hand.
   */
  has(): Promise<boolean>;
  /**
   * Keep `key` as the authorization for `serverID`, replacing whatever the one
   * record held.
   *
   * @throws where the keystore refused the write; the caller keeps the key for
   *   the attempt in hand rather than losing the grant.
   */
  remember(serverID: string, key: string): Promise<void>;
  /**
   * Invalidate what is remembered. The typed API has no delete, so this
   * overwrites the record with a keyless one, which the reader answers "no
   * record" for.
   */
  forget(): Promise<void>;
}

/** The Obsidian surface the store reaches, which is two synchronous calls. */
export type SecretStore = Pick<SecretStorage, "getSecret" | "setSecret">;

export interface SecretWriteAuthorizationStoreDeps {
  secrets: SecretStore;
}

/**
 * The Remembered Write Authorization in Obsidian's SecretStorage.
 *
 * Nothing is cached: every read goes to the keystore, so the record the user
 * can see and delete in Obsidian's Keychain settings is the one that answers.
 * A record naming another Zotero database is left alone rather than cleared —
 * switching back to the first database keeps editing without a dialog.
 */
export class SecretWriteAuthorizationStore implements WriteAuthorizationStore {
  readonly #secrets: SecretStore;

  constructor({ secrets }: SecretWriteAuthorizationStoreDeps) {
    this.#secrets = secrets;
  }

  read(serverID: string): Promise<string | null> {
    const record = this.#record();
    if (record === null || record.key === undefined) {
      return Promise.resolve(null);
    }
    if (record.serverID !== serverID) {
      logger.debug(
        "The remembered authorization names another Zotero database",
        {
          remembered: record.serverID,
          asked: serverID,
        },
      );
      return Promise.resolve(null);
    }
    return Promise.resolve(record.key);
  }

  has(): Promise<boolean> {
    return Promise.resolve(this.#record()?.key !== undefined);
  }

  remember(serverID: string, key: string): Promise<void> {
    this.#secrets.setSecret(
      RECORD_ID,
      JSON.stringify({ version: RECORD_VERSION, serverID, key }),
    );
    logger.debug("Remembered a Zotero write authorization", { serverID });
    return Promise.resolve();
  }

  forget(): Promise<void> {
    const record = this.#record();
    // Nothing stored is already nothing to invalidate; writing a keyless record
    // then would only add a Keychain entry the user never granted.
    if (record === null) return Promise.resolve();
    this.#secrets.setSecret(
      RECORD_ID,
      JSON.stringify({ version: RECORD_VERSION, serverID: record.serverID }),
    );
    logger.debug("Invalidated the remembered Zotero write authorization");
    return Promise.resolve();
  }

  /** What the keystore holds, or null for anything this version cannot read. */
  #record(): StoredRecord | null {
    let stored: string | null;
    try {
      stored = this.#secrets.getSecret(RECORD_ID);
    } catch (error) {
      logger.warn("Obsidian's keychain refused to answer", { error });
      return null;
    }
    if (stored === null) return null;

    const parsed = v.safeParse(recordSchema, parseJson(stored));
    if (!parsed.success) {
      logger.warn("The stored write authorization cannot be read");
      return null;
    }
    if (parsed.output.version !== RECORD_VERSION) {
      logger.debug("The stored write authorization is another record version", {
        version: parsed.output.version,
      });
      return null;
    }
    return parsed.output;
  }
}
