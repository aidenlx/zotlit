import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import type { ManagedRuntime } from "effect";
import type { App } from "obsidian";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { ObsidianEnv } from "@/lib/obsidian-env";
import { FileManager, layerFileManagerFrom } from "@/lib/obsidian-file-manager";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { layerVaultFrom, Vault } from "@/lib/obsidian-vault";
import { Workspace } from "@/lib/obsidian-workspace";
import { LibraryScope } from "@/services/library-scope/service";
import { NoteIndex } from "@/services/note-index/service";
import { Profile } from "@/services/profile/service";
import { PluginSettings } from "@/services/settings/service";
import { Template } from "@/services/template/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import type { TemplateDataLoader } from "./data";
import { bindTemplateData } from "./data-handle";
import type { WorkbenchServices } from "./register";

/** The services a Profile fixture's runtime holds for the Workbench. */
export type FixtureServices =
  | Profile
  | Template
  | NoteIndex
  | PluginSettings
  | Vault
  | MetadataCache
  | Workspace
  | FileManager;

/** Node's file system, which the check command reads a draft through. */
const nodeFileSystem = Effect.runSync(
  Effect.scoped(Layer.build(NodeFileSystem.layer)),
);

/**
 * The Workbench's services: a stub for each, which throws on a member the
 * test leaves unread, under `overrides`, a later one over an earlier one.
 */
export function workbenchContext(
  ...overrides: readonly Context.Context<never>[]
): Context.Context<WorkbenchServices> {
  return Context.mergeAll(
    Context.make(
      ZoteroReads,
      stubService<ZoteroReads["Service"]>("ZoteroReads", {}),
    ),
    Context.make(NoteIndex, stubService<NoteIndex["Service"]>("NoteIndex", {})),
    Context.make(
      PluginSettings,
      stubService<PluginSettings["Service"]>("PluginSettings", {}),
    ),
    Context.make(Template, stubService<Template["Service"]>("Template", {})),
    Context.make(
      ZoteroPref,
      stubService<ZoteroPref["Service"]>("ZoteroPref", {}),
    ),
    Context.make(Vault, stubService<Vault["Service"]>("Vault", {})),
    Context.make(
      FileManager,
      stubService<FileManager["Service"]>("FileManager", {}),
    ),
    Context.make(Profile, stubService<Profile["Service"]>("Profile", {})),
    Context.make(
      MetadataCache,
      stubService<MetadataCache["Service"]>("MetadataCache", {}),
    ),
    Context.make(Workspace, stubService<Workspace["Service"]>("Workspace", {})),
    Context.make(
      ObsidianEnv,
      stubService<ObsidianEnv["Service"]>("ObsidianEnv", {}),
    ),
    nodeFileSystem,
    ...overrides,
  );
}

/**
 * The real Template, Profile, Note Index, settings and capability tags of a
 * Profile fixture's runtime.
 */
export function fixtureServices(
  runtime: ManagedRuntime.ManagedRuntime<FixtureServices, never>,
): Context.Context<FixtureServices> {
  return runtime.runSync(Effect.context<FixtureServices>());
}

/** The vault and the Zotero source an envelope names. */
export function workbenchIdentity(identity: {
  vaultName?: string;
  basePath?: string;
  apiVersion?: string;
  sourceId: string | null;
  databasePath: string;
  dataDir?: string;
  baseAttachmentPath?: string | null;
}): Context.Context<ObsidianEnv | ZoteroPref> {
  const { vaultName, basePath, apiVersion, ...pref } = identity;
  return Context.make(
    ObsidianEnv,
    stubService<ObsidianEnv["Service"]>("ObsidianEnv", {
      ...(vaultName === undefined ? {} : { vaultName }),
      ...(basePath === undefined ? {} : { basePath }),
      ...(apiVersion === undefined ? {} : { apiVersion }),
    }),
  ).pipe(
    Context.add(
      ZoteroPref,
      stubService<ZoteroPref["Service"]>("ZoteroPref", {
        current: Effect.succeed(
          stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", pref),
        ),
      }),
    ),
  );
}

/**
 * A Template data handle, as `build.ts` binds it, for a view or dialog test:
 * over `services`, and the Vault and FileManager tags over `app`'s members.
 * The tags close with `stack`.
 */
export function templateDataHandle(
  stack: AsyncDisposableStack,
  services: {
    readonly app: Pick<App, "vault" | "fileManager">;
    readonly zoteroReads: ZoteroReads["Service"];
    readonly template: Template["Service"];
    readonly settings: PluginSettings["Service"];
    readonly noteIndex: Pick<
      NoteIndex["Service"],
      "whenIndexed" | "getNotesByItemKey" | "getImportedNoteByNoteKey"
    >;
    readonly zoteroPref: Pick<
      ZoteroPrefSnapshot,
      "dataDir" | "baseAttachmentPath"
    >;
    readonly libraryScope?: LibraryScope["Service"];
  },
): TemplateDataLoader {
  const scope = Scope.makeUnsafe();
  stack.defer(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const vault = layerVaultFrom(services.app.vault);
  const capabilities = Effect.runSync(
    Layer.buildWithScope(
      Layer.merge(
        vault,
        layerFileManagerFrom(services.app.fileManager).pipe(
          Layer.provide(vault),
        ),
      ),
      scope,
    ),
  );
  return bindTemplateData(
    { runPromise: Effect.runPromise },
    Context.mergeAll(
      capabilities,
      Context.make(ZoteroReads, services.zoteroReads),
      Context.make(Template, services.template),
      Context.make(PluginSettings, services.settings),
      Context.make(
        NoteIndex,
        stubService<NoteIndex["Service"]>("NoteIndex", services.noteIndex),
      ),
      Context.make(
        ZoteroPref,
        stubService<ZoteroPref["Service"]>("ZoteroPref", {
          current: Effect.succeed(
            stubService<ZoteroPrefSnapshot>(
              "ZoteroPrefSnapshot",
              services.zoteroPref,
            ),
          ),
        }),
      ),
      Context.make(
        LibraryScope,
        services.libraryScope ??
          stubService<LibraryScope["Service"]>("LibraryScope", {}),
      ),
    ),
  );
}
