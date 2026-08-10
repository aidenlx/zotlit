/**
 * `SettingsService` — reactive, validated, single-flight settings store for
 * the Obsidian plugin. Owns a flat key→primitive map, persisted sparsely
 * through `Plugin.loadData/saveData`, reactive via Svelte-store-compatible
 * `subscribe`.
 *
 * ## Conventions
 *
 * Schema and defaults live in `./schema.ts`, NOT as constructor options.
 * Runtime key admission is derived from `schema.entries`, not `defaults`.
 * Key alignment between `schema.entries` and `defaults` is enforced at compile
 * time via the const's `Readonly<Settings>` annotation plus an inner
 * `satisfies Settings`; value-constraint validity is exercised once by a
 * vitest case. The class is intentionally concrete (no `<TSchema>` generic).
 *
 * `null` is a legal settings value (used by keys whose concrete default is
 * host-dependent and resolved at the consume site). The service surfaces
 * `null` verbatim and `update({ key: null })` creates a persistent explicit
 * null override. `RESET_SETTING` is the canonical "remove the override
 * entirely" path; both produce `null` in the snapshot but differ on disk.
 *
 * ## Disk format
 *
 * - `data.json` is sparse: `{ __VERSION__: 7, ...overrides }`. Never persist
 *   `{ __VERSION__: 7, ...current }` — defaults-filled output defeats the
 *   format and bloats user files.
 * - Default-equal override values are still explicit overrides and must
 *   persist; do not auto-delete a key because its value equals the default.
 * - V7 load is non-writing: non-schema keys and bad per-key values are dropped
 *   in memory only and may disappear on the next explicit save.
 * - V1 data migrates to v2 (`migrateV1`): every `note.frontmatter-fields` item
 *   gains a required `language`, stamped `"javascript"` except for the three
 *   byte-exact v1 default exprs, which become their Liquid equivalents.
 * - Legacy through v6→v7 migration writes are best-effort
 *   cleanup; failures are logged but never tracked in `pendingWrite` and never
 *   block load.
 *
 * ## Validation
 *
 * Valibot is the single source of truth for settings validation. Do not layer
 * manual `isPrimitive` / `isFinite` / range guards around `safeParse` — fix
 * the schema instead.
 * - **Mutations:** one full-schema `safeParse` on the merged candidate. Do
 *   not per-key validate mutation values; the full parse covers everything.
 * - **Disk recovery:** per-key `safeParse(schema.entries[key], value)` first
 *   (drop failures), then one full-schema parse for cross-field constraints.
 * - Keep schemas validation-only unless normalization is intentional: mutation
 *   stores the candidate object, while disk recovery stores per-key
 *   `safeParse` output.
 *
 * ## Out of scope
 *
 * - Selectors / derived stores / deep-equality / no-op short-circuiting.
 * - Result-style returns from `update()` — invalid input throws.
 * - Async `migrateLegacy`/`migrateV1` hooks — Promise returns hit the
 *   non-plain branch.
 * - External `data.json` reload, file watchers, self-echo guards, Obsidian
 *   Sync conflict handling, retry-on-read.
 * - User-land save serialization chain — `FileSystemAdapter.write` already
 *   serializes; debouncing is here only because Obsidian doesn't debounce
 *   `saveData()`.
 */

import { debounce } from "obsidian";
import type { Plugin } from "obsidian";
import * as v from "valibot";

import { Service } from "@/services/service-base";

import {
  classifyDiskData,
  hydrationOriginOf,
  isPlainObject,
  VERSION_KEY,
} from "./classify";
import type { HydrationOrigin } from "./classify";
import { defaults, schema } from "./schema";
import type { Settings } from "./schema";

const SAVE_DEBOUNCE_MS = 200;
const CURRENT_VERSION = 7;

type SettingsKey = keyof typeof schema.entries;

/** `schema.entries` is the source of truth for the valid settings key set. */
const settingsKeys: ReadonlySet<string> = new Set(Object.keys(schema.entries));

function isSettingsKey(key: string): key is SettingsKey {
  return settingsKeys.has(key);
}

/** Re-export so consumers have one canonical import for the settings type. */
export type { Settings } from "./schema";

/**
 * Sentinel value for `update()` patches: assigning it to a key deletes that
 * key from the overrides map (i.e. reverts the runtime value to the default).
 * Exported as a unique symbol so callers cannot forge it.
 */
export const RESET_SETTING: unique symbol = Symbol("RESET_SETTING");

