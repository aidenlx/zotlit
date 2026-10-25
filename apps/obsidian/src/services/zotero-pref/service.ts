/**
 * Zotero preferences and the per-vault, per-device directory overrides.
 * Reads prefs.js at startup and when the profile override changes. There is
 * no file watcher. Reads run on the layer Scope; failures publish degraded
 * state with empty preferences. Unset overrides restore automatic detection.
 */
import {
  Cause,
  Context,
  Effect,
  Layer,
  PubSub,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { sourceIdFromUris } from "@zotlit/protocol";

import { COMPANION_ADDON_ID, ZOTERO_DB_FILENAME } from "@/lib/constants";
import { withLogCategory } from "@/lib/effect-log";
import { startupBarrier } from "@/lib/effect-startup";
import { systemCallError } from "@/lib/errno";
import type { SystemCallError } from "@/lib/errno";
import { ObsidianApp } from "@/lib/obsidian-app";

import {
  loadZoteroPathOverrides,
  saveZoteroPathOverrides,
} from "./device-paths";
import {
  EXTENSIONS_FILENAME,
  getZoteroProfilesRoot,
  isAddonActive,
  parsePrefsJs,
  parseZoteroProfiles,
  PREF_BRANCH,
  PREFS_FILENAME,
  PROFILES_INI_FILENAME,
  resolveZoteroHttpPort,
  resolveProfileDir,
  selectDefaultProfile,
  ZOTERO_HTTP_PORT_PREF,
} from "./prefs-file";
import type { PrefValue } from "./prefs-file";

/** The file-system boundary, replaced by controlled reads in lifecycle tests. */
export class ZoteroPrefFiles extends Context.Service<
  ZoteroPrefFiles,
  {
    read(path: string): Effect.Effect<string, SystemCallError>;
  }
>()("zotlit/zotero-pref/ZoteroPrefFiles") {}

export const layerZoteroPrefFiles = Layer.succeed(ZoteroPrefFiles, {
  read: Effect.fn("ZoteroPrefFiles.read")(function* (path: string) {
    return yield* Effect.tryPromise({
      try: (signal) => readFile(path, { encoding: "utf8", signal }),
      catch: systemCallError,
    });
  }),
});

/** `profiles.ini` names no default profile; the prefs load degrades. */
class NoDefaultZoteroProfile extends Schema.TaggedError<
  NoDefaultZoteroProfile,
  { readonly brand: unique symbol }
>()("NoDefaultZoteroProfile", { message: Schema.String }) {}

/** A profile resolved to its absolute directory, for the settings picker. */
export interface ZoteroProfileInfo {
  name: string | null;
  dir: string;
  isDefault: boolean;
}

export interface ZoteroPrefSnapshot {
  readonly state: "loading" | "ready" | "degraded";
  readonly prefs: ReadonlyMap<string, PrefValue>;
  readonly resolvedProfileDir: string | null;
  /** The chosen profile directory; null selects the default in profiles.ini. */
  readonly profileDirOverride: string | null;
  /** The chosen data directory; null uses the profile preferences. */
  readonly dataDirOverride: string | null;
  readonly dataDir: string;
  readonly databasePath: string;
  /** Companion-compatible profile/data-directory hash; null until resolved. */
  readonly sourceId: string | null;
  readonly baseAttachmentPath: string | null;
  readonly httpPort: number | null;
}

export class ZoteroPref extends Context.Service<
  ZoteroPref,
  {
    readonly current: Effect.Effect<ZoteroPrefSnapshot>;
    readonly changes: Stream.Stream<ZoteroPrefSnapshot>;
    /** Read a bare preference name under the extensions.zotero. branch. */
    get(name: string): Effect.Effect<PrefValue | undefined>;
    setProfileDir(dir: string | null): Effect.Effect<void>;
    setDataDir(dir: string | null): Effect.Effect<void>;
    /** Read the add-on list fresh, so a new Companion install is visible. */
    readonly companionInstalled: Effect.Effect<boolean>;
    readonly listProfiles: Effect.Effect<ZoteroProfileInfo[]>;
  }
>()("zotlit/zotero-pref/ZoteroPref") {}

/** Fires when the resolved paths may have moved: the prefs or the data directory override changed. */
export function resolvedChanged(
  pref: Pick<ZoteroPref["Service"], "changes">,
): Stream.Stream<void> {
  return pref.changes.pipe(
    Stream.changesWith(
      (a, b) => a.prefs === b.prefs && a.dataDirOverride === b.dataDirOverride,
    ),
    Stream.drop(1),
    Stream.map(() => undefined),
  );
}

export const layerZoteroPref = Layer.effect(
  ZoteroPref,
  Effect.gen(function* () {
    const app = yield* ObsidianApp;
    const files = yield* ZoteroPrefFiles;
    const scope = yield* Effect.scope;
    const overrides = loadZoteroPathOverrides(app);
    const state = yield* SubscriptionRef.make(
      snapshot({
        profileDirOverride: overrides.profileDir,
        dataDirOverride: overrides.dataDir,
        state: "loading",
        prefs: new Map(),
        resolvedProfileDir: null,
      }),
    );
    const current = SubscriptionRef.get(state);
    let generation = 0;
    let closed = false;

    const readProfiles = Effect.fn("ZoteroPref.readProfiles")(function* () {
      const root = getZoteroProfilesRoot();
      const profiles = parseZoteroProfiles(
        yield* files.read(join(root, PROFILES_INI_FILENAME)),
      );
      return { root, profiles };
    });

    const reload = Effect.fn("ZoteroPref.reload")(function* (
      overrideDir: string | null,
    ) {
      const gen = ++generation;
      let profileDir = overrideDir;
      const loaded = yield* Effect.gen(function* () {
        if (profileDir === null) {
          const { root, profiles } = yield* readProfiles();
          const profile = selectDefaultProfile(profiles);
          if (!profile)
            return yield* new NoDefaultZoteroProfile({
              message: `No default Zotero profile found in ${join(root, PROFILES_INI_FILENAME)}`,
            });
          profileDir = resolveProfileDir(root, profile);
        }
        return parsePrefsJs(
          yield* files.read(join(profileDir, PREFS_FILENAME)),
        );
      }).pipe(Effect.exit);
      if (closed || gen !== generation) return;
      if (loaded._tag === "Success") {
        yield* SubscriptionRef.update(state, (before) =>
          snapshot({
            ...before,
            prefs: loaded.value,
            resolvedProfileDir: profileDir,
            state: "ready",
          }),
        );
        yield* Effect.logDebug("Loaded Zotero prefs").pipe(
          Effect.annotateLogs({ profileDir, count: loaded.value.size }),
        );
      } else {
        if (Cause.hasInterruptsOnly(loaded.cause)) return;
        yield* SubscriptionRef.update(state, (before) =>
          snapshot({
            ...before,
            prefs: new Map(),
            resolvedProfileDir: profileDir,
            state: "degraded",
          }),
        );
        yield* Effect.logWarning("Failed to read Zotero prefs").pipe(
          Effect.annotateLogs({
            error: Cause.squash(loaded.cause),
            profileDir,
          }),
        );
      }
    }, withLogCategory("zotero-pref"));

    const setDataDir = Effect.fn("ZoteroPref.setDataDir")(
      function* (dir: string | null) {
        const before = yield* current;
        if (closed || dir === before.dataDirOverride) return;
        saveZoteroPathOverrides(app, {
          profileDir: before.profileDirOverride,
          dataDir: dir,
        });
        yield* SubscriptionRef.set(
          state,
          snapshot({ ...before, dataDirOverride: dir }),
        );
        yield* Effect.logDebug("Data dir override changed").pipe(
          Effect.annotateLogs({ dir }),
        );
      },
      Effect.uninterruptible,
      withLogCategory("zotero-pref"),
    );

    const setProfileDir = Effect.fn("ZoteroPref.setProfileDir")(
      function* (dir: string | null) {
        const before = yield* current;
        if (closed || dir === before.profileDirOverride) return;
        saveZoteroPathOverrides(app, {
          profileDir: dir,
          dataDir: before.dataDirOverride,
        });
        yield* SubscriptionRef.set(
          state,
          snapshot({ ...before, profileDirOverride: dir }),
        );
        yield* Effect.logDebug(
          "Profile dir override changed; re-reading prefs",
        ).pipe(Effect.annotateLogs({ dir }));
        yield* Effect.forkIn(Effect.interruptible(reload(dir)), scope, {
          startImmediately: true,
        });
      },
      Effect.uninterruptible,
      withLogCategory("zotero-pref"),
    );

    yield* startupBarrier(
      reload(overrides.profileDir),
      SubscriptionRef.update(state, (before) =>
        before.state === "loading"
          ? { ...before, state: "degraded" as const }
          : before,
      ).pipe(
        Effect.andThen(
          Effect.logWarning(
            "Zotero preferences are still loading; using fallback paths",
          ),
        ),
      ),
    );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
      }).pipe(Effect.andThen(PubSub.shutdown(state.pubsub))),
    );

    return ZoteroPref.of({
      current,
      changes: SubscriptionRef.changes(state),
      get: Effect.fn("ZoteroPref.get")(function* (name: string) {
        return (yield* current).prefs.get(PREF_BRANCH + name);
      }),
      setDataDir,
      setProfileDir,
      companionInstalled: Effect.gen(function* () {
        const { resolvedProfileDir: profileDir } = yield* current;
        if (!profileDir) return false;
        return yield* files.read(join(profileDir, EXTENSIONS_FILENAME)).pipe(
          Effect.map((content) => isAddonActive(content, COMPANION_ADDON_ID)),
          Effect.catchCause((error) =>
            Effect.logDebug("Cannot read the Zotero add-on list").pipe(
              Effect.annotateLogs({ error, profileDir }),
              Effect.as(false),
            ),
          ),
        );
      }).pipe(
        withLogCategory("zotero-pref"),
        Effect.withSpan("ZoteroPref.companionInstalled"),
      ),
      listProfiles: readProfiles().pipe(
        Effect.map(({ root, profiles }) =>
          profiles.map((p) => ({
            name: p.name,
            dir: resolveProfileDir(root, p),
            isDefault: p.isDefault,
          })),
        ),
        Effect.catchCause((error) =>
          Effect.logWarning("Failed to list Zotero profiles").pipe(
            Effect.annotateLogs({ error }),
            Effect.as<ZoteroProfileInfo[]>([]),
          ),
        ),
        withLogCategory("zotero-pref"),
        Effect.withSpan("ZoteroPref.listProfiles"),
      ),
    });
  }).pipe(withLogCategory("zotero-pref")),
);

/** The same path fallback Zotero uses, with Device Overrides taking priority. */
function snapshot(
  input: Pick<
    ZoteroPrefSnapshot,
    | "state"
    | "prefs"
    | "resolvedProfileDir"
    | "profileDirOverride"
    | "dataDirOverride"
  >,
): ZoteroPrefSnapshot {
  const get = (name: string) => input.prefs.get(PREF_BRANCH + name);
  const prefDir = get("dataDir");
  const dataDir =
    input.dataDirOverride ||
    (get("useDataDir") === true && typeof prefDir === "string" && prefDir
      ? prefDir
      : join(homedir(), "Zotero"));
  const base = get("baseAttachmentPath");
  return {
    ...input,
    dataDir,
    databasePath: join(dataDir, ZOTERO_DB_FILENAME),
    sourceId: input.resolvedProfileDir
      ? sourceIdFromUris(
          pathToFileURL(input.resolvedProfileDir).href,
          pathToFileURL(dataDir).href,
        )
      : null,
    baseAttachmentPath: typeof base === "string" ? base : null,
    httpPort: resolveZoteroHttpPort(get(ZOTERO_HTTP_PORT_PREF)),
  };
}
