import { basename, dirname, join } from "node:path/posix";
import { getFrontMatterInfo, parseYaml, stringifyYaml } from "obsidian";
import type { App } from "obsidian";
import * as v from "valibot";

import { citekeysToCiteTemplateData } from "@zotlit/db";
import { inlineCitation } from "@zotlit/templates";
import {
  CONVERTED_DEFAULT_PROFILE_DOCUMENT,
  parseLiteratureNoteTemplate,
  parsePlainTemplateDocument,
} from "@zotlit/templates/facade";
import { evalManagedFrontmatterEntries } from "@zotlit/templates/frontmatter";
import { mergeManagedFrontmatterEntries } from "@zotlit/templates/frontmatter-merge";

import { getLogger } from "@/lib/log";
import { defaults, schema } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";

import {
  classifyTemplateFolderFile,
  inTemplateFolder,
  partialPath,
  partialNameRefusal,
} from "./defaults";
import type { MigrationVerificationData } from "./migration";
import { TemplateService } from "./service";

const logger = getLogger(["template", "conversion-copy"]);

const settingsSchema = v.pick(schema, [
  "template.folder",
  "note.default-profile",
  "note.frontmatter-fields",
  "template.auto-trim-leading",
  "template.auto-trim-trailing",
]);
const diagnosticSchema = v.object({
  code: v.picklist([
    "originals-changed",
    "no-verification-item",
    "no-verification-annotation",
    "copy-missing",
    "copy-invalid",
    "copy-document-missing",
    "copy-loading",
    "baseline-changed",
    "managed-block-missing",
    "javascript-required",
    "evaluation-failed",
    "copied-inputs-changed",
    "input-language-occupied",
    "support-document-changed",
    "invalid-copy-output",
  ]),
  fields: v.optional(v.array(v.string())),
  detail: v.optional(v.string()),
});
export type ConversionRepairDiagnostic = v.InferOutput<typeof diagnosticSchema>;

/** Recovery codes stay stable while the native UI supplies localized guidance. */
export class ConversionRepairError extends Error {
  constructor(readonly diagnostic: ConversionRepairDiagnostic) {
    super(diagnostic.code);
  }
}

export function conversionRepairDiagnostic(
  error: unknown,
): ConversionRepairDiagnostic {
  return error instanceof ConversionRepairError
    ? error.diagnostic
    : { code: "evaluation-failed", detail: errorText(error) };
}

const rawSourceFields = { language: v.picklist(["liquid", "eta"]) };
const rawSourceSchema = v.variant("kind", [
  v.object({
    ...rawSourceFields,
    kind: v.literal("profile"),
    slot: v.picklist(["note", "content", "filename", "annotation"]),
  }),
  v.object({
    ...rawSourceFields,
    kind: v.literal("citation"),
    slot: v.picklist(["cite", "cite2"]),
  }),
  v.object({
    ...rawSourceFields,
    kind: v.literal("partial"),
    slot: v.string(),
  }),
]);
export type ConversionRawSource = v.InferOutput<typeof rawSourceSchema>;
const rawInputSchema = v.intersect([
  rawSourceSchema,
  v.object({ originalPath: v.string(), filename: v.string() }),
]);
export type ConversionRawInput = ConversionRawSource & {
  readonly originalPath: string;
  readonly path: string;
};
const copySchema = v.object({
  version: v.literal(1),
  itemKey: v.optional(v.string()),
  settings: settingsSchema,
  javascript: v.boolean(),
  originals: v.array(v.object({ path: v.string(), source: v.string() })),
  inputs: v.array(rawInputSchema),
  synthesizedInputs: v.nullable(v.string()),
  documents: v.array(v.string()),
  legacyFiles: v.array(v.string()),
  kept: v.array(v.string()),
  diagnostic: v.nullable(diagnosticSchema),
});
type CopyState = v.InferOutput<typeof copySchema>;

export type ConversionComparison = {
  readonly output:
    | "create"
    | "update"
    | "filename"
    | "annotation"
    | "main-citation"
    | "alternate-citation"
    | "frontmatter";
  readonly outcome:
    | "matching"
    | "changed"
    | "original-unavailable"
    | "candidate-failed";
  readonly original: string | null;
  readonly candidate: string | null;
  readonly error?: ConversionRepairDiagnostic;
};