export type SettingsPatch = {
  [K in keyof Settings]?: Settings[K] | typeof RESET_SETTING;
};

export interface SettingsServiceOptions {
  plugin: Pick<Plugin, "loadData" | "saveData">;
  /**
   * Throwing or returning a non-plain value triggers the defaults fallback.
   */
  migrateLegacy: (raw: unknown) => unknown;
  /**
   * Throwing or returning a non-plain value triggers the defaults fallback.
   */
  migrateV1: (raw: unknown) => unknown;
  /**
   * Throwing or returning a non-plain value triggers the defaults fallback.
   */
  migrateV2: (raw: unknown) => unknown;
  /**
   * Throwing or returning a non-plain value triggers the defaults fallback.
   */
  migrateV3: (raw: unknown) => unknown;
  /**
   * Throwing or returning a non-plain value triggers the defaults fallback.
   */
  migrateV4: (raw: unknown) => unknown;
  /**
   * Throwing or returning a non-plain value triggers the defaults fallback.
   */
  migrateV5: (raw: unknown) => unknown;
  /**
   * Throwing or returning a non-plain value triggers the defaults fallback.
   */
  migrateV6: (raw: unknown) => unknown;
}

export class SettingsService extends Service<void> {
  readonly #plugin;
  readonly #migrateLegacy;
  readonly #migrateV1;
  readonly #migrateV2;
  readonly #migrateV3;
  readonly #migrateV4;
  readonly #migrateV5;
  readonly #migrateV6;
  readonly #scheduleSave;
  readonly #subscribers = new Set<(value: Readonly<Settings> | null) => void>();

  #overrides: Partial<Settings> = {};
  #loaded = false;
  #hydrationOrigin: HydrationOrigin | null = null;
  #pendingWrite: Promise<void> | undefined;

  ready: Promise<void>;

