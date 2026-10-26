/** Zotero preferences for settings, views, and legacy services. */
import { Effect, Stream } from "effect";
import type { ManagedRuntime } from "effect";

import { effectBridge } from "@/lib/effect-bridge";

import type { PrefValue } from "./prefs-file";
import { ZoteroPref } from "./service";
import type { ZoteroPrefSnapshot } from "./service";

export interface PlainZoteroPref extends Omit<
  ZoteroPrefSnapshot,
  "prefs" | "profileDirOverride"
> {
  get(name: string): PrefValue | undefined;
  setProfileDir(dir: string | null): void;
  setDataDir(dir: string | null): void;
  readonly changes: Stream.Stream<ZoteroPrefSnapshot>;
  readonly changed: Stream.Stream<void>;
}

export function plainZoteroPref(
  runtime: ManagedRuntime.ManagedRuntime<ZoteroPref, never>,
): PlainZoteroPref {
  // The bridge keeps the runtime's context, so the held service still answers
  // snapshot and file reads after disposal, and its closed guard makes setters
  // no-ops.
  const bridge = effectBridge(runtime);
  const pref = runtime.runSync(ZoteroPref.use(Effect.succeed));
  const current = () => bridge.runSync(pref.current);
  return {
    get state() {
      return current().state;
    },
    get resolvedProfileDir() {
      return current().resolvedProfileDir;
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
    get: (name) => bridge.runSync(pref.get(name)),
    setProfileDir: (dir) => bridge.runSync(pref.setProfileDir(dir)),
    setDataDir: (dir) => bridge.runSync(pref.setDataDir(dir)),
    changes: pref.changes,
    changed: pref.changes.pipe(
      Stream.changesWith((a, b) => a.prefs === b.prefs),
      Stream.drop(1),
      Stream.map(() => undefined),
    ),
  };
}
