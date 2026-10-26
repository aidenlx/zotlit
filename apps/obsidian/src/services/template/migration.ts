import { Context, Deferred, Effect, Fiber, Layer, Scope } from "effect";
import { join } from "node:path/posix";
import type {
  FileManager,
  Vault,
  Workspace as ObsidianWorkspace,
} from "obsidian";

import type { CiteRef } from "@zotlit/db";
import {
  CONVERTED_DEFAULT_PROFILE_DOCUMENT,
  LegacyTemplateConversionError,
} from "@zotlit/templates/facade";

import { forkedBridge } from "@/lib/effect-bridge";
import { withLogCategory } from "@/lib/effect-log";
import { obsidianEvents } from "@/lib/effect-obsidian-events";
import { ObsidianApp } from "@/lib/obsidian-app";
import { Workspace } from "@/lib/obsidian-workspace";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";

import { templateFileFromPath } from "./defaults";
import type { MigrationVerificationData } from "./migration-data";
import { Template, templateFailure } from "./service";
import type {
  ConvertedLegacyProfileDocument,
  ConvertedLegacyTemplateDocuments,
  LegacyTemplateDocuments,
  TemplateFailure,
} from "./service";

interface MigrationSettings {
  current: Readonly<
    Pick<
      Settings,
      | "note.default-profile"
      | "note.template-conversion-pending"
      | "note.template-conversion-result"
      | "template.folder"
    >
  >;
  update(patch: Partial<Settings>): void;
  flush(): Promise<void>;
}

interface MigrationTemplateService {
  refresh(): Promise<void>;
  getLegacyLiteratureNoteTemplateFiles(): readonly string[];
  convertLegacyLiteratureNoteTemplates(data: {
    readonly note: object;
    readonly filename: object;
    readonly annotation?: object;
  }): Promise<Pick<ConvertedLegacyProfileDocument, "source" | "legacyFiles">>;
  getLegacyTemplateDocuments(): LegacyTemplateDocuments;
  convertLegacyTemplateDocuments(
    refs: readonly CiteRef[],
  ): Promise<ConvertedLegacyTemplateDocuments>;
}

interface MigrationApp {
  vault: Pick<Vault, "getFileByPath" | "create">;
  fileManager: Pick<FileManager, "trashFile">;
  workspace: Pick<ObsidianWorkspace, "onLayoutReady">;
}

interface MigrationEngineOptions {
  app: MigrationApp;
  settings: MigrationSettings;
  template: MigrationTemplateService;
  loadVerificationData: (options: {
    annotation: boolean;
  }) => Promise<MigrationVerificationData | null>;
  openPrompt: () => void | Promise<void>;
  defer: (action: "detect" | "prompt") => void;
  log: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    fields?: Record<string, unknown>,
  ) => void;
}

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

/** Owns the user-consented, one-shot transition from slot files to one document. */
class MigrationEngine {
  readonly #defer;
  readonly #log;
  readonly #app;
  readonly #settings;
  readonly #template;
  readonly #loadVerificationData;
  readonly #openPrompt;
  #stopped = false;

  constructor(options: MigrationEngineOptions) {
    this.#defer = options.defer;
    this.#log = options.log;
    this.#app = options.app;
    this.#settings = options.settings;
    this.#template = options.template;
    this.#loadVerificationData = options.loadVerificationData;
    this.#openPrompt = options.openPrompt;
  }

