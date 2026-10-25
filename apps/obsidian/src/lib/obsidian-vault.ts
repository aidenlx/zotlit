// The vault as a capability tag: the file reads and writes ZotLit makes and
// the events it follows, without the Obsidian `App`. A rejected call fails
// with `VaultError` (`@/lib/vault-errors`); an expected outcome is a tagged
// error the tag decides from the vault cache first. It copies the shape of
// `MetadataCache`; policies/events.md (Capability tags) describes it.
import type {
  DataWriteOptions,
  TAbstractFile,
  TFile,
  TFolder,
  Vault as ObsidianVault,
} from "obsidian";

import { Context, Effect, Layer } from "@/lib/effect";
import type { Stream } from "@/lib/effect";
import { ObsidianApp } from "@/lib/obsidian-app";
import { obsidianEventSource } from "@/lib/obsidian-event-source";
import type { ObsidianEventEmitter } from "@/lib/obsidian-event-source";
import { FileExists, vaultError } from "@/lib/vault-errors";
import type { VaultError } from "@/lib/vault-errors";

/** One vault event, tagged with its Obsidian event name. */
export type VaultEvent =
  /** The file or folder was created. */
  | { readonly _tag: "create"; readonly file: TAbstractFile }
  /** The file's content changed. */
  | { readonly _tag: "modify"; readonly file: TAbstractFile }
  /** The file or folder moved from `oldPath` to its current path. */
  | {
      readonly _tag: "rename";
      readonly file: TAbstractFile;
      readonly oldPath: string;
    }
  /** The file or folder was deleted. */
  | { readonly _tag: "delete"; readonly file: TAbstractFile };

/** The Obsidian object the tag reads: what `app.vault` gives. */
export type VaultSource = Pick<
  ObsidianVault,
  | "read"
  | "cachedRead"
  | "process"
  | "create"
  | "trash"
  | "getFileByPath"
  | "getFolderByPath"
  | "getAbstractFileByPath"
> &
  ObsidianEventEmitter;

export interface VaultShape {
  /** The file's content, read from disk. */
  read(file: TFile): Effect.Effect<string, VaultError>;
  /** The file's content, from Obsidian's cache when it holds it. */
  cachedRead(file: TFile): Effect.Effect<string, VaultError>;
  /** Rewrite the file's content with `fn` in one step; the new content. */
  process(
    file: TFile,
    fn: (data: string) => string,
    options?: DataWriteOptions,
  ): Effect.Effect<string, VaultError>;
  /**
   * Create a file at `path` with `data`. Fails with `FileExists` when the
   * vault cache holds a file or folder at `path` (case-sensitive), without
   * calling Obsidian.
   */
  create(
    path: string,
    data: string,
    options?: DataWriteOptions,
  ): Effect.Effect<TFile, FileExists | VaultError>;
  /** Move the file to the system trash, or to the vault's `.trash` when `system` is false. */
  trash(file: TAbstractFile, system: boolean): Effect.Effect<void, VaultError>;
  /** The file at `path` now, `null` when there is none. */
  getFileByPath(path: string): Effect.Effect<TFile | null>;
  /** The folder at `path` in the vault cache (case-sensitive), `null` when there is none. */
  getFolderByPath(path: string): Effect.Effect<TFolder | null>;
  /** The file or folder at `path` in the vault cache (case-sensitive), `null` when there is none. */
  getAbstractFileByPath(path: string): Effect.Effect<TAbstractFile | null>;
  /** Each vault event, in Obsidian's order, from when the consumer's Stream starts. */
  readonly changes: Stream.Stream<VaultEvent>;
}

/** The vault. */
export class Vault extends Context.Service<Vault, VaultShape>()(
  "zotlit/obsidian/Vault",
) {}

/** Run one vault call; a rejection fails with {@link VaultError}. */
const call = <A>(
  operation: string,
  path: string,
  run: () => Promise<A>,
): Effect.Effect<A, VaultError> =>
  Effect.tryPromise({ try: run, catch: vaultError(operation, path) });

/** The vault service over `source`, for the life of the Scope. */
export const makeVault = Effect.fnUntraced(function* (source: VaultSource) {
  const events = yield* obsidianEventSource<VaultEvent>();
  yield* events.listen(source, "create", (file: TAbstractFile) => ({
    _tag: "create",
    file,
  }));
  yield* events.listen(source, "modify", (file: TAbstractFile) => ({
    _tag: "modify",
    file,
  }));
  yield* events.listen(
    source,
    "rename",
    (file: TAbstractFile, oldPath: string) => ({
      _tag: "rename",
      file,
      oldPath,
    }),
  );
  yield* events.listen(source, "delete", (file: TAbstractFile) => ({
    _tag: "delete",
    file,
  }));
  return Vault.of({
    read: (file) => call("read", file.path, () => source.read(file)),
    cachedRead: (file) =>
      call("cachedRead", file.path, () => source.cachedRead(file)),
    process: (file, fn, options) =>
      call("process", file.path, () => source.process(file, fn, options)),
    create: (path, data, options) =>
      Effect.suspend((): Effect.Effect<TFile, FileExists | VaultError> =>
        source.getAbstractFileByPath(path) === null
          ? call("create", path, () => source.create(path, data, options))
          : Effect.fail(new FileExists({ path })),
      ),
    trash: (file, system) =>
      call("trash", file.path, () => source.trash(file, system)),
    getFileByPath: (path) => Effect.sync(() => source.getFileByPath(path)),
    getFolderByPath: (path) => Effect.sync(() => source.getFolderByPath(path)),
    getAbstractFileByPath: (path) =>
      Effect.sync(() => source.getAbstractFileByPath(path)),
    changes: events.stream,
  });
});

/** The tag over any object of the vault's shape, such as a test host's. */
export const layerVaultFrom = (source: VaultSource): Layer.Layer<Vault> =>
  Layer.effect(Vault, makeVault(source));

/** The tag over the app's vault. */
export const layerVault: Layer.Layer<Vault, never, ObsidianApp> = Layer.effect(
  Vault,
  Effect.gen(function* () {
    const app = yield* ObsidianApp;
    return yield* makeVault(app.vault);
  }),
);
