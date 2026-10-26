// Writes immutable excerpt assets and verifies their bytes before exposing a link.
import {
  Cause,
  Effect,
  Exit,
  FileSystem,
  RcMap,
  Schema,
  Semaphore,
} from "effect";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, join, relative, isAbsolute, sep } from "node:path";

import { parseIndexedKey } from "@zotlit/db";

import { attachmentFolderPath } from "@/lib/attachment-folder";
import { withLogCategory } from "@/lib/effect-log";
import { joinFolderPath } from "@/lib/ensure-folder";
import type { FileManager } from "@/lib/obsidian-file-manager";
import { Vault } from "@/lib/obsidian-vault";
import type { Settings } from "@/services/settings/schema";

import { excerptKey, excerptSourceIdentities } from "./contract";
import type { ExcerptRequest } from "./contract";
import {
  EXCERPT_IMAGE_EXTENSIONS,
  detectExcerptImageFormat,
  isExcerptImage,
  isExcerptPayload,
} from "./format";
import { usableExcerptPng } from "./png";
import type { ExcerptOutcome } from "./service";
import { usableExcerptWebpPixels } from "./webp-pixels";

const logged = withLogCategory("excerpt-materialize");
const MAX_PREVIOUS_BYTES = 32 * 1024 * 1024;
const SHA256_HEX_LENGTH = 64;

/**
 * Whether bytes read back from outside this process still decode as the
 * container they claim.
 *
 * `format.ts` owns the payload check every reader shares; this is where the two
 * readers holding bytes that came from outside this process deepen it — the
 * vault read in {@link retainExcerpt}, and the publication of an outcome this
 * process did not encode. PNG must also inflate to the scanlines its header
 * declares (`png.ts`), and WebP must also decode to the pixels its container
 * declares (`webp-pixels.ts`). That depth stays here rather than in `format.ts`,
 * which the cache read bundles without a decoder for a check that runs before
 * every hit.
 */
const usableExternalAsset = (bytes: Uint8Array) =>
  Effect.promise(async () => {
    const format = detectExcerptImageFormat(bytes);
    if (!format || !isExcerptPayload(format, bytes)) return false;
    if (format.format === "webp") return usableExcerptWebpPixels(bytes);
    return usableExcerptPng(
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    );
  });

/**
 * An excerpt asset this process refuses to read or publish: too large, grown
 * while read, not the bytes its name claims, not registered, or for a target
 * that is no longer current. The caller logs it and keeps no link.
 */
export class ExcerptAssetRefused extends Schema.TaggedError<
  ExcerptAssetRefused,
  { readonly brand: unique symbol }
>()("ExcerptAssetRefused", { message: Schema.String }) {}

/**
 * A failure boundary: interrupts pass through, and any other cause is logged
 * by `log` and answered by `fallback`.
 */
export function recover<B>(
  log: (cause: Cause.Cause<unknown>) => Effect.Effect<void>,
  fallback: Effect.Effect<B>,
) {
  return <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A | B, never, R> =>
    Effect.catchCause(effect, (cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.andThen(log(cause), fallback),
    );
}

/** The file at `path`, refused past {@link MAX_PREVIOUS_BYTES} or when it grows while read. */
const readPreviousImage = (path: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const file = yield* (yield* FileSystem.FileSystem).open(path, {
        flag: "r",
      });
      const size = Number((yield* file.stat).size);
      if (size > MAX_PREVIOUS_BYTES)
        return yield* new ExcerptAssetRefused({
          message: "Previous excerpt exceeds byte limit",
        });
      const buffer = Buffer.alloc(size + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const bytesRead = yield* file.read(buffer.subarray(offset));
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset > size)
        return yield* new ExcerptAssetRefused({
          message: "Previous excerpt grew during verification",
        });
      return buffer.subarray(0, offset);
    }),
  );

/** Remove the file at `path`; a file that is already gone is no failure. */
const removeIgnoringAbsent = (path: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(path)).pipe(
    Effect.catchReason("PlatformError", "NotFound", () => Effect.void),
  );

/**
 * Admits one publication per destination at a time, across every preparation
 * that shares it, and holds it until cancellation cleanup or a successful
 * handoff.
 */
export type PublicationGate = (
  destination: string,
) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;

/** A {@link PublicationGate} for the life of the Scope. */
export const makePublicationGate = Effect.gen(function* () {
  const locks = yield* RcMap.make({
    lookup: (_destination: string) => Semaphore.make(1),
  });
  const gate: PublicationGate = (destination) => (effect) =>
    Effect.scoped(
      Effect.flatMap(RcMap.get(locks, destination), (lock) =>
        lock.withPermits(1)(effect),
      ),
    );
  return gate;
});

export type MaterializedExcerpt =
  | {
      kind: "saved";
      path: string;
      outcome: Extract<ExcerptOutcome, { kind: "available" }>;
    }
  | { kind: "retained"; path: string }
  | { kind: "unavailable"; reason: "disabled" | "source" | "write" };

