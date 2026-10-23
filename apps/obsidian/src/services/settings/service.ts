/**
 * `PluginSettings` — reactive, validated, single-flight settings store for
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
 * vitest case. The service is intentionally concrete (no `<TSchema>` generic).
 *
 * `null` is a legal settings value (used by keys whose concrete default is
 * host-dependent and resolved at the consume site). The service surfaces
 * `null` verbatim and `update({ key: null })` creates a persistent explicit
 * null override. `RESET_SETTING` is the canonical "remove the override
 * entirely" path; both produce `null` in the snapshot but differ on disk.
 *
 * ## Disk format
 *
 * - `data.json` is sparse: `{ __VERSION__: 10, ...overrides }`. Never persist
 *   `{ __VERSION__: 10, ...current }` — defaults-filled output defeats the
 *   format and bloats user files.
 * - Default-equal override values are still explicit overrides and must
 *   persist; do not auto-delete a key because its value equals the default.
 * - V9 load is non-writing: non-schema keys are dropped in memory only and may
 *   disappear on the next explicit save, while a known key whose value fails
 *   validation keeps its raw value on disk (see Broken overrides).
 * - V1 data migrates to v2 (`migrateV1`): every `note.frontmatter-fields` item
 *   gains a required `language`, stamped `"javascript"` except for the three
 *   byte-exact v1 default exprs, which become their Liquid equivalents.
 * - Legacy through v9→v10 migration writes are best-effort
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
 * A v10 override on a known key whose value fails per-key validation is a
 * *broken override*. Its effective value is that key's default in every
 * snapshot (`current`, `loaded`, subscribers), while the raw value stays in
 * `broken` and is written back on every save, so an unrelated mutation cannot
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

import type { Plugin } from "obsidian";
import * as v from "valibot";

import {
  Cause,
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  PubSub,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
} from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log";
import type { ResolvedLiteratureNoteProfileBindings } from "@/services/profile/bindings";

import {
  classifyDiskData,
  hydrationOriginOf,
  isPlainObject,
  VERSION_KEY,
} from "./classify";
import type { HydrationOrigin } from "./classify";
import { settingsMigrations } from "./migrate";
import { defaults, schema } from "./schema";
import type { Settings } from "./schema";

const SAVE_DEBOUNCE_MS = 200;
// Persisted version: packages/scripts/lib/format-versions.ts.
const CURRENT_VERSION = 10;

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

/** Raw values of broken overrides, keyed by the settings key they belong to. */
type BrokenOverrides = ReadonlyMap<SettingsKey, unknown>;

export interface PluginSettingsOptions {
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
  /**
   * Throwing or returning a non-plain value triggers the defaults fallback.
   */
  migrateV9: (raw: unknown) => unknown;
  /**
   * The object this plugin's instances share across a reload, such as the
   * `App`. An instance leaves its last write on it as it unloads, and the next
   * instance waits for that write before it reads the plugin data, so a change
   * made just before a reload is neither lost nor overwritten.
   */
  handoff?: object;
}

/** Where an unloading instance leaves its last write for the next one. */
const LAST_WRITE = Symbol.for("zotlit.settings.last-write");
type Handoff = { [LAST_WRITE]?: Promise<void> };

export class SettingsMutationError extends Schema.TaggedError<SettingsMutationError>()(
  "SettingsMutationError",
  { message: Schema.String, cause: Schema.Defect() },
) {}

export class SettingsPersistenceError extends Schema.TaggedError<SettingsPersistenceError>()(
  "SettingsPersistenceError",
  { message: Schema.String, cause: Schema.Defect() },
) {}

const mutationFailure = (cause: unknown) =>
  new SettingsMutationError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
const persistenceFailure = (cause: unknown) =>
  new SettingsPersistenceError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

