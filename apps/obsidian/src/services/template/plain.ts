import { Cause, Effect, Exit } from "@/lib/effect";
import type { ManagedRuntime, Stream } from "@/lib/effect";

import { plainTemplateError } from "./errors";
import { TemplateMigration } from "./migration";
import type { LiteratureNoteTemplateMigrationResult } from "./migration";
import { Template } from "./service";
import type { TemplateOperations, TemplateStatus } from "./service";

export type PlainTemplate = TemplateOperations & {
  readonly changes: Stream.Stream<TemplateStatus>;
  readonly "compile-status-changed": Stream.Stream<void>;
  readonly status: TemplateStatus;
};

export function plainTemplate(
  runtime: ManagedRuntime.ManagedRuntime<Template, never>,
): PlainTemplate {
  const service = runtime.runSync(Template.use(Effect.succeed));
  // The layer owns pending operations. Retain its context for calls racing unload.
  const context = runtime.runSync(Effect.context<never>());
  const released = {
    runSync: Effect.runSyncWith(context),
    runPromiseExit: Effect.runPromiseExitWith(context),
  };
  const read = <A>(effect: Effect.Effect<A, unknown>): A => {
    const exit = released.runSync(Effect.exit(effect));
    if (Exit.isFailure(exit))
      throw plainTemplateError(Cause.squash(exit.cause));
    return exit.value;
  };
  const run = async <A>(effect: Effect.Effect<A, unknown>): Promise<A> => {
    const exit = await released.runPromiseExit(effect);
    if (Exit.isFailure(exit))
      throw plainTemplateError(Cause.squash(exit.cause));
    return exit.value;
  };
  return {
    get status() {
      return read(service.status);
    },
    get compileErrors() {
      return read(service.compileErrors);
    },
    getLoadedDocumentSource: (path) =>
      read(service.getLoadedDocumentSource(path)),
    get shadowedFiles() {
      return read(service.shadowedFiles);
    },
    get inertEtaFiles() {
      return read(service.inertEtaFiles);
    },
    get javascriptTemplatesEnabled() {
      return read(service.javascriptTemplatesEnabled);
    },
    get loaded() {
      return read(service.loaded);
    },
    getUnrecognizedFiles: () => read(service.getUnrecognizedFiles()),
    getTemplateFileStatuses: () => read(service.getTemplateFileStatuses()),
    getCitationTemplateStatus: () => read(service.getCitationTemplateStatus()),
    materializeCitationTemplate: () =>
      run(service.materializeCitationTemplate()),
    restoreCitationTemplate: () => run(service.restoreCitationTemplate()),
    getLiteratureNoteTemplate: (reference) =>
      read(service.getLiteratureNoteTemplate(reference)),
    prepareLiteratureNoteTemplateSource: (source) =>
      read(service.prepareLiteratureNoteTemplateSource(source)),
    renderProfileAnnotation: (data, options) =>
      read(service.renderProfileAnnotation(data, options)),
    getLiteratureNoteTemplateStatuses: () =>
      read(service.getLiteratureNoteTemplateStatuses()),
    renderLiteratureNoteTemplateSource: (source, data) =>
      read(service.renderLiteratureNoteTemplateSource(source, data)),
    exportLiteratureNotePack: (reference, options) =>
      run(service.exportLiteratureNotePack(reference, options)),
    exportLiteratureNotePackSource: (source, options) =>
      run(service.exportLiteratureNotePackSource(source, options)),
    refresh: () => run(service.refresh()),
    waitUntilSettled: (timeoutMs) => run(service.waitUntilSettled(timeoutMs)),
    get frontmatterFields() {
      return read(service.frontmatterFields);
    },
    getFrontmatterFieldStatus: () => read(service.getFrontmatterFieldStatus()),
    evaluateFrontmatterFields: (fields, zt) =>
      read(service.evaluateFrontmatterFields(fields, zt)),
    render: (name, data) => read(service.render(name, data)),
    renderManagedContent: (data) => read(service.renderManagedContent(data)),
    renderCitation: (refs, variant) =>
      read(service.renderCitation(refs, variant)),
    renderCitationData: (data) => read(service.renderCitationData(data)),
    getPartialDocument: (name) => read(service.getPartialDocument(name)),
    getPartialNames: () => read(service.getPartialNames()),
    getPartialDocuments: () => read(service.getPartialDocuments()),
    getPartialEntries: () => read(service.getPartialEntries()),
    planPartialUnpack: (bundled) => read(service.planPartialUnpack(bundled)),
    unpackPartials: (plan, options) =>
      run(service.unpackPartials(plan, options)),
    getReservedPartialFiles: () => read(service.getReservedPartialFiles()),
    createPartial: (name, options) => run(service.createPartial(name, options)),
    deletePartial: (name) => run(service.deletePartial(name)),
    renderPartialSource: (source, data, options) =>
      read(service.renderPartialSource(source, data, options)),
    renderCitationSource: (source, data) =>
      read(service.renderCitationSource(source, data)),
    renderFilename: (data) => read(service.renderFilename(data)),
    analyzeRootVariables: (name) => read(service.analyzeRootVariables(name)),
    getTemplateSource: (name) => run(service.getTemplateSource(name)),
    getLegacyLiteratureNoteTemplateFiles: () =>
      read(service.getLegacyLiteratureNoteTemplateFiles()),
    getLegacyTemplateDocuments: () =>
      read(service.getLegacyTemplateDocuments()),
    convertLegacyTemplateDocuments: (refs) =>
      run(service.convertLegacyTemplateDocuments(refs)),
    convertLegacyLiteratureNoteTemplates: (data) =>
      run(service.convertLegacyLiteratureNoteTemplates(data)),
    validateFrontmatterExpr: (expr, language) =>
      read(service.validateFrontmatterExpr(expr, language)),
    setJavascriptTemplatesEnabled: (enabled) =>
      run(service.setJavascriptTemplatesEnabled(enabled)),
    changes: service.changes,
    "compile-status-changed": service.compileEvents,
  };
}

export interface PlainTemplateMigration {
  whenSettled(): Promise<void>;
  convert(): Promise<LiteratureNoteTemplateMigrationResult>;
  retryCleanup(): Promise<
    Extract<LiteratureNoteTemplateMigrationResult, { outcome: "converted" }>
  >;
}

export function plainTemplateMigration(
  runtime: ManagedRuntime.ManagedRuntime<TemplateMigration, never>,
): PlainTemplateMigration {
  const service = runtime.runSync(TemplateMigration.use(Effect.succeed));
  const run = Effect.runPromiseExitWith(
    runtime.runSync(Effect.context<never>()),
  );
  const execute = async <A>(effect: Effect.Effect<A, unknown>): Promise<A> => {
    const exit = await run(effect);
    if (Exit.isFailure(exit))
      throw plainTemplateError(Cause.squash(exit.cause));
    return exit.value;
  };
  return {
    whenSettled: () => execute(service.whenSettled()),
    convert: () => execute(service.convert()),
    retryCleanup: () => execute(service.retryCleanup()),
  };
}
