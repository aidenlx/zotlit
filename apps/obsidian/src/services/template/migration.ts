import { Context, Deferred, Effect, Fiber, Layer, Scope } from "effect";
import { join } from "node:path/posix";

import { CONVERTED_DEFAULT_PROFILE_DOCUMENT } from "@zotlit/templates/facade";
import type { LegacyTemplateConversionError } from "@zotlit/templates/facade";

import { withLogCategory } from "@/lib/effect-log";
import { obsidianEvents } from "@/lib/effect-obsidian-events";
import { FileManager } from "@/lib/obsidian-file-manager";
import { Vault } from "@/lib/obsidian-vault";
import { Workspace } from "@/lib/obsidian-workspace";
import type {
  SettingsMutationError,
  SettingsPersistenceError,
} from "@/services/settings/service";
import { PluginSettings } from "@/services/settings/service";

import { templateFileFromPath } from "./defaults";
import type { MigrationVerificationData } from "./migration-data";
import { Template, templateFailure } from "./service";
import type { TemplateFailure } from "./service";

export type LiteratureNoteTemplateMigrationDiagnostic =
  | {
      code: "legacy-render-mismatch" | "unsupported-legacy-template";
      message: string;
      difference: string;
      hint: string;
      /** Legacy template files the user must edit before retrying. */
      files: readonly string[];
    }
  | {
      code: "legacy-frontmatter-inert" | "legacy-frontmatter-evaluation";
      message: string;
      difference: string;
      hint: string;
      fields: readonly string[];
    }
  | {
      code:
        | "no-verification-item"
        | "no-verification-annotation"
        | "converted-document-exists"
        | "no-legacy-templates";
      message: string;
      hint: string;
    };

export type LiteratureNoteTemplateMigrationResult =
  | {
      outcome: "converted";
      /** The converted Profile document, `null` when the vault held no
       *  Literature Note slots to fold into one. */
      document: string | null;
      trashed: readonly string[];
      /** Legacy files a failed trash left behind; retry from the Welcome view. */
      pendingCleanup: readonly string[];
      /** Legacy files left in place and reported: the Eta side of a
       *  mixed-language `cite` / `cite2` pair. */
      kept: readonly string[];
    }
  | {
      outcome: "refused";
      diagnostic: LiteratureNoteTemplateMigrationDiagnostic;
    };