/** The settings store. Layer acquisition settles the first disk read. */
export class PluginSettings extends Context.Service<
  PluginSettings,
  {
    readonly current: Effect.Effect<Readonly<Settings>>;
    readonly loaded: Effect.Effect<Readonly<Settings>>;
    readonly diagnostics: Effect.Effect<readonly SettingsDiagnostic[]>;
    readonly hydrationOrigin: Effect.Effect<HydrationOrigin | null>;
    readonly changes: Stream.Stream<Readonly<Settings>>;
    update(
      patch: SettingsPatch | ((current: Readonly<Settings>) => SettingsPatch),
    ): Effect.Effect<Readonly<Settings>, SettingsMutationError>;
    reset(
      keys?: readonly (keyof Settings)[],
    ): Effect.Effect<Readonly<Settings>, SettingsMutationError>;
    updateDefaultLiteratureNoteProfileBindings(
      patch: Partial<ResolvedLiteratureNoteProfileBindings>,
    ): Effect.Effect<void, SettingsMutationError>;
    flush(): Effect.Effect<void, SettingsPersistenceError>;
    release(): Effect.Effect<void>;
  }
>()("zotlit/settings/PluginSettings") {}

/** Native settings layer, below logging and every consumer in the plugin graph. */
export function layerPluginSettings(
  plugin: Pick<Plugin, "loadData" | "saveData"> & Partial<Pick<Plugin, "app">>,
  options: Partial<PluginSettingsOptions> = {},
): Layer.Layer<PluginSettings> {
  return Layer.effect(PluginSettings, makePluginSettings(plugin, options));
}

