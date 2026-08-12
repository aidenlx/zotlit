// Compiles an Inlang project into typed wrappers and JSON Language Packs.

import mFunctionMatcherPlugin from "@inlang/plugin-m-function-matcher";
import messageFormatPlugin from "@inlang/plugin-message-format";
import { loadProjectFromDirectory, selectBundleNested } from "@inlang/sdk";
import type {
  BundleNested,
  Declaration,
  Expression,
  InlangPlugin,
  InlangProject,
  Match,
  Pattern,
} from "@inlang/sdk";
import fs from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  isLanguagePackFileName,
  isSupportedLanguagePackFormatter,
  parseNumericLiteral,
} from "./language-pack.js";
import type {
  Declaration as PackDeclaration,
  Expression as PackExpression,
  Match as PackMatch,
  Message as PackMessage,
} from "./language-pack.js";
import { validateLanguagePack } from "./validation.js";

export class LanguagePackCompilerError extends Error {
  readonly bundleId: string;
  readonly sourcePath: string | undefined;
  readonly sourceContents: string | undefined;

  constructor(
    bundleId: string,
    message: string,
    {
      sourcePath,
      sourceContents,
    }: {
      sourcePath?: string;
      sourceContents?: string;
    } = {},
  ) {
    super(message);
    this.bundleId = bundleId;
    this.sourcePath = sourcePath;
    this.sourceContents = sourceContents;
  }
}

export type CompileOptions = {
  root?: string;
  project?: string;
  output?: string;
  excludeMessagePrefixes?: readonly string[];
  /**
   * Key prefixes whose Messages become Target-Locale Messages: bundled as a
   * per-locale subset and rendered in the resolved target locale regardless of
   * which Language Pack is active.
   */
  targetLocaleMessagePrefixes?: readonly string[];
};

export type RawSourceCatalog = {
  locale: string;
  path: string;
  contents: string;
  /** Higher values override lower values, matching the plugin's file order. */
  mergePrecedence: number;
};

export type CompileProjectInput = {
  project: InlangProject;
  sourceCatalogs: readonly RawSourceCatalog[];
};

/** One locale's untranslated plugin messages, which fall back per message at runtime. */
export type UntranslatedMessages = {
  locale: string;
  sourcePath: string;
  sourcePaths: string[];
  bundleIds: string[];
};

/** One locale message dropped for using an input the base locale never declares. */
export type UndeclaredInputMessage = {
  locale: string;
  sourcePath: string;
  line: number;
  column: number;
  bundleId: string;
  inputs: string[];
};

/** Bundles no base-locale catalog defines, so no wrapper can be typed for them. */
export type MissingBaseMessages = {
  sourcePath: string;
  sourcePaths: string[];
  bundleIds: string[];
};

export type CompilerReports = {
  untranslated: UntranslatedMessages[];
  undeclaredInputs: UndeclaredInputMessage[];
  missingBaseLocale: MissingBaseMessages | undefined;
};

export type GeneratedArtifact = {
  fileName: string;
  contents: string;
};

export type GeneratedArtifacts = CompilerReports & {
  artifacts: GeneratedArtifact[];
  baseLocale: string;
  sourcePaths: string[];
  messageCount: number;
};

export type CompileResult = CompilerReports &
  Pick<CompilePaths, "projectPath" | "outputDirectory"> & {
    messageCount: number;
    sourcePaths: string[];
    /** {@link formatCompilerWarnings}'s report lines, ready for a caller's log sink. */
    warnings: string[];
    /** Every input a rebuild should watch: `settings.json` plus every discovered source catalog. */
    watchPaths: string[];
  };

export type CompilePaths = {
  root: string;
  projectPath: string;
  outputDirectory: string;
};

/**
 * Resolves the project and output locations a compile reads and writes.
 *
 * Callers that need the output directory before compiling — Vite's `config`
 * hook excludes it from the watcher — share these defaults instead of
 * restating them.
 */
export function resolveCompilePaths({
  root: configuredRoot,
  project = "project.inlang",
  output = "src/i18n/generated",
}: CompileOptions = {}): CompilePaths {
  const root = resolve(configuredRoot ?? process.cwd());
  return {
    root,
    projectPath: resolve(root, project),
    outputDirectory: resolve(root, output),
  };
}

/** A bundle the base locale defines, with the input contract read from it. */
type CompiledBundle = {
  bundle: BundleNested;
  inputs: { name: string; type: string }[];
};

type NestedMessage = BundleNested["messages"][number];

const INPUT_TYPE_FLOOR = "string | number";
const INPUT_TYPE_NUMBER = "number";
const INPUT_TYPE_DATE = "DatetimeInput";