/** Owns the user-consented, one-shot transition from slot files to documents. */
const makeMigrationEngine = Effect.fnUntraced(function* (options: {
  loadVerificationData: TemplateMigrationOptions["loadVerificationData"];
  openPrompt: TemplateMigrationOptions["openPrompt"];
  defer: (action: "detect" | "prompt") => Effect.Effect<void>;
}) {
  const vault = yield* Vault;
  const fileManager = yield* FileManager;
  const settings = yield* PluginSettings;
  const template = yield* Template;
  let stopped = false;
  const log = (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    fields?: Record<string, unknown>,
  ) =>
    ({
      debug: Effect.logDebug,
      info: Effect.logInfo,
      warn: Effect.logWarning,
      error: Effect.logError,
    })
      [level](message)
      .pipe(
        Effect.annotateLogs(fields ?? {}),
        withLogCategory("template", "migration"),
      );
  const openPrompt = Effect.tryPromise({
    try: async () => options.openPrompt(),
    catch: templateFailure,
  });
  const trashLegacyFiles = Effect.fn("TemplateMigration.trashLegacyFiles")(
    function* (paths: readonly string[]) {
      const trashed: string[] = [];
      const pendingCleanup: string[] = [];
      for (const path of paths) {
        const file = yield* vault.getFileByPath(path);
        if (!file) continue;
        yield* fileManager.trashFile(file).pipe(
          Effect.andThen(
            Effect.sync(() => {
              trashed.push(path);
            }),
          ),
          Effect.catchTag("VaultError", (error) =>
            Effect.gen(function* () {
              pendingCleanup.push(path);
              yield* log(
                "warn",
                "Failed to move a legacy template file to trash",
                { error, path },
              );
            }),
          ),
        );
      }
      return { trashed, pendingCleanup };
    },
  );
  const rollback = Effect.fn("TemplateMigration.rollback")(function* (
    paths: readonly string[],
  ) {
    for (const path of paths.toReversed()) {
      const file = yield* vault.getFileByPath(path);
      if (!file) continue;
      yield* fileManager.trashFile(file).pipe(
        Effect.catchTag("VaultError", (error) =>
          log("error", "Failed to roll back a converted document", {
            error,
            path,
          }),
        ),
      );
    }
  });
  const convert = Effect.gen(function* () {
    const snapshot = yield* settings.current;
    const slotFiles = yield* template.getLegacyLiteratureNoteTemplateFiles;
    const legacy = yield* template.getLegacyTemplateDocuments;
    if (
      slotFiles.length === 0 &&
      legacy.citation.length === 0 &&
      legacy.partials.length === 0
    ) {
      return refused(
        "no-legacy-templates",
        "No legacy template files were found",
        "Keep using the built-in templates.",
      );
    }
    const profilePath =
      slotFiles.length > 0
        ? join(snapshot["template.folder"], CONVERTED_DEFAULT_PROFILE_DOCUMENT)
        : null;
    const foldsAnnotation = slotFiles.some(
      (path) => templateFileFromPath(path)?.name === "annotation",
    );
    const data = yield* options
      .loadVerificationData({ annotation: foldsAnnotation })
      .pipe(Effect.mapError((error) => templateFailure(error)));
    if (!data || (legacy.citation.length > 0 && data.citation.length === 0)) {
      return refused(
        "no-verification-item",
        "No Zotero item is available for conversion verification",
        "Connect a Zotero database that contains an item, then retry conversion.",
      );
    }
    if (foldsAnnotation && !data.annotation) {
      return refused(
        "no-verification-annotation",
        "No Zotero annotation is available for conversion verification",
        "Add an annotation to a Zotero item, then retry conversion.",
      );
    }
    // Verify every fold before writing, so a refusal leaves the vault as it was.
    const converted = yield* template
      .convertLegacyTemplateDocuments(data.citation)
      .pipe(
        Effect.catchTag("LegacyTemplateConversionError", (error) =>
          Effect.succeed(
            refusedByConversion(error, [
              ...legacy.citation.map(({ path }) => path),
              ...legacy.partials.map(({ path }) => path),
            ]),
          ),
        ),
      );
    if ("outcome" in converted) return converted;
    const documents = [...converted.documents];
    const legacyFiles = [...converted.trashed];
    const kept = converted.kept;
    if (profilePath) {
      const profile = yield* template
        .convertLegacyLiteratureNoteTemplates({
          note: data.note,
          filename: data.filename,
          ...(data.annotation ? { annotation: data.annotation } : {}),
        })
        .pipe(
          Effect.catchTag("LegacyTemplateConversionError", (error) =>
            Effect.succeed(refusedByConversion(error, slotFiles)),
          ),
        );
      if ("outcome" in profile) return profile;
      documents.unshift({ path: profilePath, source: profile.source });
      legacyFiles.push(...profile.legacyFiles);
    }
    for (const { path } of documents) {
      if (yield* vault.getFileByPath(path)) {
        return refused(
          "converted-document-exists",
          `Converted document already exists at ${path}`,
          "Rename or remove that document, then retry conversion.",
        );
      }
    }
    const created: string[] = [];
    yield* Effect.gen(function* () {
      for (const { path, source } of documents) {
        yield* vault.create(path, source);
        created.push(path);
      }
    }).pipe(Effect.onError(() => rollback(created)));
    yield* settings.update({ "note.template-conversion-pending": false });
    yield* settings.flush;
    const { trashed, pendingCleanup } = yield* trashLegacyFiles(legacyFiles);
    yield* settings.update({
      "note.template-conversion-result": {
        document: profilePath,
        trashed: trashed.length,
        pendingCleanup,
      },
    });
    yield* settings.flush;
    yield* log("info", "Converted legacy templates", {
      documents: documents.map(({ path }) => path),
      trashed,
      pendingCleanup,
      kept,
    });
    return {
      outcome: "converted" as const,
      document:
        profilePath === null ? null : CONVERTED_DEFAULT_PROFILE_DOCUMENT,
      trashed,
      pendingCleanup,
      kept,
    };
  }).pipe(Effect.withSpan("TemplateMigration.core.convert"));
  const retryCleanup = Effect.gen(function* () {
    const snapshot = yield* settings.current;
    const accepted = snapshot["note.template-conversion-result"];
    if (!accepted)
      return yield* Effect.fail(
        templateFailure(
          new Error("Cleanup retry needs a completed conversion"),
        ),
      );
    const { trashed, pendingCleanup } = yield* trashLegacyFiles(
      accepted.pendingCleanup,
    );
    yield* settings.update({
      "note.template-conversion-result": {
        ...accepted,
        trashed: accepted.trashed + trashed.length,
        pendingCleanup,
      },
    });
    yield* settings.flush;
    return {
      outcome: "converted" as const,
      document:
        accepted.document === null ? null : CONVERTED_DEFAULT_PROFILE_DOCUMENT,
      trashed,
      pendingCleanup,
      kept: [],
    };
  }).pipe(Effect.withSpan("TemplateMigration.core.retryCleanup"));
  const detectTemplates = Effect.fn("TemplateMigration.detectTemplates")(
    function* (layoutReady: boolean) {
      if (stopped) return;
      const snapshot = yield* settings.current;
      const legacy = yield* template.getLegacyTemplateDocuments;
      const hasLegacyFiles =
        (yield* template.getLegacyLiteratureNoteTemplateFiles).length > 0 ||
        legacy.citation.length > 0 ||
        legacy.partials.length > 0;
      const converted =
        snapshot["note.template-conversion-result"] !== null ||
        (yield* vault.getFileByPath(
          join(snapshot["template.folder"], CONVERTED_DEFAULT_PROFILE_DOCUMENT),
        )) !== null;
      const branch =
        !converted && !hasLegacyFiles && !layoutReady
          ? "deferred"
          : converted || !hasLegacyFiles
            ? "converted-or-none"
            : snapshot["note.template-conversion-pending"]
              ? "already-answered"
              : "newly-armed";
      yield* log("debug", "Template conversion detection", {
        phase: layoutReady ? "layout-ready" : "initial",
        foundLegacy: hasLegacyFiles,
        converted,
        branch,
      });
      if (branch === "deferred") {
        yield* options.defer("detect");
        return;
      }
      if (branch === "converted-or-none") {
        if (snapshot["note.template-conversion-pending"]) {
          yield* settings.update({ "note.template-conversion-pending": false });
          yield* settings.flush;
        }
        return;
      }
      if (branch === "already-answered") return;
      yield* settings.update({ "note.template-conversion-pending": true });
      yield* settings.flush;
      if (layoutReady) {
        if (!stopped) yield* openPrompt;
      } else yield* options.defer("prompt");
    },
  );
  const layoutReady = Effect.fn("TemplateMigration.layoutReady")(function* (
    action: "detect" | "prompt",
  ) {
    if (stopped) return;
    if (action === "prompt") {
      yield* openPrompt;
      return;
    }
    yield* template.refresh;
    yield* detectTemplates(true);
  });
  return {
    convert,
    retryCleanup,
    detectTemplates,
    layoutReady,
    close: () => {
      stopped = true;
    },
  };
});