export interface ConversionRepairReview {
  readonly copy: string;
  readonly itemKey?: string;
  readonly annotationKey?: string;
  readonly citation?: readonly string[];
  readonly comparisons: readonly ConversionComparison[];
  readonly valid: boolean;
  readonly requiresAcceptance: boolean;
  readonly diagnostic: ConversionRepairDiagnostic | null;
  readonly documents: readonly { path: string; source: string }[];
  readonly inputs?: readonly ConversionRawInput[];
  readonly kept?: readonly string[];
  readonly validatedPartials?: readonly string[];
}

export interface ConversionCopyEditorScope {
  readonly rawInput?: ConversionRawInput;
  readonly changeLanguage?: (language: "liquid" | "eta") => Promise<string>;
  readonly folder: string;
  readonly templates: TemplateService;
  readonly settings: Pick<SettingsService, "current" | "loaded" | "subscribe">;
}

/** Saved inactive sources and their isolated rendering contexts, owned by migration. */
export class ConversionCopy implements AsyncDisposable {
  readonly #app;
  readonly #state;
  readonly path: string;
  readonly folder: string;
  readonly #original: TemplateService;
  readonly #inputs: TemplateService;
  readonly #inputEditor: ConversionCopyEditorScope;
  readonly editor: ConversionCopyEditorScope;

  readonly #resources: AsyncDisposableStack;

  private constructor(
    app: App,
    path: string,
    options: {
      state: CopyState;
      original: TemplateService;
      inputs: ConversionCopyEditorScope;
      editor: ConversionCopyEditorScope;
      resources: AsyncDisposableStack;
    },
  ) {
    this.#app = app;
    this.path = path;
    this.folder = dirname(path);
    this.#state = options.state;
    this.#original = options.original;
    this.#inputEditor = options.inputs;
    this.#inputs = options.inputs.templates;
    this.editor = options.editor;
    this.#resources = options.resources;
  }

