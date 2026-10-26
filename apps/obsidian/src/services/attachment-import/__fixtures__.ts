// Attachment Import over a real file system and in-memory Obsidian tags, for the
// attachment-import suites and the suites of its consumers.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { join } from "node:path";

import { MemoryDeviceStorage } from "@/lib/__fixtures__/obsidian-device-storage";
import { layerTestObsidianEnv } from "@/lib/__fixtures__/obsidian-env";
import { MemoryFileManager } from "@/lib/__fixtures__/obsidian-file-manager";
import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import type { HostSources } from "@/lib/__fixtures__/obsidian-host-app";
import { MemoryVault } from "@/lib/__fixtures__/obsidian-vault";
import { defaults } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import type { Settings } from "@/services/settings/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";

import { AttachmentImport, layerAttachmentImport } from "./service";

/** Where Zotero keeps its files, as the Zotero Pref snapshot names them. */
export interface ZoteroLocation {
  readonly dataDir: string;
  readonly baseAttachmentPath: string | null;
}

/** A Zotero Pref snapshot of `location`, with a new prefs map. */
export function snapshotAt(location: ZoteroLocation): ZoteroPrefSnapshot {
  return {
    state: "ready",
    // A new map per snapshot: a moved location is a re-read of the prefs.
    prefs: new Map(),
    resolvedProfileDir: null,
    profileDirOverride: null,
    dataDirOverride: null,
    dataDir: location.dataDir,
    databasePath: join(location.dataDir, "zotero.sqlite"),
    sourceId: null,
    baseAttachmentPath: location.baseAttachmentPath,
    httpPort: null,
  };
}

/**
 * The real Attachment Import layer over the test's settings, Zotero Pref and
 * Obsidian sources, with the vault on disk at `basePath` and the Node file
 * system.
 */
export function layerAttachmentImportOver(options: {
  readonly settings: Pick<
    Settings,
    "attachment.import" | "attachment.folder-path"
  >;
  readonly pref: Pick<ZoteroPref["Service"], "current" | "changes">;
  readonly host: HostSources;
  readonly basePath: string;
}): Layer.Layer<AttachmentImport> {
  return layerAttachmentImport().pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(PluginSettings, {
          current: Effect.succeed({ ...defaults, ...options.settings }),
          changes: Stream.empty,
        }),
        Layer.mock(ZoteroPref, options.pref),
        layerHost(options.host),
        layerTestObsidianEnv({ basePath: options.basePath }),
        NodeFileSystem.layer,
      ),
    ),
  );
}

export interface AttachmentImportFixtureOptions extends ZoteroLocation {
  readonly importEnabled?: boolean;
  readonly folderPath?: string | null;
  /** The vault folder on disk; `/vault` by default. */
  readonly basePath?: string;
  /**
   * Obsidian's vault-scoped localStorage. One store stands for one vault on
   * one device: hand the same store to a second fixture to model a restart, a
   * fresh one to model another vault.
   */
  readonly storage?: MemoryDeviceStorage;
}

/**
 * Attachment Import built in the test's Scope. The vault holds an
 * `Attachments` folder; `moveZotero` changes Zotero's resolved location as a
 * profile re-read does.
 */
export const attachmentImportFixture = Effect.fn("attachmentImportFixture")(
  function* (options: AttachmentImportFixtureOptions) {
    const pref = yield* SubscriptionRef.make(snapshotAt(options));
    const storage = options.storage ?? new MemoryDeviceStorage();
    const vault = new MemoryVault();
    vault.addFolder("Attachments");
    const context = yield* Layer.build(
      layerAttachmentImportOver({
        settings: {
          "attachment.import": options.importEnabled ?? true,
          "attachment.folder-path":
            options.folderPath === undefined
              ? "Attachments"
              : options.folderPath,
        },
        pref: {
          current: SubscriptionRef.get(pref),
          changes: SubscriptionRef.changes(pref),
        },
        host: {
          deviceStorage: storage,
          vault,
          fileManager: new MemoryFileManager(),
        },
        basePath: options.basePath ?? "/vault",
      }),
    );
    return {
      service: Context.get(context, AttachmentImport),
      vault,
      storage,
      /**
       * Zotero's resolved location moves to `location`. With `announce` off the
       * prefs stay the same object, so no resolved-location change is emitted.
       */
      moveZotero: (location: ZoteroLocation, { announce = true } = {}) =>
        SubscriptionRef.update(pref, (before) => ({
          ...snapshotAt(location),
          prefs: announce ? new Map() : before.prefs,
        })),
    };
  },
);
