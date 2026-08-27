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
 * - `data.json` is sparse: `{ __VERSION__: 9, ...overrides }`. Never persist
 *   `{ __VERSION__: 9, ...current }` — defaults-filled output defeats the
 *   format and bloats user files.
 * - Default-equal override values are still explicit overrides and must
 *   persist; do not auto-delete a key because its value equals the default.
 * - V9 load is non-writing: non-schema keys are dropped in memory only and may
 *   disappear on the next explicit save, while a known key whose value fails
 *   validation keeps its raw value on disk (see Broken overrides).
 * - V1 data migrates to v2 (`migrateV1`): every `note.frontmatter-fields` item
 *   gains a required `language`, stamped `"javascript"` except for the three
 *   byte-exact v1 default exprs, which become their Liquid equivalents.
 * - Legacy through v8→v9 migration writes are best-effort
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
 * ## Broken overrides
 *
 * A v9 override on a known key whose value fails per-key validation is a
 * *broken override*. Its effective value is that key's default in every
 * snapshot (`current`, `loaded`, subscribers), while the raw value stays in
 * `#broken` and is written back on every save, so an unrelated mutation cannot
 * silently discard it. `diagnostics` names each broken key so a consumer can
 * report it. `update()` and `reset()` of that key clear the entry, which is the
 * only way the raw value leaves the file. Migration paths do not preserve
 * broken values: they rewrite the file as best-effort cleanup.
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
import { DEFAULT_LITERATURE_NOTE_PROFILE, defaults, schema } from "./schema";
import type {
  LiteratureNoteProfile,
  LiteratureNoteProfileBindings,
  Settings,
} from "./schema";

const SAVE_DEBOUNCE_MS = 200;
const CURRENT_VERSION = 9;

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

/** One known settings key whose persisted override failed validation. */
export interface SettingsDiagnostic {
  readonly key: keyof Settings;
  /** The rejected value as persisted, kept until that key is updated or reset. */
  readonly value: unknown;
}

export interface LiteratureNoteProfilePatch {
  readonly label?: string;
  /** Document filename, or `null` to use the built-in document. */
  readonly document?: string | null;
  /** Complete sparse binding record. Omitted keys inherit global settings. */
  readonly bindings?: LiteratureNoteProfileBindings;
}

export interface ResolvedLiteratureNoteProfileBindings {
  readonly "note.literature-folder": string;
  readonly "citation.references-style": string | null;
}