  static async #open(
    app: App,
    path: string,
    state: CopyState,
  ): Promise<ConversionCopy> {
    await using resources = new AsyncDisposableStack();
    const scope = (
      child: string,
      pending: boolean,
    ): ConversionCopyEditorScope => {
      const folder = join(dirname(path), child);
      const current: Readonly<Settings> = {
        ...defaults,
        ...state.settings,
        "template.folder": folder,
        "note.template-conversion-pending": pending,
      };
      const settings: ConversionCopyEditorScope["settings"] = {
        current,
        loaded: Promise.resolve(current),
        subscribe: (listener) => {
          listener(current);
          return () => {};
        },
      };
      const templates = resources.use(
        new TemplateService({
          app,
          settings,
          javascriptTemplatesEnabled: state.javascript,
        }),
      );
      return { folder, settings, templates };
    };
    const original = scope("originals", true).templates;
    const inputs = scope("inputs", true);
    const editor = scope("documents", false);
    await Promise.all([
      original.ready,
      inputs.templates.ready,
      editor.templates.ready,
    ]);
    return new ConversionCopy(app, path, {
      state,
      original,
      inputs,
      editor,
      resources: resources.move(),
    });
  }

  static async create(
    app: App,
    options: {
      settings: Readonly<Settings>;
      javascript: boolean;
      data: MigrationVerificationData | null;
    },
  ): Promise<ConversionCopy> {
    const { settings, javascript, data } = options;
    const originals = await captureConversionOriginals(
      app,
      settings["template.folder"],
    );
    const folder = join(
      settings["template.folder"],
      `conversion-copy-${crypto.randomUUID()}`,
    );
    const state: CopyState = {
      version: 1,
      itemKey: data?.itemKey,
      settings: v.parse(settingsSchema, settings),
      javascript,
      originals,
      inputs: originals.flatMap(({ path }) => {
        const input = rawInputFromPath(path);
        return input ? [input] : [];
      }),
      synthesizedInputs: null,
      documents: [],
      legacyFiles: [],
      kept: [],
      diagnostic: null,
    };
    const path = join(folder, "conversion.json");
    let copy: ConversionCopy | undefined;
    let createdFolder = false;
    try {
      await app.vault.createFolder(folder);
      createdFolder = true;
      for (const child of ["originals", "inputs", "documents"])
        await app.vault.createFolder(join(folder, child));
      for (const input of originals) {
        for (const child of ["originals", "inputs"])
          await app.vault.create(
            join(folder, child, basename(input.path)),
            input.source,
          );
        const kind = classifyTemplateFolderFile(input.path)?.kind;
        if (kind === "partial" || kind === "citation")
          await app.vault.create(
            join(folder, "documents", basename(input.path)),
            input.source,
          );
      }
      copy = await ConversionCopy.#open(app, path, state);
      await copy.#synthesize(data);
      if (state.diagnostic === null)
        state.synthesizedInputs = await copy.#inputFingerprint();
      await app.vault.create(path, JSON.stringify(state, null, 2));
      return copy;
    } catch (error) {
      await copy?.[Symbol.asyncDispose]();
      const root = app.vault.getFolderByPath(folder);
      if (createdFolder && root) await app.vault.delete(root, true);
      throw error;
    }
  }

  static async resume(app: App, path: string): Promise<ConversionCopy> {
    const file = app.vault.getFileByPath(path);
    if (!file) throw new ConversionRepairError({ code: "copy-missing" });
    if (!basename(dirname(path)).startsWith("conversion-copy-"))
      throw new ConversionRepairError({ code: "copy-invalid" });
    const state = v.parse(
      copySchema,
      JSON.parse(await app.vault.cachedRead(file)),
    );
    const legacyPaths = new Set<string>();
    const outputs = new Set<string>();
    for (const input of state.originals) {
      const kind = classifyTemplateFolderFile(input.path);
      if (kind?.kind === "legacy-slot")
        outputs.add(CONVERTED_DEFAULT_PROFILE_DOCUMENT);
      else if (kind?.kind === "legacy-citation")
        outputs.add("zotlit-citation.md");
      else if (kind?.kind === "legacy-partial")
        outputs.add(partialPath("", kind.name));
      else continue;
      legacyPaths.add(input.path);
    }
    if (
      state.documents.some(
        (name) => !outputs.has(name) && !isNewRepairDocument(name),
      )
    )
      throw new ConversionRepairError({ code: "copy-invalid" });
    if (
      [...state.legacyFiles, ...state.kept].some(
        (path) => !legacyPaths.has(path),
      )
    )
      throw new ConversionRepairError({ code: "copy-invalid" });
    if (
      state.diagnostic === null &&
      ([...outputs].some((name) => !state.documents.includes(name)) ||
        [...legacyPaths].some(
          (path) =>
            !state.legacyFiles.includes(path) && !state.kept.includes(path),
        ))
    )
      throw new ConversionRepairError({ code: "copy-invalid" });
    for (const input of state.inputs) {
      const original = state.originals.find(
        ({ path }) => path === input.originalPath,
      );
      const expected = original && rawInputFromPath(original.path);
      if (
        !expected ||
        expected.kind !== input.kind ||
        expected.slot !== input.slot ||
        input.filename !== `zotlit-${input.slot}.${input.language}.md`
      )
        throw new ConversionRepairError({ code: "copy-invalid" });
    }
    return ConversionCopy.#open(app, path, state);
  }

  get rawInputs(): readonly ConversionRawInput[] {
    return this.#state.inputs.map(({ filename, ...input }) => ({
      ...input,
      path: join(this.folder, "inputs", filename),
    }));
  }

  inputEditor(path: string): ConversionCopyEditorScope | null {
    const rawInput = this.rawInputs.find((input) => input.path === path);
    return rawInput
      ? {
          ...this.#inputEditor,
          rawInput,
          changeLanguage: (language) =>
            this.changeInputLanguage(path, language),
        }
      : inTemplateFolder(path, this.#inputEditor.folder) &&
          isNewRepairDocument(basename(path))
        ? this.#inputEditor
        : null;
  }

  async changeInputLanguage(
    path: string,
    language: "liquid" | "eta",
  ): Promise<string> {
    const input = this.#state.inputs.find(
      ({ filename }) => join(this.folder, "inputs", filename) === path,
    );
    const file = this.#app.vault.getFileByPath(path);
    if (!input || !file)
      throw new ConversionRepairError({ code: "copy-document-missing" });
    if (input.language === language) return path;
    const filename = `zotlit-${input.slot}.${language}.md`;
    const target = join(this.folder, "inputs", filename);
    if (this.#app.vault.getFileByPath(target))
      throw new ConversionRepairError({ code: "input-language-occupied" });
    const before = { ...input };
    await this.#app.vault.rename(file, target);
    Object.assign(input, { filename, language });
    try {
      await this.#save();
    } catch (error) {
      Object.assign(input, before);
      await this.#app.vault.rename(file, path);
      throw error;
    }
    await this.#inputs.refresh();
    logger.debug("Changed copied source language", {
      path: target,
      slot: input.slot,
      language,
    });
    return target;
  }

  async #save(): Promise<void> {
    const file = this.#app.vault.getFileByPath(this.path);
    if (!file) throw new ConversionRepairError({ code: "copy-missing" });
    await this.#app.vault.modify(file, JSON.stringify(this.#state, null, 2));
  }

  async #inputFingerprint(): Promise<string> {
    return JSON.stringify({
      inputs: this.#state.inputs.map(
        ({ originalPath, filename, kind, slot, language }) => ({
          originalPath,
          filename,
          kind,
          slot,
          language,
        }),
      ),
      sources: await captureConversionOriginals(
        this.#app,
        join(this.folder, "inputs"),
      ),
    });
  }

  get requiresAnnotation(): boolean {
    return this.#state.originals.some(
      ({ path }) =>
        classifyTemplateFolderFile(path)?.kind === "legacy-slot" &&
        basename(path).startsWith("zotlit-annotation."),
    );
  }
  get itemKey(): string | undefined {
    return this.#state.itemKey;
  }
  get profilePath(): string | null {
    return this.#state.documents.includes(CONVERTED_DEFAULT_PROFILE_DOCUMENT)
      ? join(this.editor.folder, CONVERTED_DEFAULT_PROFILE_DOCUMENT)
      : null;
  }
  get diagnostic(): ConversionRepairDiagnostic | null {
    return this.#state.diagnostic;
  }
  get originalSettings(): CopyState["settings"] {
    return this.#state.settings;
  }
  get legacyFiles(): readonly string[] {
    return this.#state.legacyFiles;
  }
  get kept(): readonly string[] {
    return this.#state.kept;
  }

  async originalsMatch(
    settings: Readonly<Settings>,
    javascript: boolean,
  ): Promise<boolean> {
    return (
      JSON.stringify(this.#state.settings) ===
        JSON.stringify(v.parse(settingsSchema, settings)) &&
      this.#state.javascript === javascript &&
      JSON.stringify(this.#state.originals) ===
        JSON.stringify(
          await captureConversionOriginals(
            this.#app,
            settings["template.folder"],
          ),
        )
    );
  }

  async fingerprint(): Promise<string> {
    return JSON.stringify(
      await Promise.all(
        ["originals", "inputs", "documents"].map((child) =>
          captureConversionOriginals(this.#app, join(this.folder, child)),
        ),
      ),
    );
  }

  /** Build a new baseline while preserving saved candidate edits by document name. */
  async refreshOriginals(
    settings: Readonly<Settings>,
    javascript: boolean,
    data: MigrationVerificationData | null,
  ): Promise<ConversionCopy> {
    const documents = await this.documentSnapshot();
    const inputsPending =
      documents.length > 0 &&
      this.#state.synthesizedInputs !== (await this.#inputFingerprint());
    const replacement = await ConversionCopy.create(this.#app, {
      settings,
      javascript,
      data,
    });
    try {
      for (const input of this.rawInputs) {
        const next = replacement.rawInputs.find(
          ({ originalPath }) => originalPath === input.originalPath,
        );
        if (!next) continue;
        const path = await replacement.changeInputLanguage(
          next.path,
          input.language,
        );
        const held = this.#app.vault.getFileByPath(input.path);
        const target = this.#app.vault.getFileByPath(path);
        if (held && target)
          await this.#app.vault.modify(
            target,
            await this.#app.vault.cachedRead(held),
          );
      }
      for (const input of await captureConversionOriginals(
        this.#app,
        this.#inputEditor.folder,
      )) {
        const name = basename(input.path);
        if (
          !isNewRepairDocument(name) ||
          this.#state.originals.some(({ path }) => basename(path) === name)
        )
          continue;
        const path = join(replacement.#inputEditor.folder, name);
        const file = this.#app.vault.getFileByPath(path);
        if (file) await this.#app.vault.modify(file, input.source);
        else await this.#app.vault.create(path, input.source);
      }
      if (data) await replacement.regenerate(data);
      for (const document of documents) {
        const name = basename(document.path);
        const path = join(replacement.editor.folder, name);
        const file = this.#app.vault.getFileByPath(path);
        if (file) await this.#app.vault.modify(file, document.source);
        else if (
          classifyTemplateFolderFile(name)?.kind === "partial" ||
          name === "zotlit-citation.md"
        )
          await this.#app.vault.create(path, document.source);
      }
      if (inputsPending) {
        replacement.#state.synthesizedInputs = null;
        await replacement.#save();
      }
      return replacement;
    } catch (error) {
      await replacement.discard();
      throw error;
    }
  }

  /** Explicitly rebuild the candidate body from saved copied slots, retaining repaired fields. */
  async regenerate(data: MigrationVerificationData): Promise<void> {
    await this.#inputs.refresh();
    const before = structuredClone(this.#state);
    const writes: { path: string; source: string; previous: string | null }[] =
      [];
    try {
      if (this.#state.inputs.some(({ kind }) => kind === "profile")) {
        let source =
          await this.#inputs.synthesizeLegacyLiteratureNoteTemplate();
        const path = join(
          this.editor.folder,
          CONVERTED_DEFAULT_PROFILE_DOCUMENT,
        );
        const held = this.#app.vault.getFileByPath(path);
        const previous = held ? await this.#app.vault.cachedRead(held) : null;
        if (previous !== null) {
          const fields =
            parseLiteratureNoteTemplate(previous).manifest.frontmatter;
          const info = getFrontMatterInfo(source);
          const manifest = parseYaml(info.frontmatter) as Record<
            string,
            unknown
          >;
          if (fields !== undefined) manifest.frontmatter = fields;
          else delete manifest.frontmatter;
          source = `---\n${stringifyYaml(manifest)}---\n${source.slice(info.contentStart)}`;
        }
        writes.push({ path, source, previous });
      }
      const converted = await this.#inputs.convertLegacyTemplateDocuments(
        data.citation,
      );
      for (const document of converted.documents) {
        const path = join(this.editor.folder, basename(document.path));
        const file = this.#app.vault.getFileByPath(path);
        writes.push({
          path,
          source: document.source,
          previous: file ? await this.#app.vault.cachedRead(file) : null,
        });
      }
      // Native operations on a copied raw source write canonical documents
      // beside that source. Explicit regeneration promotes them to the output set.
      for (const input of await captureConversionOriginals(
        this.#app,
        this.#inputEditor.folder,
      )) {
        const name = basename(input.path);
        if (!isNewRepairDocument(name)) continue;
        const original = this.#state.originals.find(
          ({ path }) => basename(path) === name,
        );
        if (original) {
          if (input.source !== original.source)
            throw new ConversionRepairError({
              code: "support-document-changed",
              detail: name,
            });
          continue;
        }
        const path = join(this.editor.folder, name);
        const planned = writes.find((write) => write.path === path);
        if (planned) planned.source = input.source;
        else {
          const file = this.#app.vault.getFileByPath(path);
          writes.push({
            path,
            source: input.source,
            previous: file ? await this.#app.vault.cachedRead(file) : null,
          });
        }
      }
      this.#state.diagnostic = null;
      this.#state.documents = [
        ...new Set([
          ...this.#state.documents,
          ...writes.map(({ path }) => basename(path)),
        ]),
      ];
      this.#state.legacyFiles = [
        ...new Set([
          ...this.#state.inputs
            .filter(({ kind }) => kind !== "citation")
            .map(({ originalPath }) => originalPath),
          ...converted.trashed.map((path) => this.#originalInputPath(path)),
        ]),
      ];
      this.#state.kept = converted.kept.map((path) =>
        this.#originalInputPath(path),
      );
      this.#state.synthesizedInputs = await this.#inputFingerprint();
    } catch (error) {
      Object.assign(this.#state, before);
      this.#state.diagnostic = conversionRepairDiagnostic(error);
      await this.#save();
      logger.debug("Copied source regeneration refused", {
        copy: this.path,
        code: this.#state.diagnostic.code,
      });
      return;
    }
    const completed: typeof writes = [];
    try {
      for (const write of writes) {
        const file = this.#app.vault.getFileByPath(write.path);
        if (file) await this.#app.vault.modify(file, write.source);
        else await this.#app.vault.create(write.path, write.source);
        completed.push(write);
      }
      await this.#save();
    } catch (error) {
      Object.assign(this.#state, before);
      for (const write of completed.toReversed()) {
        const file = this.#app.vault.getFileByPath(write.path);
        if (file && write.previous === null) await this.#app.vault.delete(file);
        else if (file) await this.#app.vault.modify(file, write.previous!);
      }
      throw error;
    }
    await this.editor.templates.refresh();
    logger.debug("Regenerated copied documents", {
      copy: this.path,
      documents: writes.map(({ path }) => path),
    });
  }

  #originalInputPath(path: string): string {
    return (
      this.#state.inputs.find(({ filename }) => filename === basename(path))
        ?.originalPath ??
      join(this.#state.settings["template.folder"], basename(path))
    );
  }

  /** Include new repair documents while keeping existing support documents unchanged. */
  async documentSnapshot(): Promise<
    readonly { path: string; source: string }[]
  > {
    const supports = new Map(
      this.#state.originals
        .filter(({ path }) => {
          const kind = classifyTemplateFolderFile(path)?.kind;
          return kind === "partial" || kind === "citation";
        })
        .map(({ path, source }) => [basename(path), source]),
    );
    const files = this.#app.vault
      .getMarkdownFiles()
      .filter(({ path }) => inTemplateFolder(path, this.editor.folder));
    const inventory = new Map(files.map((file) => [basename(file.path), file]));
    for (const name of [...this.#state.documents, ...supports.keys()]) {
      if (!inventory.has(name))
        throw new ConversionRepairError({
          code: "copy-document-missing",
          detail: name,
        });
    }
    const documents: { path: string; source: string }[] = [];
    const names = new Set([
      ...this.#state.documents,
      ...[...inventory.keys()].sort(),
    ]);
    for (const name of names) {
      const file = inventory.get(name)!;
      const source = await this.#app.vault.cachedRead(file);
      if (supports.has(name)) {
        if (source !== supports.get(name))
          throw new ConversionRepairError({
            code: "support-document-changed",
            detail: name,
          });
        continue;
      }
      if (
        !(
          isNewRepairDocument(name) ||
          (name === CONVERTED_DEFAULT_PROFILE_DOCUMENT &&
            this.#state.documents.includes(name))
        )
      ) {
        throw new ConversionRepairError({
          code: "invalid-copy-output",
          detail: name,
        });
      }
      documents.push({
        path: join(this.#state.settings["template.folder"], name),
        source,
      });
    }
    return documents;
  }

  async review(
    data: MigrationVerificationData,
  ): Promise<ConversionRepairReview> {
    if ((await this.editor.templates.waitUntilSettled(5000)) !== "settled")
      throw new ConversionRepairError({ code: "copy-loading" });
    const originals = await captureConversionOriginals(
      this.#app,
      join(this.folder, "originals"),
    );
    if (
      JSON.stringify(
        originals.map(({ path, source }) => ({ path: basename(path), source })),
      ) !==
      JSON.stringify(
        this.#state.originals.map(({ path, source }) => ({
          path: basename(path),
          source,
        })),
      )
    )
      throw new ConversionRepairError({ code: "baseline-changed" });
    let documents: readonly { path: string; source: string }[];
    try {
      documents = await this.documentSnapshot();
    } catch (error) {
      return {
        copy: this.path,
        inputs: this.rawInputs,
        comparisons: [],
        valid: false,
        requiresAcceptance: false,
        diagnostic: conversionRepairDiagnostic(error),
        documents: [],
        kept: this.kept,
      };
    }
    if (this.#state.synthesizedInputs !== (await this.#inputFingerprint()))
      return {
        copy: this.path,
        itemKey: data.itemKey ?? this.#state.itemKey,
        annotationKey: data.annotationKey,
        inputs: this.rawInputs,
        comparisons: [],
        valid: false,
        requiresAcceptance: false,
        diagnostic: this.#state.diagnostic ?? { code: "copied-inputs-changed" },
        documents,
      };
    const comparisons: ConversionComparison[] = [];
    const compare = (
      output: ConversionComparison["output"],
      original: () => unknown,
      candidate: () => unknown,
    ) => {
      let before: string | null = null;
      let after: string | null = null;
      let originalError: ConversionRepairDiagnostic | undefined;
      try {
        before = evidence(original());
      } catch (error) {
        originalError = conversionRepairDiagnostic(error);
      }
      try {
        after = evidence(candidate());
      } catch (error) {
        comparisons.push({
          output,
          outcome: "candidate-failed",
          original: before,
          candidate: null,
          error: conversionRepairDiagnostic(error),
        });
        return;
      }
      comparisons.push({
        output,
        outcome: originalError
          ? "original-unavailable"
          : before === after
            ? "matching"
            : "changed",
        original: before,
        candidate: after,
        ...(originalError ? { error: originalError } : {}),
      });
    };
    const profile = documents.find(
      ({ path }) => basename(path) === CONVERTED_DEFAULT_PROFILE_DOCUMENT,
    );
    let diagnostic = this.#state.diagnostic;
    const validatedPartials: string[] = [];
    for (const document of documents) {
      const kind = classifyTemplateFolderFile(document.path);
      if (kind?.kind !== "partial") continue;
      try {
        const parsed = parsePlainTemplateDocument(document.source);
        if (
          parsed.manifest.language === "eta" &&
          !this.editor.templates.javascriptTemplatesEnabled
        )
          throw new ConversionRepairError({
            code: "javascript-required",
            fields: [kind.name],
          });
        const error = this.editor.templates.compileErrors.get(kind.name);
        if (error) throw new Error(error.message);
        validatedPartials.push(kind.name);
      } catch (error) {
        diagnostic = conversionRepairDiagnostic(error);
      }
    }
    if (profile) {
      try {
        const candidate =
          this.editor.templates.prepareLiteratureNoteTemplateSource(
            profile.source,
            { rawFilename: true },
          );
        compare(
          "create",
          () => normalizeCreate(this.#original.render("note", data.note)),
          () => candidate.renderForCreate(data.note),
        );
        compare(
          "update",
          () => this.#original.render("content", data.note),
          () => {
            const result = candidate.renderForUpdate(data.note);
            if (result === null)
              throw new ConversionRepairError({
                code: "managed-block-missing",
              });
            return result;
          },
        );
        compare(
          "filename",
          () => this.#original.render("filename", data.filename),
          () => candidate.renderFilename(data.filename),
        );
        if (this.requiresAnnotation) {
          compare(
            "annotation",
            () => {
              if (!data.annotation)
                throw new ConversionRepairError({
                  code: "no-verification-annotation",
                });
              return this.#original.render("annotation", data.annotation);
            },
            () => {
              if (!data.annotation)
                throw new ConversionRepairError({
                  code: "no-verification-annotation",
                });
              return candidate.renderAnnotation(data.annotation);
            },
          );
        }
        compare(
          "frontmatter",
          () => {
            const result = this.#original.evaluateFrontmatterFields(
              this.#state.settings["note.frontmatter-fields"],
              data.note,
            );
            if (result.inertKeys.length || Object.keys(result.errors).length)
              throw new Error(
                JSON.stringify({
                  errors: result.errors,
                  inert: result.inertKeys,
                }),
              );
            return result.values;
          },
          () => {
            if (!candidate.frontmatter) return {};
            if (candidate.frontmatter.inertKeys.length)
              throw new ConversionRepairError({
                code: "javascript-required",
                fields: [...candidate.frontmatter.inertKeys],
              });
            const result = evalManagedFrontmatterEntries(
              candidate.frontmatter.compiled,
              data.note,
              Temporal.Now.instant(),
            );
            if (result.errors.length)
              throw new Error(
                result.errors
                  .map(({ key, error }) => `${key}: ${errorText(error)}`)
                  .join("\n"),
              );
            return mergeManagedFrontmatterEntries(result.values);
          },
        );
      } catch (error) {
        diagnostic = conversionRepairDiagnostic(error);
      }
    }
    if (documents.some(({ path }) => basename(path) === "zotlit-citation.md")) {
      for (const variant of ["main", "alt"] as const)
        compare(
          variant === "main" ? "main-citation" : "alternate-citation",
          () =>
            inlineCitation(
              this.#original.render(
                variant === "main" ? "cite" : "cite2",
                citekeysToCiteTemplateData(data.citation, variant),
              ),
            ),
          () => this.editor.templates.renderCitation(data.citation, variant),
        );
    }
    return {
      copy: this.path,
      inputs: this.rawInputs,
      kept: this.kept,
      validatedPartials,
      itemKey: data.itemKey,
      annotationKey: data.annotationKey,
      citation: data.citation.map(({ citationKey }) => citationKey ?? "—"),
      comparisons,
      valid:
        diagnostic === null &&
        documents.length > 0 &&
        comparisons.every(({ outcome }) => outcome !== "candidate-failed"),
      requiresAcceptance:
        comparisons.length === 0 ||
        comparisons.some(
          ({ outcome }) =>
            outcome === "changed" || outcome === "original-unavailable",
        ),
      diagnostic,
      documents,
    };
  }

  async discard(): Promise<void> {
    await this[Symbol.asyncDispose]();
    const folder = this.#app.vault.getFolderByPath(this.folder);
    if (folder) await this.#app.vault.delete(folder, true);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.#resources.disposeAsync();
  }

  async #synthesize(data: MigrationVerificationData | null): Promise<void> {
    const inputFiles = this.#inputs.getLegacyLiteratureNoteTemplateFiles();
    try {
      if (inputFiles.length) {
        const source =
          await this.#inputs.synthesizeLegacyLiteratureNoteTemplate();
        await this.#app.vault.create(
          join(this.editor.folder, CONVERTED_DEFAULT_PROFILE_DOCUMENT),
          source,
        );
        this.#state.documents.push(CONVERTED_DEFAULT_PROFILE_DOCUMENT);
        this.#state.legacyFiles.push(
          ...inputFiles.map((path) =>
            join(this.#state.settings["template.folder"], basename(path)),
          ),
        );
      }
      if (data) {
        const converted = await this.#inputs.convertLegacyTemplateDocuments(
          data.citation,
        );
        for (const document of converted.documents) {
          const name = basename(document.path);
          await this.#app.vault.create(
            join(this.editor.folder, name),
            document.source,
          );
          this.#state.documents.push(name);
        }
        this.#state.legacyFiles.push(
          ...converted.trashed.map((path) => this.#originalInputPath(path)),
        );
        this.#state.kept.push(
          ...converted.kept.map((path) => this.#originalInputPath(path)),
        );
      }
    } catch (error) {
      this.#state.diagnostic = conversionRepairDiagnostic(error);
    }
  }
}