function refused(
  code: Extract<
    LiteratureNoteTemplateMigrationDiagnostic["code"],
    | "no-verification-item"
    | "no-verification-annotation"
    | "converted-document-exists"
    | "no-legacy-templates"
  >,
  message: string,
  hint: string,
): LiteratureNoteTemplateMigrationResult {
  return { outcome: "refused", diagnostic: { code, message, hint } };
}

/** Carry a failed verification out as the refusal the prompt reports. */
function refusedByConversion(
  error: LegacyTemplateConversionError,
  files: readonly string[],
): LiteratureNoteTemplateMigrationResult {
  const detail = {
    difference: error.difference,
    message: error.message,
    hint: error.recovery,
  };
  if (
    error.code === "legacy-frontmatter-inert" ||
    error.code === "legacy-frontmatter-evaluation"
  ) {
    return {
      outcome: "refused",
      diagnostic: { ...detail, code: error.code, fields: error.fields ?? [] },
    };
  }
  return {
    outcome: "refused",
    diagnostic: { ...detail, code: error.code, files },
  };
}

export interface TemplateMigrationOptions<R = never> {
  /** The real Zotero item a conversion verifies against, run by the layer. */
  loadVerificationData: (options: {
    annotation: boolean;
  }) => Effect.Effect<MigrationVerificationData | null, unknown, R>;
  openPrompt: () => void | Promise<void>;
}

