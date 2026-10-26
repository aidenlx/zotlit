import { Cause, Effect, Exit } from "effect";
import type { ManagedRuntime, Stream } from "effect";

import { effectBridge } from "@/lib/effect-bridge";
import type { EffectBridge } from "@/lib/effect-bridge";

import { plainTemplateError } from "./errors";
import { TemplateMigration } from "./migration";
import type { LiteratureNoteTemplateMigrationResult } from "./migration";
import { Template } from "./service";
import type { TemplateOperations, TemplateStatus } from "./service";

/** The Template members views, legacy services and e2e still read. */
export type PlainTemplate = Omit<
  TemplateOperations,
  | "getUnrecognizedFiles"
  | "restoreCitationTemplate"
  | "deletePartial"
  | "setJavascriptTemplatesEnabled"
> & {
  readonly changes: Stream.Stream<TemplateStatus>;
  readonly "compile-status-changed": Stream.Stream<void>;
  readonly status: TemplateStatus;
};

/**
 * Runs `effect` on the bridge: the value, the failure's plain cause, or the
 * unload's `AbortError`.
 */
function plainRun<A>(
  bridge: Pick<EffectBridge, "runPromise">,
  effect: Effect.Effect<A, unknown>,
): Promise<A> {
  return bridge.runPromise(effect).catch((error: unknown) => {
    throw plainTemplateError(error);
  });
}

export function plainTemplate(
  runtime: ManagedRuntime.ManagedRuntime<Template, never>,
): PlainTemplate {
  const service = runtime.runSync(Template.use(Effect.succeed));
  // Unload stops a pending call, which then rejects with an `AbortError`; a
  // write the layer started still finishes its step.
  const bridge = effectBridge(runtime);
  const read = <A>(effect: Effect.Effect<A, unknown>): A => {
    const exit = bridge.runSync(Effect.exit(effect));
    if (Exit.isFailure(exit))
      throw plainTemplateError(Cause.squash(exit.cause));
    return exit.value;
  };
  const run = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
    plainRun(bridge, effect);
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
    getTemplateFileStatuses: () => read(service.getTemplateFileStatuses),
    getCitationTemplateStatus: () => read(service.getCitationTemplateStatus),
    materializeCitationTemplate: () => run(service.materializeCitationTemplate),
    getLiteratureNoteTemplate: (reference) =>
      read(service.getLiteratureNoteTemplate(reference)),
    prepareLiteratureNoteTemplateSource: (source) =>
      read(service.prepareLiteratureNoteTemplateSource(source)),
    renderProfileAnnotation: (data, options) =>
      read(service.renderProfileAnnotation(data, options)),
    getLiteratureNoteTemplateStatuses: () =>
      read(service.getLiteratureNoteTemplateStatuses),
    renderLiteratureNoteTemplateSource: (source, data) =>
      read(service.renderLiteratureNoteTemplateSource(source, data)),
    exportLiteratureNotePack: (reference, options) =>
      run(service.exportLiteratureNotePack(reference, options)),
    exportLiteratureNotePackSource: (source, options) =>
      run(service.exportLiteratureNotePackSource(source, options)),
    refresh: () => run(service.refresh),
    waitUntilSettled: (timeoutMs) => run(service.waitUntilSettled(timeoutMs)),
    get frontmatterFields() {
      return read(service.frontmatterFields);
    },
    getFrontmatterFieldStatus: () => read(service.getFrontmatterFieldStatus),
    evaluateFrontmatterFields: (fields, zt) =>
      read(service.evaluateFrontmatterFields(fields, zt)),
    render: (name, data) => read(service.render(name, data)),
    renderManagedContent: (data) => read(service.renderManagedContent(data)),
    renderCitation: (refs, variant) =>
      read(service.renderCitation(refs, variant)),
    renderCitationData: (data) => read(service.renderCitationData(data)),
    getPartialDocument: (name) => read(service.getPartialDocument(name)),
    getPartialNames: () => read(service.getPartialNames),
    getPartialDocuments: () => read(service.getPartialDocuments),
    getPartialEntries: () => read(service.getPartialEntries),
    planPartialUnpack: (bundled) => read(service.planPartialUnpack(bundled)),
    unpackPartials: (plan, options) =>
      run(service.unpackPartials(plan, options)),
    getReservedPartialFiles: () => read(service.getReservedPartialFiles),
    createPartial: (name, options) => run(service.createPartial(name, options)),
    renderPartialSource: (source, data, options) =>
      read(service.renderPartialSource(source, data, options)),
    renderCitationSource: (source, data) =>
      read(service.renderCitationSource(source, data)),
    renderFilename: (data) => read(service.renderFilename(data)),
    analyzeRootVariables: (name) => read(service.analyzeRootVariables(name)),
    getTemplateSource: (name) => run(service.getTemplateSource(name)),
    getLegacyLiteratureNoteTemplateFiles: () =>
      read(service.getLegacyLiteratureNoteTemplateFiles),
    getLegacyTemplateDocuments: () => read(service.getLegacyTemplateDocuments),
    convertLegacyTemplateDocuments: (refs) =>
      run(service.convertLegacyTemplateDocuments(refs)),
    convertLegacyLiteratureNoteTemplates: (data) =>
      run(service.convertLegacyLiteratureNoteTemplates(data)),
    validateFrontmatterExpr: (expr, language) =>
      read(service.validateFrontmatterExpr(expr, language)),
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
  const bridge = effectBridge(runtime);
  const execute = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
    plainRun(bridge, effect);
  return {
    whenSettled: () => execute(service.whenSettled),
    convert: () => execute(service.convert),
    retryCleanup: () => execute(service.retryCleanup),
  };
}