function isNewRepairDocument(name: string): boolean {
  if (basename(name) !== name) return false;
  const kind = classifyTemplateFolderFile(name);
  return (
    kind?.kind === "citation" ||
    (kind?.kind === "partial" && partialNameRefusal(kind.name, []) === null)
  );
}

function rawInputFromPath(
  path: string,
): v.InferOutput<typeof rawInputSchema> | null {
  const input = classifyTemplateFolderFile(path);
  if (
    !input ||
    !(
      input.kind === "legacy-slot" ||
      input.kind === "legacy-citation" ||
      input.kind === "legacy-partial"
    )
  )
    return null;
  const common = {
    originalPath: path,
    filename: basename(path),
    language: input.language,
  };
  switch (input.kind) {
    case "legacy-slot":
      return { ...common, kind: "profile", slot: input.name };
    case "legacy-citation":
      return { ...common, kind: "citation", slot: input.name };
    case "legacy-partial":
      return { ...common, kind: "partial", slot: input.name };
  }
}

export async function captureConversionOriginals(
  app: App,
  folder: string,
): Promise<CopyState["originals"]> {
  return Promise.all(
    app.vault
      .getMarkdownFiles()
      .filter(
        ({ path }) =>
          inTemplateFolder(path, folder) &&
          classifyTemplateFolderFile(path) !== null,
      )
      .toSorted((a, b) => a.path.localeCompare(b.path))
      .map(async (file) => ({
        path: file.path,
        source: await app.vault.cachedRead(file),
      })),
  );
}
function evidence(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function normalizeCreate(body: string): string {
  const trimmed = body.trimEnd();
  return `${trimmed}${body.slice(trimmed.length).includes("\r\n") ? "\r\n" : "\n"}`;
}