export class TemplateMigration extends Context.Service<
  TemplateMigration,
  {
    readonly whenSettled: Effect.Effect<void>;
    readonly convert: Effect.Effect<
      LiteratureNoteTemplateMigrationResult,
      TemplateFailure | SettingsMutationError | SettingsPersistenceError
    >;
    readonly retryCleanup: Effect.Effect<
      Extract<LiteratureNoteTemplateMigrationResult, { outcome: "converted" }>,
      TemplateFailure | SettingsMutationError | SettingsPersistenceError
    >;
  }
>()("zotlit/template/TemplateMigration") {}

export function layerTemplateMigration<R = never>(
  options: TemplateMigrationOptions<R>,
) {
  return Layer.effect(
    TemplateMigration,
    Effect.gen(function* () {
      const workspace = yield* Workspace;
      const context = yield* Effect.context<R>();
      const scope = yield* Scope.fork(yield* Scope.Scope);
      const intake = yield* obsidianEvents<{
        detect: [];
        prompt: [];
        settled: [Deferred.Deferred<void>];
      }>();
      const engine = yield* makeMigrationEngine({
        ...options,
        loadVerificationData: (verification) =>
          Effect.provideContext(
            options.loadVerificationData(verification),
            context,
          ),
        defer: Effect.fnUntraced(function* (action) {
          yield* workspace.layoutReady.pipe(
            Effect.andThen(Effect.sync(() => intake.callback(action)())),
            Effect.forkIn(scope, { startImmediately: true }),
          );
        }),
      });
      const report = (cause: unknown) =>
        Effect.logWarning("Template conversion detection failed").pipe(
          Effect.annotateLogs({ cause }),
          withLogCategory("template", "migration"),
        );
      let closed = false;
      const waiters = new Set<Deferred.Deferred<void>>();
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          closed = true;
          for (const waiter of waiters)
            yield* Deferred.succeed(waiter, undefined);
        }),
      );
      yield* intake
        .consume((event) => {
          if (event.type === "settled") {
            waiters.delete(event.args[0]);
            return Deferred.succeed(event.args[0], undefined).pipe(
              Effect.asVoid,
            );
          }
          return engine.layoutReady(event.type);
        })
        .pipe(Effect.forkScoped);
      yield* engine
        .detectTemplates(false)
        .pipe(Effect.catchCause((cause) => report(cause)));
      const owned = <A, E>(effect: Effect.Effect<A, E>) =>
        closed
          ? Effect.interrupt
          : Effect.forkIn(effect, scope, {
              startImmediately: true,
              uninterruptible: true,
            }).pipe(Effect.flatMap((fiber) => Fiber.join(fiber)));
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          closed = true;
          engine.close();
        }),
      );
      return TemplateMigration.of({
        whenSettled: Effect.gen(function* () {
          if (closed) return;
          const waiter = yield* Deferred.make<void>();
          waiters.add(waiter);
          intake.callback("settled")(waiter);
          yield* Deferred.await(waiter);
        }).pipe(Effect.withSpan("TemplateMigration.whenSettled")),
        convert: Effect.suspend(() =>
          owned(engine.convert.pipe(Effect.uninterruptible)),
        ).pipe(Effect.withSpan("TemplateMigration.convert")),
        retryCleanup: Effect.suspend(() =>
          owned(engine.retryCleanup.pipe(Effect.uninterruptible)),
        ).pipe(Effect.withSpan("TemplateMigration.retryCleanup")),
      });
    }),
  );
}