  constructor(options: SettingsServiceOptions) {
    super();
    this.#plugin = options.plugin;
    this.#migrateLegacy = options.migrateLegacy;
    this.#migrateV1 = options.migrateV1;
    this.#migrateV2 = options.migrateV2;
    this.#migrateV3 = options.migrateV3;
    this.#migrateV4 = options.migrateV4;
    this.#migrateV5 = options.migrateV5;
    this.#migrateV6 = options.migrateV6;
    this.#scheduleSave = debounce(
      () => this.#performSave(),
      SAVE_DEBOUNCE_MS,
      true,
    );
    this.ready = this.#load();
  }

  /**
   * Latest effective settings, or `null` before load finishes.
   * @returns a fresh shallow clone so callers cannot mutate internal state.
   */
  get current(): Readonly<Settings> | null {
    if (!this.#loaded) return null;
    return this.#snapshot();
  }

  /**
   * Awaitable snapshot.
   * @returns a fresh shallow clone of the *latest*
   * settings — taken at await time, not at access time — so callers reading
   * shortly after a sequence of `update()` calls observe the post-mutation
   * state.
   * @throws the load failure if startup failed.
   */
  get loaded(): Promise<Readonly<Settings>> {
    return this.ready.then(() => this.#snapshot());
  }

  /**
   * Bucketed origin of the completed load, for the release service's
   * same-launch onboarding branch. `null` before load finishes. This is the
   * in-memory signal: the Legacy Data marker self-destructs once migration
   * rewrites the file, so on-disk classification can't be re-derived later.
   */
  get hydrationOrigin(): HydrationOrigin | null {
    return this.#hydrationOrigin;
  }

  /**
   * Fires synchronously with the current value (`null` before load), then
   * again with a cloned snapshot on every successful load / mutation.
   * @returns an idempotent unsubscribe function.
   */
  subscribe(fn: (value: Readonly<Settings> | null) => void): () => void {
    this.#subscribers.add(fn);
    invokeSubscriber(fn, this.#loaded ? this.#snapshot() : null);
    return () => {
      this.#subscribers.delete(fn);
    };
  }

  /**
   * Apply a partial patch (or the result of an updater function) and schedule
   * a debounced save.
   * @returns a fresh clone of the post-mutation effective settings.
   * @throws before load finished, on unknown keys, on the reserved
   * `__VERSION__` key, or on full-schema validation failure (original
   * `safeParse` issues attached as `cause`).
   * @param patchOrUpdater a partial patch or an updater function.
   * `RESET_SETTING` as a patch value deletes that key's override; any other
   * value (including one equal to the default) becomes an explicit override.
   */
  update(
    patchOrUpdater:
      | SettingsPatch
      | ((current: Readonly<Settings>) => SettingsPatch),
  ): Readonly<Settings> {
    this.#requireLoaded("update");

    const patch =
      typeof patchOrUpdater === "function"
        ? patchOrUpdater(this.#snapshot())
        : patchOrUpdater;

    for (const key of Object.keys(patch)) assertWritableKey(key, "update");

    const nextOverrides = { ...this.#overrides };
    for (const key of Object.keys(patch)) {
      const value = (patch as Record<string, unknown>)[key];
      if (value === RESET_SETTING) {
        delete nextOverrides[key as keyof Settings];
      } else {
        (nextOverrides as Record<string, unknown>)[key] = value;
      }
    }

    return this.#commitMutation(nextOverrides, "update");
  }

  /**
   * Delete overrides for the given keys (or every override when `keys` is
   * omitted). Validates the post-reset effective object through the full
   * schema, schedules a debounced save, and returns a fresh clone.
   * @throws before load finished or on unknown keys.
   */
  reset(keys?: readonly (keyof Settings)[]): Readonly<Settings> {
    this.#requireLoaded("reset");

    if (keys !== undefined) {
      for (const key of keys) assertWritableKey(key, "reset");
    }

    const nextOverrides = { ...this.#overrides };
    if (keys === undefined) {
      for (const key of Object.keys(nextOverrides)) {
        delete nextOverrides[key as keyof Settings];
      }
    } else {
      for (const key of keys) delete nextOverrides[key];
    }

    return this.#commitMutation(nextOverrides, "reset");
  }

  /**
   * Drain pending writes:
   * 1. Fire the debounced save immediately (if scheduled).
   * 2. Await the in-flight write, if any.
   *
   * Safe to call before `ready` resolves — it will simply observe that no
   * write is scheduled and return. Rejects with the underlying I/O failure
   * when a save is pending and `Plugin.saveData()` throws.
   */
  async flush(): Promise<void> {
    const runResult = this.#scheduleSave.run();
    if (runResult) await runResult;
    const pending = this.#pendingWrite;
    if (pending) await pending;
  }

  #snapshot(): Settings {
    return { ...defaults, ...this.#overrides };
  }

  /**
   * Shared mutation tail: full-schema validate then commit-notify-schedule.
   * @throws with `cause: result.issues` on validation failure; leaves state
   * unchanged so callers can retry with corrected input.
   */
  #commitMutation(
    nextOverrides: Partial<Settings>,
    op: "update" | "reset",
  ): Readonly<Settings> {
    const candidate: Settings = { ...defaults, ...nextOverrides };
    const result = v.safeParse(schema, candidate);
    if (!result.success) {
      const error = new Error(
        `SettingsService.${op}(): invalid settings — ${v.summarize(result.issues)}`,
      );
      (error as { cause?: unknown }).cause = result.issues;
      throw error;
    }
    this.#overrides = nextOverrides;
    this.#notify();
    this.#scheduleSave();
    return candidate;
  }

  #notify(): void {
    const value = this.#loaded ? this.#snapshot() : null;
    for (const fn of this.#subscribers) invokeSubscriber(fn, value);
  }

  /**
   * Eager single-flight load. Acquires a local stack with a flush defer so
   * disposal drains pending writes; ownership transfers via `commit()` only
   * after the in-memory state is chosen and subscribers are notified.
   */
  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    stack.defer(async () => {
      await this.flush();
    });

    const raw = await this.#plugin.loadData();
    await this.#hydrateFrom(raw);

    this.#loaded = true;
    this.#notify();
    this.commit(stack.move());
  }

  async #hydrateFrom(raw: unknown): Promise<void> {
    const classification = classifyDiskData(raw);
    this.#hydrationOrigin = hydrationOriginOf(classification.kind);
    switch (classification.kind) {
      case "missing": {
        this.#overrides = {};
        return;
      }
      case "v7": {
        this.#loadV7(classification.raw);
        return;
      }
      case "v6": {
        await this.#loadV6Migration(classification.raw);
        return;
      }
      case "v5": {
        await this.#loadV5Migration(classification.raw);
        return;
      }
      case "v4": {
        await this.#loadV4Migration(classification.raw);
        return;
      }
      case "v3": {
        await this.#loadV3Migration(classification.raw);
        return;
      }
      case "v2": {
        await this.#loadV2Migration(classification.raw);
        return;
      }
      case "v1": {
        await this.#loadV1Migration(classification.raw);
        return;
      }
      case "legacy": {
        await this.#loadLegacy(classification.raw);
        return;
      }
      case "future": {
        console.warn(
          `data version ${classification.version} is newer than supported (${CURRENT_VERSION}); falling back to defaults`,
        );
        this.#overrides = {};
        return;
      }
      case "malformed": {
        console.warn(
          `malformed data on disk (${classification.reason}); falling back to defaults`,
        );
        this.#overrides = {};
        return;
      }
    }
  }

  /**
   * Permissive v7 load: drop non-schema keys and bad per-key values, then
   * full-schema check for cross-field constraints. Whole-object failure →
   * defaults fallback with no rewrite.
   */
  #loadV7(raw: Record<string, unknown>): void {
    this.#overrides = this.#validateOverrides(raw, "v7 data") ?? {};
  }

  /** Run the v6→v7 compatibility migration and persist the cleaned result. */
  async #loadV6Migration(raw: Record<string, unknown>): Promise<void> {
    const migrated = runMigrationHook(this.#migrateV6, raw, "v6 migration");
    if (migrated === null) {
      this.#overrides = {};
      await this.#writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
      return;
    }

    const cleaned = this.#validateOverrides(migrated, "v6 migration result");
    this.#overrides = cleaned ?? {};
    await this.#writeBestEffort({
      [VERSION_KEY]: CURRENT_VERSION,
      ...cleaned,
    });
  }

  /** Run the v5→v6 compatibility migration and delegate to v6→v7. */
  async #loadV5Migration(raw: Record<string, unknown>): Promise<void> {
    const migrated = runMigrationHook(this.#migrateV5, raw, "v5 migration");
    if (migrated === null) {
      this.#overrides = {};
      await this.#writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
      return;
    }

    await this.#loadV6Migration(migrated);
  }

  /** Run the v4→v5 compatibility migration and delegate to v5→v6. */
  async #loadV4Migration(raw: Record<string, unknown>): Promise<void> {
    const migrated = runMigrationHook(this.#migrateV4, raw, "v4 migration");
    if (migrated === null) {
      this.#overrides = {};
      await this.#writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
      return;
    }

    await this.#loadV5Migration(migrated);
  }

  /** Run the v3→v4 compatibility migration and delegate to the v4 migration. */
  async #loadV3Migration(raw: Record<string, unknown>): Promise<void> {
    const migrated = runMigrationHook(this.#migrateV3, raw, "v3 migration");
    if (migrated === null) {
      this.#overrides = {};
      await this.#writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
      return;
    }

    await this.#loadV4Migration(migrated);
  }

  /**
   * v2 → v3 → v4 → v5 → v6 → v7 migration. Runs the v2 hook, then delegates to the v3
   * migration. A thrown error or non-plain result falls back to defaults.
   * Persistence is best-effort cleanup: write errors never block load.
   */
  async #loadV2Migration(raw: Record<string, unknown>): Promise<void> {
    const migrated = runMigrationHook(this.#migrateV2, raw, "v2 migration");
    if (migrated === null) {
      this.#overrides = {};
      await this.#writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
      return;
    }

    await this.#loadV3Migration(migrated);
  }

  /**
   * v1 → v2 → v3 → v4 → v5 → v6 → v7 migration. Runs the v1 hook, then delegates to the
   * v2 migration. A thrown error or non-plain result falls back to defaults.
   * Persistence is best-effort cleanup: write errors never block load.
   */
  async #loadV1Migration(raw: Record<string, unknown>): Promise<void> {
    const migrated = runMigrationHook(this.#migrateV1, raw, "v1 migration");
    if (migrated === null) {
      this.#overrides = {};
      await this.#writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
      return;
    }

    await this.#loadV2Migration(migrated);
  }

  /**
   * v0 → v1 → v2 → v3 → v4 → v5 → v6 → v7 migration chain. Runs the legacy hook first
   * (v0 had no frontmatter fields, so the v1→v2 stamp is a no-op there), then
   * delegates to {@link #loadV1Migration} so the rest of the chain — running
   * `migrateV1` and the permissive cleanup that follows — lives in one place.
   * The legacy hook's own failure branch (defaults + best-effort
   * `{ [VERSION_KEY]: 7 }` write) stays here; persistence beyond that point is
   * `#loadV1Migration`'s.
   */
  async #loadLegacy(raw: Record<string, unknown>): Promise<void> {
    const legacyMigrated = runMigrationHook(
      this.#migrateLegacy,
      raw,
      "legacy migration",
    );
    if (legacyMigrated === null) {
      this.#overrides = {};
      await this.#writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
      return;
    }

    await this.#loadV1Migration(legacyMigrated);
  }

  /**
   * Shared disk-recovery tail: drop non-schema keys and bad per-key values,
   * then full-schema check for cross-field constraints. Returns the cleaned
   * overrides, or `null` when full-schema validation fails (callers fall back
   * to defaults). Failures are logged with `context` as the source prefix.
   */
  #validateOverrides(
    raw: Record<string, unknown>,
    context: string,
  ): Partial<Settings> | null {
    const cleaned = cleanKnownOverrides(raw);
    const result = v.safeParse(schema, { ...defaults, ...cleaned });
    if (!result.success) {
      console.warn(
        `${context} failed full-schema validation (${v.summarize(result.issues)}); falling back to defaults`,
      );
      return null;
    }
    return cleaned;
  }

  /** Errors are logged but never bubble up — load continues with the already-chosen in-memory state. */
  async #writeBestEffort(payload: Record<string, unknown>): Promise<void> {
    try {
      await this.#plugin.saveData(payload);
    } catch (error) {
      console.error("settings migration write failed", error);
    }
  }

  /**
   * Promise tracked in `#pendingWrite` with identity-guarded clearing so an
   * older write cannot wipe a newer one. A no-op `.catch` handler prevents
   * unhandled-rejection warnings on fire-and-forget timer firings while keeping
   * failures observable through `flush()`.
   */
  #performSave(): Promise<void> {
    const payload = { [VERSION_KEY]: CURRENT_VERSION, ...this.#overrides };
    let promise!: Promise<void>;
    promise = (async () => {
      try {
        await this.#plugin.saveData(payload);
      } finally {
        if (this.#pendingWrite === promise) {
          this.#pendingWrite = undefined;
        }
      }
    })();
    this.#pendingWrite = promise;
    promise.catch((error: unknown) => {
      console.error("background save failed", error);
    });
    return promise;
  }

  #requireLoaded(op: string): void {
    if (!this.#loaded) {
      throw new Error(
        `SettingsService.${op}(): settings have not loaded yet — await service.ready (or service.loaded) before mutating`,
      );
    }
  }
}

