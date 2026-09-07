// Connection codes and the one live Workbench Connection per vault.
//
// Both the code and the credential are random and live in memory only: nothing
// here is written to plugin settings, to device storage, or to a log.

import { randomHex } from "./random";

/** The Item a launch put in front of the page, as the grant names it. */
export interface SelectedItemIdentity {
  readonly key: string;
  readonly title: string | null;
}

/** What Obsidian chose at launch, which a code carries and a grant re-describes. */
export interface ConnectionBinding {
  /** The website the plugin opened; the exchange refuses any other. */
  readonly origin: string;
  readonly profileId: string;
  readonly item: SelectedItemIdentity | null;
}

/** A live Workbench Connection: a binding plus the credential that proves it. */
export interface BridgeConnection extends ConnectionBinding {
  readonly credential: string;
}

/** How long a Connection code stands before it is worthless. */
const CODE_LIFETIME = Temporal.Duration.from({ minutes: 2 });

/** 256 bits of randomness — for a code and for a credential alike. */
const TOKEN_BYTES = 32;

interface PendingCode {
  readonly binding: ConnectionBinding;
  readonly expiresAt: Temporal.Instant;
}

/**
 * The Workbench Connection lifecycle, apart from HTTP: mint a code, exchange it
 * once for a credential, authorize a request, and revoke.
 *
 * One connection stands at a time. A newer exchange replaces the older one, so
 * the tab the user just opened is the tab that can save.
 */
export class BridgeSessions {
  readonly #onChange;
  readonly #now;
  readonly #codes = new Map<string, PendingCode>();
  #connection: BridgeConnection | null = null;

  /**
   * @param onChange Fired whenever the live connection starts or ends.
   * @param now The clock a code's expiry is read against.
   */
  constructor(
    onChange: (connection: BridgeConnection | null) => void,
    now: () => Temporal.Instant = () => Temporal.Now.instant(),
  ) {
    this.#onChange = onChange;
    this.#now = now;
  }

  /** The connection standing now, or `null` while none does. */
  get connection(): BridgeConnection | null {
    return this.#connection;
  }

  /**
   * A single-use code for the launch URL, good for {@link CODE_LIFETIME}. Codes
   * already past their expiry are dropped on the way, so a launch the user
   * abandoned leaves nothing behind.
   */
  mintCode(binding: ConnectionBinding): string {
    this.#pruneCodes();
    const code = randomHex(TOKEN_BYTES);
    this.#codes.set(code, {
      binding,
      expiresAt: this.#now().add(CODE_LIFETIME),
    });
    return code;
  }

  /**
   * Spend `code` for a credential, revoking whatever connection stood before.
   * Returns `undefined` when the code is unknown, already spent, expired, or
   * was minted for another website.
   */
  exchange(code: string, origin: string): BridgeConnection | undefined {
    const pending = this.#codes.get(code);
    // Single use: the code is gone whether or not this exchange succeeds.
    this.#codes.delete(code);
    if (pending === undefined) return undefined;
    if (Temporal.Instant.compare(this.#now(), pending.expiresAt) > 0)
      return undefined;
    if (pending.binding.origin !== origin) return undefined;
    const connection: BridgeConnection = {
      ...pending.binding,
      credential: randomHex(TOKEN_BYTES),
    };
    this.#connection = connection;
    this.#onChange(connection);
    return connection;
  }

  /** The connection `credential` proves, or `undefined` once it is revoked. */
  authorize(credential: string | undefined): BridgeConnection | undefined {
    const connection = this.#connection;
    if (connection === null || credential !== connection.credential)
      return undefined;
    return connection;
  }

  /**
   * End the connection `credential` holds. A credential the plugin no longer
   * holds ends nothing, so a revoked tab cannot disconnect the live one.
   */
  disconnect(credential: string | undefined): void {
    if (this.authorize(credential) === undefined) return;
    this.#connection = null;
    this.#onChange(null);
  }

  /** End everything: the live connection and every code not yet spent. */
  revokeAll(): void {
    this.#codes.clear();
    if (this.#connection === null) return;
    this.#connection = null;
    this.#onChange(null);
  }

  #pruneCodes(): void {
    const now = this.#now();
    for (const [code, pending] of this.#codes) {
      if (Temporal.Instant.compare(now, pending.expiresAt) > 0)
        this.#codes.delete(code);
    }
  }
}