const RESERVED_IDENTIFIERS = new Set([
  "arguments",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "eval",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

/**
 * The two Inlang plugins a project's `settings.json` normally declares as
 * `modules` and the SDK fetches from jsdelivr at load time. Supplying them
 * here keeps every compile hermetic — no network round trip, no dependency on
 * the CDN being reachable. A project whose `settings.json` still lists them
 * (e.g. for the Sherlock IDE extension) is unaffected: the SDK loads its own
 * fetched copies alongside these.
 */
export const INLANG_PLUGINS: InlangPlugin[] = [
  messageFormatPlugin,
  mFunctionMatcherPlugin,
];

export async function compile(
  options: CompileOptions = {},
): Promise<CompileResult> {
  const compilePaths = resolveCompilePaths(options);
  const { projectPath, outputDirectory } = compilePaths;
  const project = await loadProjectFromDirectory({
    path: projectPath,
    fs,
    providePlugins: INLANG_PLUGINS,
  }).catch(async (error: unknown) => {
    const sourceCatalogs =
      await readConfiguredSourceCatalogsForDiagnostics(projectPath);
    throw await positionedError(projectPath, error, {
      sourceCatalogs,
    });
  });

  try {
    const settings = await project.settings.get();
    const sourceCatalogs = await discoverSourceCatalogs(
      project,
      projectPath,
      settings,
    );
    const projectErrors = await project.errors.get();
    if (projectErrors.length > 0) {
      throw await positionedError(projectPath, projectErrors[0]!, {
        sourceCatalogs,
      });
    }

    const generated = await compileProject(
      { project, sourceCatalogs },
      {
        excludeMessagePrefixes: options.excludeMessagePrefixes,
        targetLocaleMessagePrefixes: options.targetLocaleMessagePrefixes,
      },
    );
    await writeOutput(generated, outputDirectory);
    return {
      messageCount: generated.messageCount,
      sourcePaths: generated.sourcePaths,
      untranslated: generated.untranslated,
      undeclaredInputs: generated.undeclaredInputs,
      missingBaseLocale: generated.missingBaseLocale,
      projectPath,
      outputDirectory,
      warnings: compilerWarningLines(generated),
      watchPaths: [
        join(projectPath, "settings.json"),
        ...generated.sourcePaths,
      ],
    };
  } finally {
    await project.close();
  }
}

export async function compileProject(
  { project, sourceCatalogs }: CompileProjectInput,
  {
    excludeMessagePrefixes = [],
    targetLocaleMessagePrefixes = [],
  }: Pick<
    CompileOptions,
    "excludeMessagePrefixes" | "targetLocaleMessagePrefixes"
  > = {},
): Promise<GeneratedArtifacts> {
  const isTargetLocaleMessage = (bundleId: string): boolean =>
    targetLocaleMessagePrefixes.some((prefix) => bundleId.startsWith(prefix));
  const settings = await project.settings.get();
  rejectMarkupSources(sourceCatalogs, excludeMessagePrefixes);
  const sourceIndex = indexSources(sourceCatalogs);
  const sourcePaths = sourceCatalogs.map((catalog) => catalog.path);
  const bundles = await selectBundleNested(project.db).execute();
  const selectedBundles = bundles
    .filter(
      (bundle) =>
        !excludeMessagePrefixes.some((prefix) => bundle.id.startsWith(prefix)),
    )
    .sort((left, right) => compareCodepoints(left.id, right.id));
  const compiled: CompiledBundle[] = [];
  const missingBaseLocale: string[] = [];
  for (const bundle of selectedBundles) {
    try {
      const entry = compileBundle(bundle, settings.baseLocale);
      if (entry === undefined) missingBaseLocale.push(bundle.id);
      else compiled.push(entry);
    } catch (error) {
      positionCompilerError(
        error,
        effectiveSource(sourceIndex, settings.baseLocale, bundle.id),
      );
    }
  }
  let facade: string;
  try {
    facade = generateFacade(compiled, isTargetLocaleMessage);
  } catch (error) {
    const bundleId =
      error instanceof LanguagePackCompilerError ? error.bundleId : undefined;
    positionCompilerError(
      error,
      effectiveSource(sourceIndex, settings.baseLocale, bundleId),
    );
  }
  const hasTargetLocaleMessages = targetLocaleMessagePrefixes.length > 0;
  const runtime = generateRuntime(settings.baseLocale, hasTargetLocaleMessages);
  const catalog = generateCatalog(settings.baseLocale, settings.locales);
  const undeclaredInputs: UndeclaredInputMessage[] = [];
  const messagesByLocale = new Map<string, Record<string, PackMessage>>();
  const packs = settings.locales.map((locale) => {
    try {
      const { messages, drift } = generatePack(compiled, {
        locale,
        baseLocale: settings.baseLocale,
        sourceLocationForMessage: (bundleId) =>
          sourceLocation(sourceIndex, locale, bundleId),
      });
      undeclaredInputs.push(...drift);
      messagesByLocale.set(locale, messages);
      const contents = serializePack(locale, messages);
      validateLanguagePack(contents, { expectedLocale: locale });
      return { fileName: `${locale}.json`, contents };
    } catch (error) {
      const bundleId =
        error instanceof LanguagePackCompilerError ? error.bundleId : undefined;
      positionCompilerError(
        error,
        effectiveSource(sourceIndex, locale, bundleId),
      );
    }
  });

  return {
    artifacts: [
      { fileName: "messages.ts", contents: facade },
      { fileName: "runtime.ts", contents: runtime },
      { fileName: "catalog.ts", contents: catalog },
      ...(hasTargetLocaleMessages
        ? [
            {
              fileName: TARGET_LOCALE_MESSAGES_FILE,
              contents: generateTargetLocaleMessages(messagesByLocale, {
                baseLocale: settings.baseLocale,
                isTargetLocaleMessage,
              }),
            },
          ]
        : []),
      ...packs,
    ],
    baseLocale: settings.baseLocale,
    sourcePaths,
    messageCount: compiled.length,
    untranslated: findUntranslatedMessages(compiled, settings, sourceIndex),
    undeclaredInputs,
    missingBaseLocale:
      missingBaseLocale.length === 0
        ? undefined
        : {
            sourcePath: effectiveSourcePath(sourceIndex, settings.baseLocale),
            sourcePaths: localeSourcePaths(sourceIndex, settings.baseLocale),
            bundleIds: missingBaseLocale,
          },
  };
}

/**
 * Locales whose catalog omits plugin messages the base locale defines. A pack
 * may be partial by design — the runtime falls back to the base locale per
 * message — so this is reported rather than rejected, letting translators see
 * what still needs a string.
 */
function findUntranslatedMessages(
  compiled: CompiledBundle[],
  { locales, baseLocale }: { locales: string[]; baseLocale: string },
  sources: SourceIndex,
): UntranslatedMessages[] {
  return locales
    .filter((locale) => locale !== baseLocale)
    .map((locale) => ({
      locale,
      sourcePath: effectiveSourcePath(sources, locale),
      sourcePaths: localeSourcePaths(sources, locale),
      bundleIds: compiled
        .filter(
          ({ bundle }) =>
            !bundle.messages.some((message) => message.locale === locale),
        )
        .map(({ bundle }) => bundle.id),
    }))
    .filter((report) => report.bundleIds.length > 0);
}

/** Renders every compiler report for a build log, or `undefined` when there is nothing to warn about. */
export function formatCompilerWarnings(
  reports: CompilerReports,
): string | undefined {
  const lines = compilerWarningLines(reports);
  return lines.length === 0 ? undefined : lines.join("\n");
}

/** The formatted report lines {@link formatCompilerWarnings} and {@link compile}'s `warnings` share. */
function compilerWarningLines({
  untranslated,
  undeclaredInputs,
  missingBaseLocale,
}: CompilerReports): string[] {
  return [
    ...untranslated.map(
      ({ sourcePath, bundleIds }) =>
        `${sourcePath}: ${bundleIds.length} untranslated message(s) fall back to the base locale: ${bundleIds.join(", ")}`,
    ),
    ...undeclaredInputs.map(
      ({ sourcePath, line, column, bundleId, inputs }) =>
        `${sourcePath}:${line}:${column}: "${bundleId}" uses input(s) the base locale does not declare (${inputs.join(", ")}); it is omitted from the pack and falls back to the base locale`,
    ),
    ...(missingBaseLocale === undefined
      ? []
      : [
          `${missingBaseLocale.sourcePath}: ${missingBaseLocale.bundleIds.length} message(s) absent from the base locale are omitted from the facade and every pack: ${missingBaseLocale.bundleIds.join(", ")}`,
        ]),
  ];
}

/**
 * Reads a bundle's input contract from its base-locale message, which alone
 * decides that a Message takes an input at all and what the input accepts.
 * A bundle the base locale never defines has no contract to read, so it is
 * dropped from every artifact rather than typed from a translation.
 */
function compileBundle(
  bundle: BundleNested,
  baseLocale: string,
): CompiledBundle | undefined {
  const baseMessage = bundle.messages.find(
    (message) => message.locale === baseLocale,
  );
  if (baseMessage === undefined) return undefined;

  assertUniqueDeclarations(bundle);
  const declarations = referencedDeclarations(bundle, baseMessage);
  const inputNames = new Set(
    declarations
      .filter((declaration) => declaration.type === "input-variable")
      .map((declaration) => declaration.name),
  );
  const types = inferInputTypes(declarations, baseMessage, inputNames);
  return {
    bundle,
    inputs: [...inputNames].map((name) => ({
      name,
      type: types.get(name) ?? INPUT_TYPE_FLOOR,
    })),
  };
}

/**
 * Declarations reach the compiler unioned across locales with only their name
 * to identify them, so two locales declaring one name differently leave the
 * bundle ambiguous — both survive the union, and both would land in every
 * pack. Rejecting says so instead of letting one locale's formatter silently
 * render another's message.
 */
function assertUniqueDeclarations(bundle: BundleNested): void {
  const seen = new Set<string>();
  for (const { name } of bundle.declarations) {
    if (seen.has(name)) {
      unsupported(bundle.id, `redeclared "${name}"`);
    }
    seen.add(name);
  }
}

/**
 * The declarations a single locale's message reaches, expanded through the
 * locals it references. The message-format plugin unions declarations across
 * every locale onto the bundle, so this is the only way back to what one
 * locale actually uses.
 */
function referencedDeclarations(
  bundle: BundleNested,
  message: NestedMessage,
): Declaration[] {
  const byName = new Map(
    bundle.declarations.map((declaration) => [declaration.name, declaration]),
  );
  const referenced = new Set<string>();
  const pending: string[] = message.selectors.map((selector) => selector.name);
  const pushExpression = (expression: Expression): void => {
    if (expression.arg.type === "variable-reference") {
      pending.push(expression.arg.name);
    }
    for (const option of expression.annotation?.options ?? []) {
      if (option.value.type === "variable-reference") {
        pending.push(option.value.name);
      }
    }
  };

  for (const variant of message.variants) {
    for (const match of variant.matches) pending.push(match.key);
    for (const element of variant.pattern) {
      if (element.type === "expression") pushExpression(element);
    }
  }
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (referenced.has(name)) continue;
    referenced.add(name);
    const declaration = byName.get(name);
    if (declaration?.type === "local-variable")
      pushExpression(declaration.value);
  }
  return bundle.declarations.filter((declaration) =>
    referenced.has(declaration.name),
  );
}

/**
 * Best-effort input types read from base-locale usage: a `plural` or `number`
 * argument and a selector whose every literal match is numeric are numbers, a
 * `datetime` argument takes a date, and an input used both ways keeps the floor.
 */
function inferInputTypes(
  declarations: Declaration[],
  message: NestedMessage,
  inputNames: Set<string>,
): Map<string, string> {
  const constraints = new Map<string, Set<string>>();
  const constrain = (name: string, type: string): void => {
    if (!inputNames.has(name)) return;
    const types = constraints.get(name) ?? new Set<string>();
    constraints.set(name, types.add(type));
  };

  for (const declaration of declarations) {
    if (declaration.type !== "local-variable") continue;
    const { arg, annotation } = declaration.value;
    if (annotation === undefined || arg.type !== "variable-reference") continue;
    if (annotation.name === "plural" || annotation.name === "number") {
      constrain(arg.name, INPUT_TYPE_NUMBER);
    } else if (annotation.name === "datetime") {
      constrain(arg.name, INPUT_TYPE_DATE);
    }
  }
  for (const selector of message.selectors) {
    const literals = message.variants.flatMap((variant) =>
      variant.matches
        .filter((match) => match.key === selector.name)
        .map((match) => (match.type === "literal-match" ? match.value : "")),
    );
    if (
      literals.some((value) => value !== "") &&
      literals.every(
        (value) => value === "" || parseNumericLiteral(value) !== undefined,
      )
    ) {
      constrain(selector.name, INPUT_TYPE_NUMBER);
    }
  }
  return new Map(
    [...constraints].map(([name, types]) => [
      name,
      types.size === 1 ? [...types][0]! : INPUT_TYPE_FLOOR,
    ]),
  );
}

function generateFacade(
  compiled: CompiledBundle[],
  isTargetLocaleMessage: (bundleId: string) => boolean,
): string {
  const used = new Set<string>();
  const wrappers = compiled.map(({ bundle, inputs }) => {
    assertIdentifier(bundle.id, bundle.id, "bundle ID");
    for (const input of inputs) {
      assertIdentifier(input.name, bundle.id, "input name");
    }
    const inputParameter =
      inputs.length === 0
        ? ""
        : `inputs: { ${inputs
            .map((input) => `${input.name}: ${input.type}`)
            .join("; ")} }`;
    const inputArgument = inputs.length === 0 ? "" : ", inputs";
    // A Target-Locale Message keeps its wrapper name and signature and only
    // changes which runtime path renders it, so adopting the feature is
    // configuration-only for every call site.
    const render = isTargetLocaleMessage(bundle.id)
      ? "translateTarget"
      : "translate";
    used.add(render);
    return `export const ${bundle.id} = (${inputParameter}): string => ${render}(${JSON.stringify(bundle.id)}${inputArgument});`;
  });
  const temporalImport = compiled.some(({ inputs }) =>
    inputs.some((input) => input.type === INPUT_TYPE_DATE),
  )
    ? ['import { type DatetimeInput } from "@zotlit/obsidian-i18n";', ""]
    : [];
  // A project with no Messages at all still imports `translate`, so an empty
  // facade keeps the shape every other one has.
  const renderers = ["translate", "translateTarget"].filter((name) =>
    used.size === 0 ? name === "translate" : used.has(name),
  );

  return [
    "// Generated by @zotlit/obsidian-i18n. Do not edit.",
    "",
    ...temporalImport,
    `import { ${renderers.join(", ")} } from "./runtime.js";`,
    "",
    ...wrappers,
    "",
  ].join("\n");
}

function generateRuntime(
  baseLocale: string,
  hasTargetLocaleMessages: boolean,
): string {
  const targetLocaleLines = hasTargetLocaleMessages
    ? {
        import: [
          `import { targetLocaleMessages } from "./${TARGET_LOCALE_MESSAGES_MODULE}";`,
        ],
        options: ", { targetLocaleMessages }",
        binding: [
          "export const translateTarget = runtime.translateTarget.bind(runtime);",
        ],
      }
    : { import: [], options: "", binding: [] };

  return [
    "// Generated by @zotlit/obsidian-i18n. Do not edit.",
    "",
    'import { createLanguagePackRuntime, type LanguagePack } from "@zotlit/obsidian-i18n";',
    `import basePackJson from "./${baseLocale}.json";`,
    ...targetLocaleLines.import,
    "",
    "const basePack = basePackJson as LanguagePack;",
    `export const runtime = createLanguagePackRuntime(basePack${targetLocaleLines.options});`,
    "export const translate = runtime.translate.bind(runtime);",
    ...targetLocaleLines.binding,
    "",
  ].join("\n");
}

const TARGET_LOCALE_MESSAGES_FILE = "target-locale-messages.ts";
const TARGET_LOCALE_MESSAGES_MODULE = "target-locale-messages.js";

/**
 * The prefix-matched Messages of every remote pack locale, bundled with the
 * plugin so lifecycle copy reads in the target language before — and without —
 * any pack download. The base locale is omitted: its subset would duplicate the
 * bundled base pack the target ladder already falls back to.
 */
function generateTargetLocaleMessages(
  messagesByLocale: ReadonlyMap<string, Record<string, PackMessage>>,
  {
    baseLocale,
    isTargetLocaleMessage,
  }: {
    baseLocale: string;
    isTargetLocaleMessage: (bundleId: string) => boolean;
  },
): string {
  const subsets = Object.fromEntries(
    [...messagesByLocale.keys()]
      .filter((locale) => locale !== baseLocale)
      .sort(compareCodepoints)
      .map((locale) => [
        locale,
        Object.fromEntries(
          Object.entries(messagesByLocale.get(locale)!).filter(([bundleId]) =>
            isTargetLocaleMessage(bundleId),
          ),
        ),
      ]),
  );

  return [
    "// Generated by @zotlit/obsidian-i18n. Do not edit.",
    "",
    'import { type TargetLocaleMessages } from "@zotlit/obsidian-i18n";',
    "",
    `export const targetLocaleMessages: TargetLocaleMessages = ${JSON.stringify(subsets, null, 2)};`,
    "",
  ].join("\n");
}

/**
 * Locales the consuming app downloads as remote Language Packs: every
 * configured locale except the base, which ships bundled instead. Sorted by
 * codepoint so the emitted `catalog.ts` is byte-deterministic across compiles.
 */
function remoteLanguagePacks(
  baseLocale: string,
  locales: readonly string[],
): string[] {
  return locales
    .filter((locale) => locale !== baseLocale)
    .sort(compareCodepoints);
}

function generateCatalog(
  baseLocale: string,
  locales: readonly string[],
): string {
  const packEntries = remoteLanguagePacks(baseLocale, locales).map(
    (locale) =>
      `    ${JSON.stringify(locale)}: { fileName: ${JSON.stringify(`${locale}.json`)} },`,
  );

  return [
    "// Generated by @zotlit/obsidian-i18n. Do not edit.",
    "",
    "export const catalog = {",
    `  baseLocale: ${JSON.stringify(baseLocale)},`,
    "  packs: {",
    ...packEntries,
    "  },",
    "} as const;",
    "",
  ].join("\n");
}

/** One locale's messages, plus the ones dropped for drifting from the base input contract. */
type GeneratedPack = {
  messages: Record<string, PackMessage>;
  drift: UndeclaredInputMessage[];
};

type GeneratePackOptions = {
  locale: string;
  baseLocale: string;
  sourceLocationForMessage: (bundleId: string) => {
    sourcePath: string;
    line: number;
    column: number;
  };
};

function generatePack(
  compiled: CompiledBundle[],
  { locale, baseLocale, sourceLocationForMessage }: GeneratePackOptions,
): GeneratedPack {
  const messages: Record<string, PackMessage> = {};
  const drift: UndeclaredInputMessage[] = [];
  for (const { bundle, inputs } of compiled) {
    const message = bundle.messages.find(
      (candidate) => candidate.locale === locale,
    );
    if (message === undefined) continue;
    const declarations = referencedDeclarations(bundle, message);
    const undeclared = declarations
      .filter(
        (declaration) =>
          declaration.type === "input-variable" &&
          !inputs.some((input) => input.name === declaration.name),
      )
      .map((declaration) => declaration.name);
    if (locale !== baseLocale && undeclared.length > 0) {
      drift.push({
        locale,
        ...sourceLocationForMessage(bundle.id),
        bundleId: bundle.id,
        inputs: undeclared,
      });
      continue;
    }
    messages[bundle.id] = normalizeMessage(bundle.id, message, declarations);
  }
  return { messages, drift };
}

/**
 * No pretty-printing: packs ship as artifacts under a serialized-byte cap.
 *
 * @see {@link LANGUAGE_PACK_LIMITS}
 */
function serializePack(
  locale: string,
  messages: Record<string, PackMessage>,
): string {
  return `${JSON.stringify({ schemaVersion: 1, locale, messages })}\n`;
}

function normalizeMessage(
  bundleId: string,
  message: NestedMessage,
  declarations: Declaration[],
): PackMessage {
  if (
    declarations.length === 0 &&
    message.selectors.length === 0 &&
    message.variants.length === 1 &&
    message.variants[0]!.matches.length === 0 &&
    message.variants[0]!.pattern.length === 1 &&
    message.variants[0]!.pattern[0]!.type === "text"
  ) {
    return message.variants[0]!.pattern[0]!.value;
  }

  return {
    declarations: declarations.map((declaration) =>
      normalizeDeclaration(declaration, bundleId),
    ),
    variants: message.variants.map((variant) => ({
      matches: variant.matches.map((match) => normalizeMatch(match, bundleId)),
      pattern: normalizePattern(variant.pattern, bundleId),
    })),
  };
}

function normalizeDeclaration(
  declaration: Declaration,
  bundleId: string,
): PackDeclaration {
  if (declaration.type === "input-variable") {
    if (declaration.annotation !== undefined) {
      unsupported(bundleId, `input formatter "${declaration.annotation.name}"`);
    }
    return { type: "input", name: declaration.name };
  }
  if (declaration.type === "local-variable") {
    return {
      type: "local",
      name: declaration.name,
      value: normalizeExpression(declaration.value, bundleId),
    };
  }
  return unsupported(
    bundleId,
    `declaration "${(declaration as { type?: string }).type ?? "unknown"}"`,
  );
}

function normalizePattern(
  pattern: Pattern,
  bundleId: string,
): PackExpression[] {
  return pattern.map((element) => {
    if (element.type === "text") {
      return { type: "text", value: element.value };
    }
    if (element.type === "expression") {
      return normalizeExpression(element, bundleId);
    }
    return unsupported(bundleId, element.type);
  });
}

function normalizeExpression(
  expression: Expression,
  bundleId: string,
): PackExpression {
  const argument =
    expression.arg.type === "variable-reference"
      ? ({ type: "variable", name: expression.arg.name } as const)
      : expression.arg.type === "literal"
        ? ({ type: "literal", value: expression.arg.value } as const)
        : unsupported(
            bundleId,
            `expression "${(expression.arg as { type?: string }).type ?? "unknown"}"`,
          );

  if (expression.annotation === undefined) return argument;
  if (!isSupportedLanguagePackFormatter(expression.annotation.name)) {
    return unsupported(bundleId, `formatter "${expression.annotation.name}"`);
  }

  const options = Object.fromEntries(
    [...expression.annotation.options]
      .sort((left, right) => compareCodepoints(left.name, right.name))
      .map((option) => [
        option.name,
        option.value.type === "variable-reference"
          ? { type: "variable", name: option.value.name }
          : { type: "literal", value: option.value.value },
      ]),
  ) as Record<string, PackExpression>;
  return {
    type: "formatter",
    name: expression.annotation.name,
    argument,
    options,
  };
}

function normalizeMatch(match: Match, bundleId: string): PackMatch {
  if (match.type === "literal-match") {
    return {
      type: "literal",
      key: match.key,
      value: match.value,
    };
  }
  if (match.type === "catchall-match") {
    return { type: "catchall", key: match.key };
  }
  return unsupported(
    bundleId,
    `match "${(match as { type?: string }).type ?? "unknown"}"`,
  );
}

/** Codepoint-order comparator: byte-deterministic across ICU versions/locales, unlike localeCompare. */
function compareCodepoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Guards the facade against names that would emit uncompilable TypeScript. */
function assertIdentifier(
  name: string,
  bundleId: string,
  kind: "bundle ID" | "input name",
): void {
  if (/^[$A-Z_a-z][$\w]*$/.test(name) && !RESERVED_IDENTIFIERS.has(name)) {
    return;
  }
  unsupported(bundleId, `${kind} "${name}"`);
}

function unsupported(bundleId: string, construct: string): never {
  throw new LanguagePackCompilerError(
    bundleId,
    `Unsupported ${construct} in message "${bundleId}"`,
  );
}

function rejectMarkupSources(
  sourceCatalogs: readonly RawSourceCatalog[],
  excludeMessagePrefixes: readonly string[],
): void {
  for (const source of sourceCatalogs) {
    const catalog = JSON.parse(source.contents) as Record<string, unknown>;
    for (const [bundleId, message] of Object.entries(catalog)) {
      if (
        bundleId === "$schema" ||
        excludeMessagePrefixes.some((prefix) => bundleId.startsWith(prefix))
      ) {
        continue;
      }
      const markup = findMarkup(message);
      if (markup !== undefined) {
        positionCompilerError(
          new LanguagePackCompilerError(
            bundleId,
            `Unsupported ${markup} in message "${bundleId}"`,
            {
              sourcePath: source.path,
              sourceContents: source.contents,
            },
          ),
        );
      }
    }
  }
}

function findMarkup(value: unknown): string | undefined {
  if (typeof value === "string") {
    for (let index = 0; index < value.length - 1; index++) {
      if (
        value[index] === "{" &&
        (value[index + 1] === "#" || value[index + 1] === "/") &&
        !isEscaped(value, index)
      ) {
        return value[index + 1] === "#" ? "markup-start" : "markup-end";
      }
    }
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map(findMarkup).find((markup) => markup !== undefined);
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value)
      .map(findMarkup)
      .find((markup) => markup !== undefined);
  }
  return undefined;
}