  async convert(): Promise<LiteratureNoteTemplateMigrationResult> {
    const settings = this.#settings.current;
    const slotFiles = this.#template.getLegacyLiteratureNoteTemplateFiles();
    const legacy = this.#template.getLegacyTemplateDocuments();
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
        ? join(settings["template.folder"], CONVERTED_DEFAULT_PROFILE_DOCUMENT)
        : null;
    const foldsAnnotation = slotFiles.some(
      (path) => templateFileFromPath(path)?.name === "annotation",
    );
    const data = await this.#loadVerificationData({
      annotation: foldsAnnotation,
    });
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

    // Every source is built and verified before the first write, so a refusal
    // anywhere below leaves the vault exactly as the user left it.
    // Each fold is caught on its own so a refusal names the files that fold
    // reads: the citation and partial files, or the Literature Note slots.
    let documents: { path: string; source: string }[];
    let legacyFiles: string[];
    let kept: readonly string[];
    try {
      const converted = await this.#template.convertLegacyTemplateDocuments(
        data.citation,
      );
      documents = [...converted.documents];
      legacyFiles = [...converted.trashed];
      kept = converted.kept;
    } catch (error) {
      if (error instanceof LegacyTemplateConversionError) {
        return refusedByConversion(error, [
          ...legacy.citation.map(({ path }) => path),
          ...legacy.partials.map(({ path }) => path),
        ]);
      }
      throw error;
    }
    if (profilePath) {
      try {
        const profile =
          await this.#template.convertLegacyLiteratureNoteTemplates({
            note: data.note,
            filename: data.filename,
            ...(data.annotation ? { annotation: data.annotation } : {}),
          });
        documents.unshift({ path: profilePath, source: profile.source });
        legacyFiles.push(...profile.legacyFiles);
      } catch (error) {
        if (error instanceof LegacyTemplateConversionError) {
          return refusedByConversion(error, slotFiles);
        }
        throw error;
      }
    }

    const occupied = documents.find(({ path }) =>
      this.#app.vault.getFileByPath(path),
    );
    if (occupied) {
      return refused(
        "converted-document-exists",
        `Converted document already exists at ${occupied.path}`,
        "Rename or remove that document, then retry conversion.",
      );
    }

    const created: string[] = [];
    try {
      for (const { path, source } of documents) {
        await this.#app.vault.create(path, source);
        created.push(path);
      }
    } catch (error) {
      // A half-written pass would block its own retry: the documents already
      // created occupy the paths the next run refuses on, and one of them is
      // the Profile document that stands the prompt down. Undo them, so the
      // vault is again what the user handed the pass.
      await this.#rollback(created);
      throw error;
    }
    this.#settings.update({ "note.template-conversion-pending": false });
    await this.#settings.flush();

    const { trashed, pendingCleanup } =
      await this.#trashLegacyFiles(legacyFiles);
    this.#settings.update({
      "note.template-conversion-result": {
        document: profilePath,
        trashed: trashed.length,
        pendingCleanup,
      },
    });
    await this.#settings.flush();
    this.#log("info", "Converted legacy templates", {
      documents: documents.map(({ path }) => path),
      trashed,
      pendingCleanup,
      kept,
    });
    return {
      outcome: "converted",
      document:
        profilePath === null ? null : CONVERTED_DEFAULT_PROFILE_DOCUMENT,
      trashed,
      pendingCleanup,
      kept,
    };
  }

  /**
   * Trash the legacy files a previous conversion could not move, from the
   * recorded `pendingCleanup`. A file that still resists stays on the list.
   * @throws when no conversion has completed: the Welcome view offers the
   * retry only beside a recorded result.
   */
  async retryCleanup(): Promise<
    Extract<LiteratureNoteTemplateMigrationResult, { outcome: "converted" }>
  > {
    const settings = this.#settings.current;
    const accepted = settings["note.template-conversion-result"];
    if (!accepted) {
      throw new Error("Cleanup retry needs a completed conversion");
    }
    const { trashed, pendingCleanup } = await this.#trashLegacyFiles(
      accepted.pendingCleanup,
    );
    this.#settings.update({
      "note.template-conversion-result": {
        ...accepted,
        trashed: accepted.trashed + trashed.length,
        pendingCleanup,
      },
    });
    await this.#settings.flush();
    return {
      outcome: "converted",
      document:
        accepted.document === null ? null : CONVERTED_DEFAULT_PROFILE_DOCUMENT,
      trashed,
      pendingCleanup,
      kept: [],
    };
  }

  /**
   * Move legacy files to trash once the converted documents are active. A
   * file that resists stays in place for a later retry: the conversion is
   * already accepted, so a cleanup fault never undoes it.
   */
  async #trashLegacyFiles(
    paths: readonly string[],
  ): Promise<{ trashed: string[]; pendingCleanup: string[] }> {
    const trashed: string[] = [];
    const pendingCleanup: string[] = [];
    for (const path of paths) {
      const file = this.#app.vault.getFileByPath(path);
      if (!file) continue;
      try {
        await this.#app.fileManager.trashFile(file);
        trashed.push(path);
      } catch (error) {
        pendingCleanup.push(path);
        this.#log("warn", "Failed to move a legacy template file to trash", {
          error,
          path,
        });
      }
    }
    return { trashed, pendingCleanup };
  }

  /** Trash the documents this pass created, newest first. A file that resists
   *  is logged rather than thrown: the original failure is the one to report. */
  async #rollback(paths: readonly string[]): Promise<void> {
    for (const path of paths.toReversed()) {
      const file = this.#app.vault.getFileByPath(path);
      if (!file) continue;
      try {
        await this.#app.fileManager.trashFile(file);
      } catch (error) {
        this.#log("error", "Failed to roll back a converted document", {
          error,
          path,
        });
      }
    }
  }

  close(): void {
    this.#stopped = true;
  }

  async layoutReady(action: "detect" | "prompt"): Promise<void> {
    if (this.#stopped) return;
    if (action === "prompt") {
      await this.#openPrompt();
      return;
    }
    await this.#template.refresh();
    await this.detectTemplates(true);
  }

  async detectTemplates(layoutReady: boolean): Promise<void> {
    if (this.#stopped) return;
    const settings = this.#settings.current;
    const legacy = this.#template.getLegacyTemplateDocuments();
    const hasLegacyFiles =
      this.#template.getLegacyLiteratureNoteTemplateFiles().length > 0 ||
      legacy.citation.length > 0 ||
      legacy.partials.length > 0;
    // A recorded result keeps deliberately retained legacy files from arming
    // another invitation.
    const converted =
      settings["note.template-conversion-result"] !== null ||
      this.#app.vault.getFileByPath(
        join(settings["template.folder"], CONVERTED_DEFAULT_PROFILE_DOCUMENT),
      ) !== null;
    const branch =
      !converted && !hasLegacyFiles && !layoutReady
        ? "deferred"
        : converted || !hasLegacyFiles
          ? "converted-or-none"
          : settings["note.template-conversion-pending"]
            ? "already-answered"
            : "newly-armed";
    this.#log("debug", "Template conversion detection", {
      phase: layoutReady ? "layout-ready" : "initial",
      foundLegacy: hasLegacyFiles,
      converted,
      branch,
    });
    if (branch === "deferred") {
      // The first scan can precede Obsidian's vault inventory. Keep startup
      // finite and preserve a saved pending flag until the layout-ready scan.
      this.#defer("detect");
      return;
    }
    if (branch === "converted-or-none") {
      if (settings["note.template-conversion-pending"]) {
        this.#settings.update({ "note.template-conversion-pending": false });
        await this.#settings.flush();
      }
      return;
    }
    if (branch === "already-answered") return;

    this.#settings.update({ "note.template-conversion-pending": true });
    await this.#settings.flush();
    if (layoutReady) {
      if (!this.#stopped) await this.#openPrompt();
    } else {
      this.#defer("prompt");
    }
  }
}

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
  openPrompt: MigrationEngineOptions["openPrompt"];
}

