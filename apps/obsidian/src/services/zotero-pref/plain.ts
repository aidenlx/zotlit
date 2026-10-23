/** Zotero preferences for settings, views, and legacy services. */
import { Effect, Stream } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";

import type { PrefValue } from "./prefs-file";
import { ZoteroPref } from "./service";
import type { ZoteroPrefSnapshot, ZoteroProfileInfo } from "./service";

export interface ZoteroPrefEvents {
  changed: () => void;
  "data-dir-changed": () => void;
  "resolved-changed": () => void;
}

export interface PlainZoteroPref extends Omit<ZoteroPrefSnapshot, "prefs"> {
  get(name: string): PrefValue | undefined;
  setProfileDir(dir: string | null): void;
  setDataDir(dir: string | null): void;
  companionInstalled(): Promise<boolean>;
  listProfiles(): Promise<ZoteroProfileInfo[]>;
  /** Subsequent state changes; the returned function stops delivery. */
  subscribe(callback: (snapshot: ZoteroPrefSnapshot) => void): () => void;
  /** Compatibility events for callers that have not moved to the state Stream. */
  on<K extends keyof ZoteroPrefEvents>(
    event: K,
    callback: ZoteroPrefEvents[K],
  ): () => void;
}

export function plainZoteroPref(
  runtime: ManagedRuntime.ManagedRuntime<ZoteroPref, never>,
): PlainZoteroPref {
  const pref = runtime.runSync(ZoteroPref.use(Effect.succeed));
  const context = runtime.runSync(Effect.context<ZoteroPref>());
  const closed = () => runtime.scope.state._tag === "Closed";
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
  const subscribeChanges = (
    callback: (snapshot: ZoteroPrefSnapshot) => void,
  ) => {
    if (closed()) return () => {};
    const seen = current();
    let active = true;
    const fiber = runtime.runFork(
      Stream.dropWhile(pref.changes, (next) => next === seen).pipe(
        Stream.runForEach((next) =>
          Effect.sync(() => {
            if (active) callback(next);
          }),
        ),
      ),
    );
    // interruptWhen forks the upstream subscription. Attach it before callers
    // can publish two changes; latest-value replay cannot recover the first.
    fiber.currentDispatcher.flush();
    return () => {
      active = false;
      fiber.interruptUnsafe();
    };
  };
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
    subscribe: subscribeChanges,
    on: (event, callback) => {
      let previous = current();
      return subscribeChanges((next) => {
        const prefsChanged = next.prefs !== previous.prefs;
        const dataDirChanged =
          next.dataDirOverride !== previous.dataDirOverride;
        previous = next;
        if (
          event === "changed"
            ? prefsChanged
            : event === "data-dir-changed"
              ? dataDirChanged
              : prefsChanged || dataDirChanged
        )
          callback();
      });
    },
  };
}