function isEscaped(value: string, index: number): boolean {
  let precedingBackslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && value[cursor] === "\\";
    cursor--
  ) {
    precedingBackslashes++;
  }
  return precedingBackslashes % 2 === 1;
}

// Discovers source catalogs and attributes compiler diagnostics to source text.

type SourceIndex = Map<
  string,
  Array<RawSourceCatalog & { messages: Record<string, unknown> }>
>;

async function discoverSourceCatalogs(
  project: InlangProject,
  projectPath: string,
  settings: Awaited<ReturnType<InlangProject["settings"]["get"]>>,
): Promise<RawSourceCatalog[]> {
  const plugins = await project.plugins.get();
  const plugin = plugins.find(
    (candidate) => candidate.key === "plugin.inlang.messageFormat",
  );
  if (plugin?.toBeImportedFiles === undefined) {
    throw new Error(
      `${projectPath}:1:1: The Inlang JSON message-format plugin is required`,
    );
  }
  const files = await plugin.toBeImportedFiles({ settings });
  const catalogs: RawSourceCatalog[] = [];
  for (const [mergePrecedence, file] of files.entries()) {
    const path = resolve(dirname(projectPath), file.path);
    try {
      catalogs.push({
        locale: file.locale,
        path,
        contents: await readFile(path, "utf8"),
        mergePrecedence,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return catalogs;
}

/**
 * Re-reads the configured catalogs from `settings.json` after the project
 * itself failed to load, so the thrown error can still cite a source position.
 * {@link discoverSourceCatalogs} is unavailable here — the plugin whose
 * `toBeImportedFiles` hook it needs is exactly what failed to load.
 */
async function readConfiguredSourceCatalogsForDiagnostics(
  projectPath: string,
): Promise<RawSourceCatalog[]> {
  try {
    const settings = JSON.parse(
      await readFile(join(projectPath, "settings.json"), "utf8"),
    ) as {
      locales?: unknown;
      "plugin.inlang.messageFormat"?: { pathPattern?: unknown };
    };
    if (!Array.isArray(settings.locales)) return [];
    const configured = settings["plugin.inlang.messageFormat"]?.pathPattern;
    const patterns = Array.isArray(configured) ? configured : [configured];
    const catalogs: RawSourceCatalog[] = [];
    for (const [mergePrecedence, pattern] of patterns.entries()) {
      if (typeof pattern !== "string") continue;
      for (const locale of settings.locales) {
        if (typeof locale !== "string") continue;
        const path = resolve(
          dirname(projectPath),
          pattern.replaceAll(/\{(?:locale|languageTag)\}/g, locale),
        );
        try {
          catalogs.push({
            locale,
            path,
            contents: await readFile(path, "utf8"),
            mergePrecedence,
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
    return catalogs;
  } catch {
    return [];
  }
}

function indexSources(
  sourceCatalogs: readonly RawSourceCatalog[],
): SourceIndex {
  const index: SourceIndex = new Map();
  for (const source of sourceCatalogs) {
    const messages = JSON.parse(source.contents) as Record<string, unknown>;
    const localeSources = index.get(source.locale) ?? [];
    localeSources.push({ ...source, messages });
    localeSources.sort(
      (left, right) => left.mergePrecedence - right.mergePrecedence,
    );
    index.set(source.locale, localeSources);
  }
  return index;
}

function effectiveSourcePath(
  sources: SourceIndex,
  locale: string,
  bundleId?: string,
): string {
  const localeSources = sources.get(locale) ?? [];
  const candidates =
    bundleId === undefined
      ? localeSources
      : localeSources.filter(({ messages }) =>
          Object.hasOwn(messages, bundleId),
        );
  return candidates.at(-1)?.path ?? localeSources.at(-1)?.path ?? "<project>";
}

function effectiveSource(
  sources: SourceIndex,
  locale: string,
  bundleId?: string,
): RawSourceCatalog | undefined {
  const localeSources = sources.get(locale) ?? [];
  const candidates =
    bundleId === undefined
      ? localeSources
      : localeSources.filter(({ messages }) =>
          Object.hasOwn(messages, bundleId),
        );
  return candidates.at(-1) ?? localeSources.at(-1);
}

function localeSourcePaths(sources: SourceIndex, locale: string): string[] {
  return (sources.get(locale) ?? []).map((source) => source.path);
}

function sourceLocation(
  sources: SourceIndex,
  locale: string,
  bundleId: string,
): { sourcePath: string; line: number; column: number } {
  const source = effectiveSource(sources, locale, bundleId);
  if (source === undefined) {
    return { sourcePath: "<project>", line: 1, column: 1 };
  }
  return {
    sourcePath: source.path,
    ...locateBundle(source.contents, bundleId),
  };
}

async function positionedError(
  projectPath: string,
  error: unknown,
  options: FindSourcePositionOptions = {},
): Promise<Error> {
  const normalized = toError(error);
  const compilerError =
    normalized instanceof LanguagePackCompilerError ? normalized : undefined;
  const position = await findSourcePosition(projectPath, normalized, {
    ...options,
    bundleId: compilerError?.bundleId,
    sourcePath: compilerError?.sourcePath,
  });
  return new Error(`${position}: ${normalized.message}`, { cause: normalized });
}

/**
 * Positions a {@link LanguagePackCompilerError} at its source location and
 * throws it as a plain `Error`; any other error passes through unchanged.
 * The compiler's one error-positioning path: `unsupported()` throws
 * unpositioned, and every catch site around bundle compilation routes back
 * through here to attach a source location before the error escapes.
 */
function positionCompilerError(
  error: unknown,
  source?: RawSourceCatalog,
): never {
  if (!(error instanceof LanguagePackCompilerError)) throw error;
  const positioned =
    error.sourcePath === undefined
      ? new LanguagePackCompilerError(error.bundleId, error.message, {
          sourcePath: source?.path,
          sourceContents: source?.contents,
        })
      : error;
  const position =
    positioned.sourcePath === undefined
      ? "<project>:1:1"
      : formatPosition(
          positioned.sourcePath,
          positioned.sourceContents ?? "",
          positioned.bundleId,
        );
  throw new Error(`${position}: ${positioned.message}`, { cause: positioned });
}

type FindSourcePositionOptions = {
  bundleId?: string;
  sourcePath?: string;
  sourceCatalogs?: readonly RawSourceCatalog[];
};

async function findSourcePosition(
  projectPath: string,
  error: Error,
  options: FindSourcePositionOptions = {},
): Promise<string> {
  if (options.sourcePath === undefined) {
    const located = [...(options.sourceCatalogs ?? [])]
      .sort((left, right) => right.mergePrecedence - left.mergePrecedence)
      .map((source) => ({
        source,
        bundleId:
          options.bundleId ?? inferInvalidDeclarationBundle(source.contents),
      }))
      .find(({ bundleId }) => bundleId !== undefined);
    if (
      located === undefined ||
      (!error.message.includes("declaration") && options.bundleId === undefined)
    ) {
      return `${projectPath}:1:1`;
    }
    return formatPosition(
      located.source.path,
      located.source.contents,
      located.bundleId,
    );
  }
  try {
    const source = await readFile(options.sourcePath, "utf8");
    const locatedBundleId =
      options.bundleId ?? inferInvalidDeclarationBundle(source);
    return formatPosition(options.sourcePath, source, locatedBundleId);
  } catch {
    return `${options.sourcePath}:1:1`;
  }
}

function inferInvalidDeclarationBundle(source: string): string | undefined {
  const catalog = JSON.parse(source) as Record<string, unknown>;
  return Object.entries(catalog).find(([bundleId, value]) => {
    if (bundleId === "$schema" || !Array.isArray(value)) return false;
    return value.some((message) => {
      if (typeof message !== "object" || message === null) return false;
      const declarations = (message as { declarations?: unknown }).declarations;
      return (
        Array.isArray(declarations) &&
        declarations.some(
          (declaration) =>
            typeof declaration !== "string" ||
            (!declaration.startsWith("input ") &&
              !declaration.startsWith("local ")),
        )
      );
    });
  })?.[0];
}

function formatPosition(
  sourcePath: string,
  source: string,
  bundleId?: string,
): string {
  const { line, column } = locateBundle(source, bundleId);
  return `${sourcePath}:${line}:${column}`;
}

function locateBundle(
  source: string,
  bundleId?: string,
): { line: number; column: number } {
  const offset =
    bundleId === undefined
      ? 0
      : Math.max(0, source.indexOf(JSON.stringify(bundleId)));
  const prefix = source.slice(0, offset);
  const lines = prefix.split("\n");
  return {
    line: lines.length,
    column: lines.at(-1)!.length + 1,
  };
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

// Persists generated compiler artifacts while avoiding unchanged writes.

export async function writeOutput(
  generated: GeneratedArtifacts,
  outputDirectory: string,
): Promise<{ writtenPaths: string[]; removedPaths: string[] }> {
  const desired = new Set(
    generated.artifacts.map((artifact) => artifact.fileName),
  );
  const writtenPaths = (
    await Promise.all(
      generated.artifacts.map(({ fileName, contents }) =>
        writeIfChanged(join(outputDirectory, fileName), contents),
      ),
    )
  ).filter((path): path is string => path !== undefined);
  const removedPaths: string[] = [];
  try {
    for (const entry of await readdir(outputDirectory, {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || desired.has(entry.name)) continue;
      if (!isGeneratedArtifactName(entry.name)) continue;
      const stalePath = join(outputDirectory, entry.name);
      await rm(stalePath);
      removedPaths.push(stalePath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { writtenPaths, removedPaths };
}

/**
 * Whether a leftover file in the output directory is shaped like something a
 * previous compile emitted — a locale pack, the facade, or the runtime. Files
 * the compiler never emits are left alone rather than swept.
 */
function isGeneratedArtifactName(fileName: string): boolean {
  return (
    fileName === "messages.ts" ||
    fileName === "runtime.ts" ||
    fileName === "catalog.ts" ||
    fileName === TARGET_LOCALE_MESSAGES_FILE ||
    isLanguagePackFileName(fileName)
  );
}

async function writeIfChanged(
  path: string,
  contents: string,
): Promise<string | undefined> {
  try {
    if ((await readFile(path, "utf8")) === contents) return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
  return path;
}