const makePluginSettings = Effect.fn("PluginSettings.make")(function* (
  plugin: Pick<Plugin, "loadData" | "saveData"> & Partial<Pick<Plugin, "app">>,
  options: Partial<PluginSettingsOptions>,
) {
  const {
    migrateLegacy,
    migrateV1,
    migrateV2,
    migrateV3,
    migrateV4,
    migrateV5,
    migrateV6,
    migrateV7,
    migrateV8,
    migrateV9,
  } = { ...settingsMigrations, ...options };
  const handoff = (options.handoff ?? plugin.app) as Handoff | undefined;
  const state = yield* Effect.acquireRelease(
    SubscriptionRef.make<Readonly<Settings>>(defaults),
    (state) => PubSub.shutdown(state.pubsub),
  );
  let overrides: Partial<Settings> = {};
  let broken: BrokenOverrides = new Map();
  let hydrationOrigin: HydrationOrigin | null = null;
  let loadFailure: Cause.Cause<unknown> | undefined;
  let released = false;
  let closed = false;
  let dirty = false;
  let pendingWrite: Fiber.Fiber<void, SettingsPersistenceError> | undefined;
  let timer: Fiber.Fiber<void> | undefined;
  // Saves stay alive until the close finalizer has flushed the last edit.
  const writes = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);
  const snapshot = (): Settings => ({ ...defaults, ...overrides });
  const current = Effect.sync(snapshot);

  const performSave = Effect.fn("PluginSettings.save")(function* () {
    dirty = false;
    if (loadFailure)
      return yield* Effect.fail(persistenceFailure(Cause.squash(loadFailure)));
    const payload = {
      [VERSION_KEY]: CURRENT_VERSION,
      ...Object.fromEntries(broken),
      ...overrides,
    };
    const earlier = pendingWrite;
    // A storage call can throw before the immediately started fiber returns.
    let fiber: Fiber.Fiber<void, SettingsPersistenceError> | undefined;
    const write = Effect.gen(function* () {
      if (earlier) yield* Fiber.await(earlier);
      yield* Effect.tryPromise({
        try: () => plugin.saveData(payload),
        catch: persistenceFailure,
      });
    }).pipe(
      Effect.uninterruptible,
      Effect.tapCause((cause) =>
        reportFailure("background save failed", cause),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          if (pendingWrite === fiber) pendingWrite = undefined;
        }),
      ),
      withLogCategory("settings"),
    );
    fiber = yield* Effect.forkIn(write, writes, {
      startImmediately: true,
    });
    pendingWrite = fiber;
    return fiber;
  });

  const flush = Effect.fn("PluginSettings.flush")(function* () {
    while (dirty || pendingWrite) {
      if (timer) {
        timer.interruptUnsafe();
        timer = undefined;
      }
      const pending = dirty ? yield* performSave() : pendingWrite;
      if (pending) yield* Fiber.join(pending);
    }
  }, Effect.uninterruptible);

  // Obsidian unload is synchronous. The Promise is also the reload handoff;
  // the save it waits for belongs to `writes`, which scope close drains.
  const handOff = Effect.fn("PluginSettings.handOff")(function* () {
    const write = runPromise(
      flush().pipe(
        Effect.catchCause((cause) =>
          reportFailure("settings save on unload failed", cause),
        ),
      ),
    );
    if (handoff) handoff[LAST_WRITE] = write;
  });

  const commitMutation = Effect.fn("PluginSettings.commitMutation")(function* (
    nextOverrides: Partial<Settings>,
    nextBroken: BrokenOverrides,
    op: "update" | "reset",
  ) {
    const candidate: Settings = { ...defaults, ...nextOverrides };
    const result = v.safeParse(schema, candidate);
    if (!result.success)
      return yield* Effect.fail(
        new SettingsMutationError({
          message: `SettingsService.${op}(): invalid settings — ${v.summarize(result.issues)}`,
          cause: result.issues,
        }),
      );
    overrides = nextOverrides;
    broken = nextBroken;
    yield* SubscriptionRef.set(state, candidate);
    dirty = true;
    if (timer) timer.interruptUnsafe();
    timer = yield* Effect.forkIn(
      Effect.sleep(SAVE_DEBOUNCE_MS).pipe(
        Effect.andThen(flush()),
        Effect.catchCause(() => Effect.void),
      ),
      writes,
    );
    if (released) yield* handOff();
    return snapshot();
  });

  const update = Effect.fn("PluginSettings.update")(function* (
    patchOrUpdater:
      | SettingsPatch
      | ((current: Readonly<Settings>) => SettingsPatch),
  ) {
    if (closed) return snapshot();
    const patch = yield* Effect.try({
      try: () => {
        const patch =
          typeof patchOrUpdater === "function"
            ? patchOrUpdater(snapshot())
            : patchOrUpdater;
        for (const key of Object.keys(patch)) assertWritableKey(key, "update");
        return patch;
      },
      catch: mutationFailure,
    });
    const nextOverrides = { ...overrides };
    const nextBroken = new Map(broken);
    for (const key of Object.keys(patch)) {
      const value = (patch as Record<string, unknown>)[key];
      if (value === RESET_SETTING) delete nextOverrides[key as keyof Settings];
      else (nextOverrides as Record<string, unknown>)[key] = value;
      nextBroken.delete(key as SettingsKey);
    }
    return yield* commitMutation(nextOverrides, nextBroken, "update");
  });

  const reset = Effect.fn("PluginSettings.reset")(function* (
    keys?: readonly (keyof Settings)[],
  ) {
    if (closed) return snapshot();
    yield* Effect.try({
      try: () => {
        for (const key of keys ?? []) assertWritableKey(key, "reset");
      },
      catch: mutationFailure,
    });
    const nextOverrides = { ...overrides };
    const nextBroken = new Map(broken);
    for (const key of keys ?? (Object.keys(nextOverrides) as SettingsKey[])) {
      delete nextOverrides[key];
      nextBroken.delete(key);
    }
    if (keys === undefined) nextBroken.clear();
    return yield* commitMutation(nextOverrides, nextBroken, "reset");
  });

  const hydrateFrom = Effect.fn("PluginSettings.hydrateFrom")(function* (
    raw: unknown,
  ) {
    const classification = classifyDiskData(raw);
    hydrationOrigin = hydrationOriginOf(classification.kind);
    switch (classification.kind) {
      case "missing": {
        overrides = {};
        return;
      }
      case "v10": {
        yield* loadV10(classification.raw);
        return;
      }
      case "v9": {
        yield* loadV9Migration(classification.raw);
        return;
      }
      case "v8": {
        yield* loadV8Migration(classification.raw);
        return;
      }
      case "v7": {
        yield* loadV7Migration(classification.raw);
        return;
      }
      case "v6": {
        yield* loadV6Migration(classification.raw);
        return;
      }
      case "v5": {
        yield* loadV5Migration(classification.raw);
        return;
      }
      case "v4": {
        yield* loadV4Migration(classification.raw);
        return;
      }
      case "v3": {
        yield* loadV3Migration(classification.raw);
        return;
      }
      case "v2": {
        yield* loadV2Migration(classification.raw);
        return;
      }
      case "v1": {
        yield* loadV1Migration(classification.raw);
        return;
      }
      case "legacy": {
        yield* loadLegacy(classification.raw);
        return;
      }
      case "future": {
        yield* Effect.logWarning(
          `data version ${classification.version} is newer than supported (${CURRENT_VERSION}); falling back to defaults`,
        );
        overrides = {};
        return;
      }
      case "malformed": {
        yield* Effect.logWarning(
          `malformed data on disk (${classification.reason}); falling back to defaults`,
        );
        overrides = {};
        return;
      }
    }
  });

  /**
   * Permissive v10 load: drop non-schema keys, hold bad per-key values as
   * broken overrides, then full-schema check for cross-field constraints.
   * Whole-object failure → defaults fallback with no rewrite.
   */
  const loadV10 = Effect.fn("PluginSettings.loadV10")(function* (
    raw: Record<string, unknown>,
  ) {
    const validated = yield* validateOverrides(raw, "v10 data");
    overrides = validated?.cleaned ?? {};
    broken = validated?.broken ?? new Map();
    if (broken.size > 0) {
      yield* Effect.logWarning(
        `invalid values in v10 data (${[...broken.keys()].join(", ")}); using their defaults until each key is updated or reset`,
      );
    }
  });

  /** Run the v9→v10 compatibility migration and persist the cleaned result. */
  const loadV9Migration = Effect.fn("PluginSettings.loadV9Migration")(
    function* (raw: Record<string, unknown>) {
      const migrated = yield* runMigrationHook(migrateV9, raw, "v9 migration");
      if (migrated === null) {
        overrides = {};
        yield* writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
        return;
      }

      const validated = yield* validateOverrides(
        migrated,
        "v9 migration result",
      );
      overrides = validated?.cleaned ?? {};
      yield* writeBestEffort({
        [VERSION_KEY]: CURRENT_VERSION,
        ...validated?.cleaned,
      });
    },
  );

  /** Run the v8→v9 compatibility migration and delegate to v9→v10. */
  const loadV8Migration = Effect.fn("PluginSettings.loadV8Migration")(
    function* (raw: Record<string, unknown>) {
      const migrated = yield* runMigrationHook(migrateV8, raw, "v8 migration");
      if (migrated === null) {
        overrides = {};
        yield* writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
        return;
      }

      yield* loadV9Migration(migrated);
    },
  );

  /** Run the v7→v8 compatibility migration and delegate to v8→v9. */
  const loadV7Migration = Effect.fn("PluginSettings.loadV7Migration")(
    function* (raw: Record<string, unknown>) {
      const migrated = yield* runMigrationHook(migrateV7, raw, "v7 migration");
      if (migrated === null) {
        overrides = {};
        yield* writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
        return;
      }

      yield* loadV8Migration(migrated);
    },
  );

  /** Run the v6→v7 compatibility migration and delegate to v7→v8. */
  const loadV6Migration = Effect.fn("PluginSettings.loadV6Migration")(
    function* (raw: Record<string, unknown>) {
      const migrated = yield* runMigrationHook(migrateV6, raw, "v6 migration");
      if (migrated === null) {
        overrides = {};
        yield* writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
        return;
      }

      yield* loadV7Migration(migrated);
    },
  );

  /** Run the v5→v6 compatibility migration and delegate to v6→v7. */
  const loadV5Migration = Effect.fn("PluginSettings.loadV5Migration")(
    function* (raw: Record<string, unknown>) {
      const migrated = yield* runMigrationHook(migrateV5, raw, "v5 migration");
      if (migrated === null) {
        overrides = {};
        yield* writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
        return;
      }

      yield* loadV6Migration(migrated);
    },
  );

  /** Run the v4→v5 compatibility migration and delegate to v5→v6. */
  const loadV4Migration = Effect.fn("PluginSettings.loadV4Migration")(
    function* (raw: Record<string, unknown>) {
      const migrated = yield* runMigrationHook(migrateV4, raw, "v4 migration");
      if (migrated === null) {
        overrides = {};
        yield* writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
        return;
      }

      yield* loadV5Migration(migrated);
    },
  );

  /** Run the v3→v4 compatibility migration and delegate to the v4 migration. */
  const loadV3Migration = Effect.fn("PluginSettings.loadV3Migration")(
    function* (raw: Record<string, unknown>) {
      const migrated = yield* runMigrationHook(migrateV3, raw, "v3 migration");
      if (migrated === null) {
        overrides = {};
        yield* writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
        return;
      }

      yield* loadV4Migration(migrated);
    },
  );

  /**
   * v2 → v3 → v4 → v5 → v6 → v7 → v8 → v9 → v10 migration. Runs the v2 hook, then delegates to the v3
   * migration. A thrown error or non-plain result falls back to defaults.
   * Persistence is best-effort cleanup: write errors never block load.
   */
  const loadV2Migration = Effect.fn("PluginSettings.loadV2Migration")(
    function* (raw: Record<string, unknown>) {
      const migrated = yield* runMigrationHook(migrateV2, raw, "v2 migration");
      if (migrated === null) {
        overrides = {};
        yield* writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
        return;
      }

      yield* loadV3Migration(migrated);
    },
  );

  /**
   * v1 → v2 → v3 → v4 → v5 → v6 → v7 → v8 → v9 → v10 migration. Runs the v1 hook, then delegates to the
   * v2 migration. A thrown error or non-plain result falls back to defaults.
   * Persistence is best-effort cleanup: write errors never block load.
   */
  const loadV1Migration = Effect.fn("PluginSettings.loadV1Migration")(
    function* (raw: Record<string, unknown>) {
      const migrated = yield* runMigrationHook(migrateV1, raw, "v1 migration");
      if (migrated === null) {
        overrides = {};
        yield* writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
        return;
      }

      yield* loadV2Migration(migrated);
    },
  );

  /**
   * v0 → v1 → v2 → v3 → v4 → v5 → v6 → v7 → v8 → v9 → v10 migration chain. Runs the legacy hook first
   * (v0 had no frontmatter fields, so the v1→v2 stamp is a no-op there), then
   * delegates to {@link #loadV1Migration} so the rest of the chain — running
   * `migrateV1` and the permissive cleanup that follows — lives in one place.
   * The legacy hook's own failure branch (defaults + best-effort
   * `{ [VERSION_KEY]: 10 }` write) stays here; persistence beyond that point is
   * `#loadV1Migration`'s.
   */
  const loadLegacy = Effect.fn("PluginSettings.loadLegacy")(function* (
    raw: Record<string, unknown>,
  ) {
    const legacyMigrated = yield* runMigrationHook(
      migrateLegacy,
      raw,
      "legacy migration",
    );
    if (legacyMigrated === null) {
      overrides = {};
      yield* writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
      return;
    }

    yield* loadV1Migration(legacyMigrated);
  });

  /**
   * Shared disk-recovery tail: split known keys into cleaned and broken
   * overrides, then full-schema check the effective object for cross-field
   * constraints. Returns `null` when that check fails (callers fall back to
   * defaults). Failures are logged with `context` as the source prefix.
   */
  const validateOverrides = Effect.fn("PluginSettings.validateOverrides")(
    function* (
      raw: Record<string, unknown>,
      context: string,
    ): Effect.fn.Return<{
      cleaned: Partial<Settings>;
      broken: BrokenOverrides;
    } | null> {
      const { cleaned, broken } = cleanKnownOverrides(raw);
      const result = v.safeParse(schema, { ...defaults, ...cleaned });
      if (!result.success) {
        yield* Effect.logWarning(
          `${context} failed full-schema validation (${v.summarize(result.issues)}); falling back to defaults`,
        );
        return null;
      }
      return { cleaned, broken };
    },
  );

  /** Errors are logged but never bubble up — load continues with the already-chosen in-memory state. */
  const writeBestEffort = Effect.fn("PluginSettings.writeBestEffort")(
    function* (payload: Record<string, unknown>) {
      yield* Effect.tryPromise(() => plugin.saveData(payload)).pipe(
        Effect.uninterruptible,
        Effect.catchCause((cause) =>
          reportFailure("settings migration write failed", cause),
        ),
      );
    },
  );

  const load = Effect.gen(function* () {
    const last = handoff?.[LAST_WRITE];
    if (last) yield* Effect.promise(() => last);
    const raw = yield* Effect.tryPromise({
      try: () => plugin.loadData(),
      catch: (error) => error,
    });
    yield* hydrateFrom(raw);
  }).pipe(
    Effect.catchCause((cause) => {
      loadFailure = cause;
      return reportFailure(
        "Could not read settings; using defaults without saving",
        cause,
      );
    }),
    Effect.andThen(
      Effect.gen(function* () {
        if (closed) return;
        yield* SubscriptionRef.set(state, snapshot());
      }),
    ),
    withLogCategory("settings"),
  );
  yield* load;
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
    }).pipe(
      Effect.andThen(flush()),
      Effect.catchCause((cause) =>
        reportFailure("settings save on close failed", cause),
      ),
    ),
  );

  return PluginSettings.of({
    current,
    loaded: current,
    changes: SubscriptionRef.changes(state).pipe(
      Stream.map((value) => ({ ...value })),
    ),
    diagnostics: Effect.sync(() =>
      [...broken].map(([key, value]) => ({
        key,
        value: structuredClone(value),
      })),
    ),
    hydrationOrigin: Effect.sync(() => hydrationOrigin),
    update,
    reset,
    updateDefaultLiteratureNoteProfileBindings: Effect.fn(
      "PluginSettings.updateDefaultLiteratureNoteProfileBindings",
    )(function* (patch) {
      yield* update((current) => ({
        "note.default-profile": {
          ...current["note.default-profile"],
          bindings: { ...current["note.default-profile"].bindings, ...patch },
        },
      }));
    }),
    flush,
    release: Effect.fn("PluginSettings.release")(function* () {
      if (closed) return;
      released = true;
      yield* handOff();
    }),
  });
}, withLogCategory("settings"));

const reportFailure = (message: string, error: unknown) =>
  Effect.logError(message).pipe(
    Effect.annotateLogs({ error }),
    withLogCategory("settings"),
  );

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
const runMigrationHook = Effect.fn("PluginSettings.migrate")(function* (
  hook: (raw: unknown) => unknown,
  raw: unknown,
  stage: string,
): Effect.fn.Return<Record<string, unknown> | null> {
  let migrated: unknown;
  try {
    migrated = hook(raw);
  } catch (error) {
    yield* Effect.logWarning("Migration threw; falling back to defaults").pipe(
      Effect.annotateLogs({ error, stage }),
    );
    return null;
  }
  if (!isPlainObject(migrated)) {
    yield* Effect.logWarning(
      "Migration returned a non-plain value; falling back to defaults",
    ).pipe(Effect.annotateLogs({ error: migrated, stage }));
    return null;
  }
  return migrated;
});

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