/** Raw values of broken overrides, keyed by the settings key they belong to. */
type BrokenOverrides = ReadonlyMap<SettingsKey, unknown>;

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
  /**
   * Throwing or returning a non-plain value triggers the defaults fallback.
   */
  migrateV7: (raw: unknown) => unknown;
  /**
   * Throwing or returning a non-plain value triggers the defaults fallback.
   */
  migrateV8: (raw: unknown) => unknown;
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
  readonly #migrateV7;
  readonly #migrateV8;
  readonly #scheduleSave;
  readonly #subscribers = new Set<(value: Readonly<Settings> | null) => void>();

  #overrides: Partial<Settings> = {};
  #broken: BrokenOverrides = new Map();
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
    this.#migrateV7 = options.migrateV7;
    this.#migrateV8 = options.migrateV8;
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
   * Broken overrides carried by the current state — the keys whose snapshot
   * value is the schema default because the persisted value failed validation.
   * Empty before load finishes and whenever the file is clean.
   * @returns fresh clones of the rejected values, so a consumer that reports
   * them cannot mutate what stays persisted. Values come from `data.json`, so
   * they are JSON data and always structured-cloneable.
   */
  get diagnostics(): readonly SettingsDiagnostic[] {
    return [...this.#broken].map(([key, value]) => ({
      key,
      value: structuredClone(value),
    }));
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

  /** Get the empty built-in Profile, or one added Profile by its stable id. */
  getLiteratureNoteProfile(
    id?: string,
  ):
    | typeof DEFAULT_LITERATURE_NOTE_PROFILE
    | LiteratureNoteProfile
    | undefined {
    this.#requireLoaded("getLiteratureNoteProfile");
    if (id === undefined) return DEFAULT_LITERATURE_NOTE_PROFILE;
    const profile = this.#snapshot()["note.profiles"].find(
      (profile) => profile.id === id,
    );
    return profile && cloneLiteratureNoteProfile(profile);
  }

  /** Add a Profile with a generated identity and no binding overrides. */
  createLiteratureNoteProfile(label: string): LiteratureNoteProfile {
    this.#requireLoaded("createLiteratureNoteProfile");
    const profile = { id: crypto.randomUUID(), label };
    this.update((current) => ({
      "note.profiles": [...current["note.profiles"], profile],
    }));
    return cloneLiteratureNoteProfile(profile);
  }

  /** Edit one Profile while preserving its identity. */
  updateLiteratureNoteProfile(
    id: string,
    patch: LiteratureNoteProfilePatch,
  ): LiteratureNoteProfile {
    this.#requireLoaded("updateLiteratureNoteProfile");
    const profiles = this.#snapshot()["note.profiles"];
    const index = profiles.findIndex((profile) => profile.id === id);
    if (index === -1) throw new Error(`Unknown literature note Profile: ${id}`);
    const current = profiles[index]!;
    const bindings = patch.bindings ?? current.bindings;
    const document =
      patch.document === null
        ? undefined
        : (patch.document ?? current.document);
    const profile: LiteratureNoteProfile = {
      id,
      label: patch.label ?? current.label,
      ...(document === undefined ? {} : { document }),
      ...(bindings === undefined ? {} : { bindings }),
    };
    const next = [...profiles];
    next[index] = profile;
    this.update({ "note.profiles": next });
    return cloneLiteratureNoteProfile(profile);
  }

  /** Delete one added Profile. The built-in empty Profile is not stored. */
  deleteLiteratureNoteProfile(id: string): void {
    this.#requireLoaded("deleteLiteratureNoteProfile");
    const profiles = this.#snapshot()["note.profiles"];
    const next = profiles.filter((profile) => profile.id !== id);
    if (next.length === profiles.length) {
      throw new Error(`Unknown literature note Profile: ${id}`);
    }
    this.update({ "note.profiles": next });
  }

  /** Resolve sparse Profile bindings over the current global settings. */
  resolveLiteratureNoteProfileBindings(
    id?: string,
  ): ResolvedLiteratureNoteProfileBindings | undefined {
    this.#requireLoaded("resolveLiteratureNoteProfileBindings");
    const current = this.#snapshot();
    const profile =
      id === undefined
        ? undefined
        : current["note.profiles"].find((candidate) => candidate.id === id);
    if (id !== undefined && profile === undefined) return undefined;
    const bindings = profile?.bindings;
    return {
      "note.literature-folder":
        bindings?.["note.literature-folder"] ??
        current["note.literature-folder"],
      "citation.references-style":
        bindings?.["citation.references-style"] !== undefined
          ? bindings["citation.references-style"]
          : current["citation.references-style"],
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
   * Either way the key's broken override, if any, leaves the file.
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
    const nextBroken = new Map(this.#broken);
    for (const key of Object.keys(patch)) {
      const value = (patch as Record<string, unknown>)[key];
      if (value === RESET_SETTING) {
        delete nextOverrides[key as keyof Settings];
      } else {
        (nextOverrides as Record<string, unknown>)[key] = value;
      }
      nextBroken.delete(key as SettingsKey);
    }

    return this.#commitMutation(nextOverrides, nextBroken, "update");
  }

  /**
   * Delete overrides — broken ones included — for the given keys (or every
   * override when `keys` is omitted). Validates the post-reset effective
   * object through the full schema, schedules a debounced save, and returns a
   * fresh clone.
   * @throws before load finished or on unknown keys.
   */
  reset(keys?: readonly (keyof Settings)[]): Readonly<Settings> {
    this.#requireLoaded("reset");

    if (keys !== undefined) {
      for (const key of keys) assertWritableKey(key, "reset");
    }

    const nextOverrides = { ...this.#overrides };
    const nextBroken = new Map(this.#broken);
    if (keys === undefined) {
      for (const key of Object.keys(nextOverrides)) {
        delete nextOverrides[key as keyof Settings];
      }
      nextBroken.clear();
    } else {
      for (const key of keys) {
        delete nextOverrides[key];
        nextBroken.delete(key);
      }
    }

    return this.#commitMutation(nextOverrides, nextBroken, "reset");
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
    nextBroken: BrokenOverrides,
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
    this.#broken = nextBroken;
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
      case "v9": {
        this.#loadV9(classification.raw);
        return;
      }
      case "v8": {
        await this.#loadV8Migration(classification.raw);
        return;
      }
      case "v7": {
        await this.#loadV7Migration(classification.raw);
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
   * Permissive v9 load: drop non-schema keys, hold bad per-key values as
   * broken overrides, then full-schema check for cross-field constraints.
   * Whole-object failure → defaults fallback with no rewrite.
   */
  #loadV9(raw: Record<string, unknown>): void {
    const validated = this.#validateOverrides(raw, "v9 data");
    this.#overrides = validated?.cleaned ?? {};
    this.#broken = validated?.broken ?? new Map();
    if (this.#broken.size > 0) {
      // `console` rather than LogTape: load runs before `LoggingService`
      // configures the sinks, so a logger call here reaches nobody.
      console.warn(
        `invalid values in v9 data (${[...this.#broken.keys()].join(", ")}); using their defaults until each key is updated or reset`,
      );
    }
  }

  /** Run the v8→v9 compatibility migration and persist the cleaned result. */
  async #loadV8Migration(raw: Record<string, unknown>): Promise<void> {
    const migrated = runMigrationHook(this.#migrateV8, raw, "v8 migration");
    if (migrated === null) {
      this.#overrides = {};
      await this.#writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
      return;
    }

    const validated = this.#validateOverrides(migrated, "v8 migration result");
    this.#overrides = validated?.cleaned ?? {};
    await this.#writeBestEffort({
      [VERSION_KEY]: CURRENT_VERSION,
      ...validated?.cleaned,
    });
  }

  /** Run the v7→v8 compatibility migration and delegate to v8→v9. */
  async #loadV7Migration(raw: Record<string, unknown>): Promise<void> {
    const migrated = runMigrationHook(this.#migrateV7, raw, "v7 migration");
    if (migrated === null) {
      this.#overrides = {};
      await this.#writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
      return;
    }

    await this.#loadV8Migration(migrated);
  }

  /** Run the v6→v7 compatibility migration and delegate to v7→v8. */
  async #loadV6Migration(raw: Record<string, unknown>): Promise<void> {
    const migrated = runMigrationHook(this.#migrateV6, raw, "v6 migration");
    if (migrated === null) {
      this.#overrides = {};
      await this.#writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
      return;
    }

    await this.#loadV7Migration(migrated);
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
   * v2 → v3 → v4 → v5 → v6 → v7 → v8 → v9 migration. Runs the v2 hook, then delegates to the v3
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
   * v1 → v2 → v3 → v4 → v5 → v6 → v7 → v8 → v9 migration. Runs the v1 hook, then delegates to the
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
   * v0 → v1 → v2 → v3 → v4 → v5 → v6 → v7 → v8 → v9 migration chain. Runs the legacy hook first
   * (v0 had no frontmatter fields, so the v1→v2 stamp is a no-op there), then
   * delegates to {@link #loadV1Migration} so the rest of the chain — running
   * `migrateV1` and the permissive cleanup that follows — lives in one place.
   * The legacy hook's own failure branch (defaults + best-effort
   * `{ [VERSION_KEY]: 9 }` write) stays here; persistence beyond that point is
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
   * Shared disk-recovery tail: split known keys into cleaned and broken
   * overrides, then full-schema check the effective object for cross-field
   * constraints. Returns `null` when that check fails (callers fall back to
   * defaults). Failures are logged with `context` as the source prefix.
   */
  #validateOverrides(
    raw: Record<string, unknown>,
    context: string,
  ): { cleaned: Partial<Settings>; broken: BrokenOverrides } | null {
    const { cleaned, broken } = cleanKnownOverrides(raw);
    const result = v.safeParse(schema, { ...defaults, ...cleaned });
    if (!result.success) {
      console.warn(
        `${context} failed full-schema validation (${v.summarize(result.issues)}); falling back to defaults`,
      );
      return null;
    }
    return { cleaned, broken };
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
    const payload = {
      [VERSION_KEY]: CURRENT_VERSION,
      ...Object.fromEntries(this.#broken),
      ...this.#overrides,
    };
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
 * every schema-known override with `schema.entries[key]`. A rejected value is
 * returned as a broken override; the caller decides whether it survives.
 */
function cleanKnownOverrides(raw: Record<string, unknown>): {
  cleaned: Partial<Settings>;
  broken: BrokenOverrides;
} {
  const cleaned: Partial<Settings> = {};
  const broken = new Map<SettingsKey, unknown>();
  for (const key of Object.keys(raw)) {
    if (!isSettingsKey(key)) continue;
    const entry = schema.entries[key];
    const result = v.safeParse(entry, raw[key]);
    if (result.success) {
      (cleaned as Record<string, unknown>)[key] = result.output;
    } else {
      broken.set(key, raw[key]);
    }
  }
  return { cleaned, broken };
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

function cloneLiteratureNoteProfile(
  profile: LiteratureNoteProfile,
): LiteratureNoteProfile {
  return {
    id: profile.id,
    label: profile.label,
    ...(profile.document === undefined ? {} : { document: profile.document }),
    ...(profile.bindings === undefined
      ? {}
      : { bindings: { ...profile.bindings } }),
  };
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