/** Only referenced, vault-contained images with proven ownership can survive a failed refresh. */
export const retainExcerpt = Effect.fnUntraced(function* (options: {
  request: ExcerptRequest;
  paths: readonly string[];
}): Effect.fn.Return<
  Extract<MaterializedExcerpt, { kind: "retained" }> | undefined,
  never,
  FileSystem.FileSystem | Vault
> {
  const vault = yield* Vault;
  const fs = yield* FileSystem.FileSystem;
  const root = yield* vault.fullPath("");
  if (root === null) return;
  const identities = excerptAssetIdentities(options.request);
  for (const path of options.paths) {
    const full = (yield* vault.fullPath(path)) ?? path;
    const local = relative(root, full);
    if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`))
      continue;
    const name = basename(path);
    const owned = isOwnedExcerptAssetPath(path, identities);
    const legacy =
      name === `${parseIndexedKey(options.request.annotation.key)?.key}.png`;
    if (!owned && !legacy) continue;
    const verified = yield* Effect.gen(function* () {
      const actualPath = yield* fs.realPath(full);
      const actualRoot = yield* fs.realPath(root);
      const actualRelative = relative(actualRoot, actualPath);
      if (
        isAbsolute(actualRelative) ||
        actualRelative === ".." ||
        actualRelative.startsWith(`..${sep}`)
      )
        return false;
      const bytes = yield* readPreviousImage(actualPath);
      if (!(yield* usableExternalAsset(bytes))) return false;
      // Legacy names carry no source identity. The current source's bytes must prove ownership.
      const { zoteroPngPath } = options.request;
      if (
        !owned &&
        (!zoteroPngPath ||
          !bytes.equals(yield* readPreviousImage(zoteroPngPath)))
      )
        return false;
      return true;
    }).pipe(
      recover(
        (cause) =>
          Effect.logDebug("Previous excerpt could not be verified").pipe(
            Effect.annotateLogs({ path, cause }),
            logged,
          ),
        Effect.succeed(false),
      ),
    );
    if (verified) return { kind: "retained", path };
  }
});

/**
 * Every identity form this request's existing assets may carry, the current
 * form first, which is the one that names a new asset. A vault written before
 * the shared source identity holds each asset and link under the previous form,
 * so an ownership check has to accept both.
 */
export function excerptAssetIdentities(
  request: Pick<
    ExcerptRequest,
    "sourceScope" | "source" | "libraryID" | "attachmentKey"
  > & { annotation: { key: string } },
): string[] {
  return excerptSourceIdentities(request.source).map((sourceIdentity) =>
    createHash("sha256")
      .update(
        JSON.stringify([
          request.sourceScope,
          sourceIdentity,
          request.libraryID,
          request.attachmentKey,
          request.annotation.key,
        ]),
      )
      .digest("hex"),
  );
}

export function isOwnedExcerptAssetPath(
  path: string,
  identities: readonly string[],
): boolean {
  const name = basename(path);
  return identities.some((identity) => {
    const prefix = `zotlit-excerpt-${identity}-`;
    if (!name.startsWith(prefix)) return false;
    const digest = name.slice(prefix.length);
    const dot = digest.indexOf(".");
    return (
      dot === SHA256_HEX_LENGTH &&
      EXCERPT_IMAGE_EXTENSIONS.has(digest.slice(dot + 1))
    );
  });
}

/**
 * Publish an available outcome as the vault asset its content names, and add
 * it to the vault. Gives `unavailable` when attachment import is off, the
 * bytes are not the image they claim, or the write fails, also when `valid`
 * answers false between two steps. An interrupt passes through. An
 * interrupted or stale insertion takes back the bytes this call published.
 */
export const materializeExcerpt = Effect.fnUntraced(function* (options: {
  gate: PublicationGate;
  notePath: string;
  settings: Readonly<Settings>;
  request: ExcerptRequest;
  outcome: ExcerptOutcome;
  /** Whether the insertion target is still current. */
  valid?: Effect.Effect<boolean>;
}): Effect.fn.Return<
  MaterializedExcerpt,
  never,
  FileManager | FileSystem.FileSystem | Vault
> {
  const { request, outcome, settings } = options;
  if (!settings["attachment.import"])
    return { kind: "unavailable", reason: "disabled" };
  if (outcome.kind === "unavailable")
    return { kind: "unavailable", reason: "source" };
  // Bytes that disagree with their format must not become a vault asset whose
  // name and link claim the declared extension.
  if (!isExcerptImage(outcome)) {
    yield* Effect.logDebug("Excerpt payload does not match its format").pipe(
      Effect.annotateLogs({
        format: outcome.format.format,
        bytes: outcome.bytes.byteLength,
      }),
      logged,
    );
    return { kind: "unavailable", reason: "source" };
  }
  // A rendered outcome's bytes are this process's own encoder output; every
  // other outcome read them from outside it, where a persistent record can hold
  // a container whose image data is damaged. Those must decode before they
  // become an asset whose name and link claim that image.
  if (
    outcome.provenance !== "rendered" &&
    !(yield* usableExternalAsset(outcome.bytes))
  ) {
    yield* Effect.logDebug("Excerpt payload has no usable pixels").pipe(
      Effect.annotateLogs({
        provenance: outcome.provenance,
        format: outcome.format.format,
        bytes: outcome.bytes.byteLength,
      }),
      logged,
    );
    return { kind: "unavailable", reason: "source" };
  }
  const valid = options.valid ?? Effect.succeed(true);
  const assertCurrent = Effect.gen(function* () {
    if (!(yield* valid))
      return yield* new ExcerptAssetRefused({
        message: "Excerpt insertion target is no longer current",
      });
  });
  const vault = yield* Vault;
  const fs = yield* FileSystem.FileSystem;
  const cleanupFailed = (message: string) =>
    recover(
      (cause) =>
        Effect.logWarning(message).pipe(Effect.annotateLogs({ cause }), logged),
      Effect.void,
    );
  const publish = Effect.gen(function* () {
    yield* assertCurrent;
    const folder = yield* attachmentFolderPath(
      settings["attachment.folder-path"],
      options.notePath,
    );
    const digest = createHash("sha256")
      .update(excerptKey(request))
      .update(outcome.bytes)
      .digest("hex");
    const [identity] = excerptAssetIdentities(request);
    const path = joinFolderPath(
      folder,
      `zotlit-excerpt-${identity}-${digest}.${outcome.format.extension}`,
    );
    const destination = yield* vault.fullPath(path);
    if (destination === null)
      return yield* new ExcerptAssetRefused({
        message: "Excerpt import requires a filesystem vault",
      });
    // Set once this call creates the destination rather than adopting an
    // existing one, so a cancelled insertion can take back only its own bytes.
    let created = false;
    const write = Effect.gen(function* () {
      yield* assertCurrent;
      yield* fs.makeDirectory(dirname(destination), { recursive: true });
      // A dot-file name keeps the temporary out of the vault index: the vault
      // drops an indexed file only on a watcher event, which can be lost.
      const temporary = join(
        dirname(destination),
        `.${basename(destination)}.${randomUUID()}.tmp`,
      );
      // Publish only complete bytes, using an exclusive hard link to preserve every existing version.
      yield* Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          removeIgnoringAbsent(temporary).pipe(
            cleanupFailed("Excerpt temporary cleanup failed"),
          ),
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const file = yield* fs.open(temporary, { flag: "wx" });
            yield* file.writeAll(outcome.bytes);
            yield* file.sync;
          }),
        );
        yield* assertCurrent;
        // The link and its flag are one step: an interrupt between them would
        // keep bytes that no rollback knows this call created.
        yield* Effect.uninterruptible(
          fs.link(temporary, destination).pipe(
            Effect.andThen(
              Effect.sync(() => {
                created = true;
              }),
            ),
            Effect.catchReason(
              "PlatformError",
              "AlreadyExists",
              () => Effect.void,
            ),
          ),
        );
        const actual = yield* fs.readFile(destination);
        if (!Buffer.from(actual).equals(outcome.bytes))
          return yield* new ExcerptAssetRefused({
            message: "Excerpt destination does not match its content identity",
          });
        yield* assertCurrent;
      }).pipe(Effect.scoped);
      // The atomic filesystem publish precedes the vault's asynchronous watcher.
      // Register it now so the first rendered embed can resolve its TFile. A
      // failure keeps the content-addressed asset for another caller.
      yield* assertCurrent;
      yield* vault.reconcileFile(path);
      yield* assertCurrent;
      if (!(yield* vault.getFileByPath(path)))
        return yield* new ExcerptAssetRefused({
          message: "Published excerpt is not registered in the vault",
        });
      const saved: MaterializedExcerpt = { kind: "saved", path, outcome };
      return saved;
    });
    // A cancelled insertion keeps no excerpt, so the bytes this call
    // published are taken back with it. A destination this call adopted
    // instead, and a failure its caller survived, both keep their bytes.
    const takeBack = (exit: Exit.Exit<unknown, unknown>) =>
      Effect.gen(function* () {
        if (!created || !Exit.isFailure(exit)) return;
        // A rollback, not a failure boundary: any interrupt means the insert
        // did not happen, also when a failure came with it.
        // oxlint-disable-next-line zotlit-services/interrupt-predicate
        if (!Cause.hasInterrupts(exit.cause) && (yield* valid)) return;
        yield* removeIgnoringAbsent(destination).pipe(
          cleanupFailed("Excerpt rollback cleanup failed"),
        );
      });
    return yield* options.gate(destination)(
      write.pipe(Effect.onExit((exit) => takeBack(exit))),
    );
  });
  return yield* publish.pipe(
    recover(
      (cause) =>
        Effect.logDebug("Excerpt materialization failed").pipe(
          Effect.annotateLogs({ cause }),
          logged,
        ),
      Effect.succeed<MaterializedExcerpt>({
        kind: "unavailable",
        reason: "write",
      }),
    ),
  );
});
