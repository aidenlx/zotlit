/** Zotero preferences for settings, views, and legacy services. */
import { Effect, Stream } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";
import { subscribe } from "@/lib/effect-stream";

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
  const current = () => runtime.runSync(pref.current);
  const subscribeChanges = (
    callback: (snapshot: ZoteroPrefSnapshot) => void,
  ) => {
    const seen = current();
    return subscribe(
      runtime,
      Stream.dropWhile(pref.changes, (next) => next === seen),
      callback,
    );
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
    get: (name) => runtime.runSync(pref.get(name)),
    setProfileDir: (dir) => runtime.runSync(pref.setProfileDir(dir)),
    setDataDir: (dir) => runtime.runSync(pref.setDataDir(dir)),
    companionInstalled: () => runtime.runPromise(pref.companionInstalled()),
    listProfiles: () => runtime.runPromise(pref.listProfiles()),
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
