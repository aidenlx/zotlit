/** Zotero preferences for settings, views, and legacy services. */
import { Effect, Stream } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";
import { isScopeClosed } from "@/lib/effect-scope";

import type { PrefValue } from "./prefs-file";
import { ZoteroPref } from "./service";
import type { ZoteroPrefSnapshot, ZoteroProfileInfo } from "./service";

export interface PlainZoteroPref extends Omit<ZoteroPrefSnapshot, "prefs"> {
  get(name: string): PrefValue | undefined;
  setProfileDir(dir: string | null): void;
  setDataDir(dir: string | null): void;
  companionInstalled(): Promise<boolean>;
  listProfiles(): Promise<ZoteroProfileInfo[]>;
  readonly changes: Stream.Stream<ZoteroPrefSnapshot>;
  readonly changed: Stream.Stream<void>;
  readonly "data-dir-changed": Stream.Stream<void>;
  readonly "resolved-changed": Stream.Stream<void>;
}

export function plainZoteroPref(
  runtime: ManagedRuntime.ManagedRuntime<ZoteroPref, never>,
): PlainZoteroPref {
  const pref = runtime.runSync(ZoteroPref.use(Effect.succeed));
  const context = runtime.runSync(Effect.context<ZoteroPref>());
  const closed = () => isScopeClosed(runtime.scope);
  // ManagedRuntime rejects runs after disposal. The held service still permits
  // snapshot and file reads, and its closed guard makes setters no-ops. Keep the
  // runtime's context for those released calls (Effect's run*With boundary).
  const runReleasedSync = Effect.runSyncWith(context);
  const runReleasedPromise = Effect.runPromiseWith(context);
  const runSync = <A>(effect: Effect.Effect<A>): A =>
    closed() ? runReleasedSync(effect) : runtime.runSync(effect);
  const runPromise = <A>(effect: Effect.Effect<A>): Promise<A> =>
    closed() ? runReleasedPromise(effect) : runtime.runPromise(effect);
  const current = () => runSync(pref.current);
  return {
    get state() {
      return current().state;
    },
    get resolvedProfileDir() {
      return current().resolvedProfileDir;
    },
    get profileDirOverride() {
      return current().profileDirOverride;
    },
    get dataDirOverride() {
      return current().dataDirOverride;
    },
    get dataDir() {
      return current().dataDir;
    },
    get databasePath() {
      return current().databasePath;
    },
    get sourceId() {
      return current().sourceId;
    },
    get baseAttachmentPath() {
      return current().baseAttachmentPath;
    },
    get httpPort() {
      return current().httpPort;
    },
    get: (name) => runSync(pref.get(name)),
    setProfileDir: (dir) => runSync(pref.setProfileDir(dir)),
    setDataDir: (dir) => runSync(pref.setDataDir(dir)),
    companionInstalled: () => runPromise(pref.companionInstalled()),
    listProfiles: () => runPromise(pref.listProfiles()),
    changes: pref.changes,
    changed: pref.changes.pipe(
      Stream.changesWith((a, b) => a.prefs === b.prefs),
      Stream.drop(1),
      Stream.map(() => undefined),
    ),
    "data-dir-changed": pref.changes.pipe(
      Stream.changesWith((a, b) => a.dataDirOverride === b.dataDirOverride),
      Stream.drop(1),
      Stream.map(() => undefined),
    ),
    "resolved-changed": pref.changes.pipe(
      Stream.changesWith(
        (a, b) =>
          a.prefs === b.prefs && a.dataDirOverride === b.dataDirOverride,
      ),
      Stream.drop(1),
      Stream.map(() => undefined),
    ),
  };
}