/**
 * Drop non-schema keys (including reserved metadata), then per-key-validate
 * every schema-known override with `schema.entries[key]`. Silently dropping
 * bad values is intentional: they get a chance to disappear on the next
 * explicit settings write.
 */
function cleanKnownOverrides(raw: Record<string, unknown>): Partial<Settings> {
  const cleaned: Partial<Settings> = {};
  for (const key of Object.keys(raw)) {
    if (!isSettingsKey(key)) continue;
    const entry = schema.entries[key];
    const result = v.safeParse(entry, raw[key]);
    if (result.success) {
      (cleaned as Record<string, unknown>)[key] = result.output;
    }
  }
  return cleaned;
}

/**
 * Run a migration hook, normalizing a thrown error and a non-plain return
 * into a single failure signal (`null`) so callers share one fallback path.
 * Logs at the call site with `stage` naming which migration step failed.
 */
function runMigrationHook(
  hook: (raw: unknown) => unknown,
  raw: unknown,
  stage: string,
): Record<string, unknown> | null {
  let migrated: unknown;
  try {
    migrated = hook(raw);
  } catch (error) {
    console.warn(`${stage} threw; falling back to defaults`, error);
    return null;
  }
  if (!isPlainObject(migrated)) {
    console.warn(
      `${stage} returned a non-plain value; falling back to defaults`,
    );
    return null;
  }
  return migrated;
}

function assertWritableKey(key: string, op: string): void {
  if (key === VERSION_KEY) {
    throw new Error(
      `SettingsService.${op}(): '${VERSION_KEY}' is reserved and cannot be mutated`,
    );
  }
  if (!isSettingsKey(key)) {
    throw new Error(`SettingsService.${op}(): unknown settings key '${key}'`);
  }
}

/**
 * `ready` should rejects only for `Plugin.loadData()` failures, and
 * `update()` must remain synchronous; an isolated try/catch ensures a
 * misbehaving subscriber cannot break either invariant or stop the fan-out.
 */
function invokeSubscriber(
  fn: (value: Readonly<Settings> | null) => void,
  value: Readonly<Settings> | null,
): void {
  try {
    fn(value);
  } catch (error) {
    console.error("subscriber threw", error);
  }
}