export class TemplateMigration extends Context.Service<
  TemplateMigration,
  {
    readonly whenSettled: Effect.Effect<void>;
    readonly convert: Effect.Effect<
      LiteratureNoteTemplateMigrationResult,
      TemplateFailure
    >;
    readonly retryCleanup: Effect.Effect<
      Extract<LiteratureNoteTemplateMigrationResult, { outcome: "converted" }>,
      TemplateFailure
    >;
  }
>()("zotlit/template/TemplateMigration") {}

export function layerTemplateMigration<R = never>(
  options: TemplateMigrationOptions<R>,
) {
  return Layer.effect(
    TemplateMigration,
    Effect.gen(function* () {
      const app = yield* ObsidianApp;
      const workspace = yield* Workspace;
      const settings = yield* PluginSettings;
      const template = yield* Template;
      const context = yield* Effect.context<R>();
      // Forked before `scope`: a close waits for a conversion already started.
      const bridge = yield* forkedBridge;
      const scope = yield* Scope.fork(yield* Scope.Scope);
      const run = Effect.runSyncWith(context);
      const runPromise = <A, E>(effect: Effect.Effect<A, E, R>) =>
        bridge.runPromise(Effect.provideContext(effect, context));
      const intake = yield* obsidianEvents<{
        detect: [];
        prompt: [];
        settled: [Deferred.Deferred<void>];
      }>();
      const engine = new MigrationEngine({
        ...options,
        loadVerificationData: (verification) =>
          runPromise(options.loadVerificationData(verification)),
        app,
        settings: {
          get current() {
            return run(settings.current);
          },
          update: (patch) => {
            run(settings.update(patch));
          },
          flush: () => runPromise(settings.flush),
        },
        template: {
          refresh: () => runPromise(template.refresh),
          getLegacyLiteratureNoteTemplateFiles: () =>
            run(template.getLegacyLiteratureNoteTemplateFiles),
          getLegacyTemplateDocuments: () =>
            run(template.getLegacyTemplateDocuments),
          convertLegacyLiteratureNoteTemplates: (data) =>
            runPromise(template.convertLegacyLiteratureNoteTemplates(data)),
          convertLegacyTemplateDocuments: (refs) =>
            runPromise(template.convertLegacyTemplateDocuments(refs)),
        },
        defer: (action) => {
          run(
            workspace.layoutReady.pipe(
              Effect.andThen(Effect.sync(() => intake.callback(action)())),
              Effect.forkIn(scope, { startImmediately: true }),
            ),
          );
        },
        log: (level, message, fields) => {
          const log = {
            debug: Effect.logDebug,
            info: Effect.logInfo,
            warn: Effect.logWarning,
            error: Effect.logError,
          }[level];
          run(
            log(message).pipe(
              Effect.annotateLogs(fields ?? {}),
              withLogCategory("template", "migration"),
            ),
          );
        },
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
          return attemptPromise(() => engine.layoutReady(event.type));
        })
        .pipe(Effect.forkScoped);
      yield* attemptPromise(() => engine.detectTemplates(false)).pipe(
        Effect.catchCause((cause) => report(cause)),
      );
      const owned = <A, E>(effect: Effect.Effect<A, E>) =>
        closed
          ? effect
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
          owned(
            attemptPromise(() => engine.convert()).pipe(Effect.uninterruptible),
          ),
        ).pipe(Effect.withSpan("TemplateMigration.convert")),
        retryCleanup: Effect.suspend(() =>
          owned(
            attemptPromise(() => engine.retryCleanup()).pipe(
              Effect.uninterruptible,
            ),
          ),
        ).pipe(Effect.withSpan("TemplateMigration.retryCleanup")),
      });
    }),
  );
}

function attemptPromise<A>(
  evaluate: () => Promise<A>,
): Effect.Effect<A, TemplateFailure> {
  return Effect.tryPromise({ try: evaluate, catch: templateFailure });
}
