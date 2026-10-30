// Resolve saved authoring inputs and prove which exact bytes reconciliation observed.
import { Clock, Deferred, Duration, Effect, Schema, Stream } from "effect";
import type { Scope } from "effect";
import { createHash } from "node:crypto";
import { basename, join } from "node:path/posix";
import type { CliData } from "obsidian";

import { renderDiagnostic } from "@zotlit/item-query";
import { formatPlainTemplateDocument } from "@zotlit/templates/facade";

import {
  CliRejection,
  cliLiterals,
  cliOneOf,
  cliParams,
  cliRule,
  cliSwitch,
  cliText,
  decodeCliParams,
  expectSourceParam,
  amendRejection,
} from "@/lib/cli-params";
import type { CliOutput, CliParamName } from "@/lib/cli-params";
import { withLogCategory } from "@/lib/effect-log";
import type { ObsidianEnv } from "@/lib/obsidian-env";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Vault } from "@/lib/obsidian-vault";
import { Workspace } from "@/lib/obsidian-workspace";
import { parseProfileSelector } from "@/lib/profile-stamp";
import type { ProfileSelector } from "@/lib/profile-stamp";
import type { FileNotFound, VaultError } from "@/lib/vault-errors";
import { itemKeyFromFrontmatter } from "@/services/note-index/service";
import type { ResolvedProfile } from "@/services/profile/bindings";
import { Profile } from "@/services/profile/service";
import type {
  ProfileDiagnostic,
  ProfileOperationError,
} from "@/services/profile/service";
import { DEFAULT_PROFILE_DOCUMENT } from "@/services/profile/service";
import { PluginSettings } from "@/services/settings/service";
import { CITATION_TEMPLATE_SOURCE } from "@/services/template/defaults";
import { citationPath, partialNameRefusal } from "@/services/template/defaults";
import { Template } from "@/services/template/service";
import type {
  CompileError,
  LiteratureNoteTemplateStatus,
  TemplateFailure,
} from "@/services/template/service";
import type { ZoteroPref } from "@/services/zotero-pref/service";

import { CONTRACT_VERSION, rejectionDiagnostic } from "./envelope";
import { readWorkbenchIdentity } from "./identity";
import type { InspectDiagnosticCode } from "./inspect-contract";
import {
  INSPECT_DIAGNOSTICS,
  INSPECT_SELECTORS,
  INSPECT_SOURCE_FULL,
  INSPECT_TIMEOUT_MS,
  TEMPLATE_INSPECT_COMMAND,
} from "./inspect-contract";
export { inspectFlags, TEMPLATE_INSPECT_COMMAND } from "./inspect-contract";

type FreshnessState = "current" | "timeout" | "superseded" | "read-failed";

export function sourceRevision(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

export interface SourceVersion {
  path: string;
  requested: string | null;
  disk: string | null;
  loaded: string | null;
}

export interface FreshnessDeps {
  /** The text on disk at `path`; `FileNotFound` when no file is there. */
  read: (path: string) => Effect.Effect<string, FileNotFound | VaultError>;
  /** The text reconciliation loaded from `path`, when it holds one. */
  loaded: (path: string) => Effect.Effect<string | undefined, TemplateFailure>;
  /** Each completed reconciliation. */
  changes: Stream.Stream<void>;
  /** Canonical customization paths whose confirmed absence selects built-in source. */
  absent?: ReadonlySet<string>;
}

/**
 * Compare adapter reads with exact reconciliation bytes, with a bounded event
 * wait. The initial disk snapshot remains the requested version throughout the
 * attempt; the wait ends `timeoutMs` after it began, by the Effect Clock.
 */
export const verifySavedSources = Effect.fn(
  "TemplateWorkbenchCli.verifySavedSources",
)(
  function* (
    deps: FreshnessDeps,
    paths: readonly string[],
    { timeoutMs = INSPECT_TIMEOUT_MS }: { timeoutMs?: number | undefined } = {},
  ): Effect.fn.Return<
    {
      state: FreshnessState;
      versions: SourceVersion[];
      errors?: { path: string; message: string; code?: string }[];
    },
    TemplateFailure,
    Scope.Scope
  > {
    const deadline = (yield* Clock.currentTimeMillis) + timeoutMs;
    let wake = yield* Deferred.make<void>();
    yield* Effect.forkScoped(
      Stream.runForEach(deps.changes, () =>
        Effect.suspend(() => Deferred.succeed(wake, undefined)),
      ),
    );
    const errors: { path: string; message: string; code?: string }[] = [];
    const finish = (state: FreshnessState, versions: SourceVersion[]) =>
      Effect.logDebug("Saved source verification completed").pipe(
        Effect.annotateLogs({ state, paths, versions, errors }),
        Effect.as({ state, versions, ...(errors.length ? { errors } : {}) }),
      );
    const read = (path: string) =>
      deps.read(path).pipe(
        Effect.catchTag("FileNotFound", () => Effect.void),
        Effect.catchTag("VaultError", ({ message, cause }) => {
          errors.push({
            path,
            message,
            ...(cause instanceof Error &&
            "code" in cause &&
            typeof cause.code === "string"
              ? { code: cause.code }
              : {}),
          });
          return Effect.void;
        }),
      );
    const readAll = Effect.forEach(paths, (path) => read(path), {
      concurrency: "unbounded",
    });
    const requested = yield* readAll;
    while (true) {
      const changed = wake;
      const disk = errors.length ? requested : yield* readAll;
      const loadedSources = yield* Effect.forEach(paths, (path) =>
        deps.loaded(path),
      );
      const versions = paths.map((path, index) => {
        const loaded = loadedSources[index];
        return {
          path,
          requested:
            requested[index] === undefined
              ? null
              : sourceRevision(requested[index]),
          disk: disk[index] === undefined ? null : sourceRevision(disk[index]),
          loaded: loaded === undefined ? null : sourceRevision(loaded),
        };
      });
      if (errors.length) return yield* finish("read-failed", versions);
      if (versions.some((entry) => entry.disk !== entry.requested))
        return yield* finish("superseded", versions);
      if (
        versions.every(
          (entry) =>
            entry.disk === entry.loaded &&
            (entry.disk !== null || deps.absent?.has(entry.path)),
        )
      )
        return yield* finish("current", versions);
      const remaining = deadline - (yield* Clock.currentTimeMillis);
      if (remaining <= 0) return yield* finish("timeout", versions);
      yield* Effect.logTrace("Waiting for saved source reconciliation").pipe(
        Effect.annotateLogs({ paths, versions, timeoutMs }),
      );
      yield* Effect.timeoutOption(
        Deferred.await(changed),
        Duration.millis(remaining),
      );
      wake = yield* Deferred.make<void>();
    }
  },
  Effect.scoped,
  withLogCategory("template-workbench"),
);

/** What an inspection reads. */
export type InspectServices =
  | Profile
  | Template
  | PluginSettings
  | Vault
  | MetadataCache
  | Workspace
  | ObsidianEnv
  | ZoteroPref;

/** One problem drawn from the inspection diagnostics registry. */
export interface InspectDiagnostic {
  code: InspectDiagnosticCode;
  message: string;
  hint: string;
}

/** The manifest error an invalid Profile document reports. */
type InvalidProfileDocumentError = Extract<
  LiteratureNoteTemplateStatus["validation"],
  { state: "invalid" }
>["error"];

/** What an inspected document reports. Four producers contribute: the inspection
 *  diagnostics registry, the Profile scan, an invalid Profile document manifest,
 *  and a template compile error, which carries no code. */
export type InspectProblem =
  | InspectDiagnostic
  | ProfileDiagnostic
  | InvalidProfileDocumentError
  | (CompileError & { code?: undefined });

export interface InspectDocument {
  kind: "profile" | "citation" | "partial";
  id: string;
  label: string;
  path: string | null;
  profileIdentity?: { id: string; label: string };
  profile?: {
    id: string;
    label: string;
    bindings: ResolvedProfile["bindings"];
  };
  problems: InspectProblem[];
}

function profileRow(profile: ResolvedProfile) {
  return {
    id: profile.selector,
    label: profile.label ?? "Default",
    bindings: profile.bindings,
  };
}

/** The folder Template Documents are saved in. */
export const templateFolder = PluginSettings.use((settings) =>
  Effect.map(settings.current, (current) => current["template.folder"]),
);

export const inspectInventory = Effect.fnUntraced(function* () {
  const profileStore = yield* Profile;
  const template = yield* Template;
  const resolve = (selector: ProfileSelector) =>
    profileStore.resolveProfile(selector);
  const diagnostics = yield* profileStore.diagnostics;
  const profiles = [
    yield* resolve("default"),
    ...(yield* Effect.forEach(yield* profileStore.profiles, (entry) =>
      resolve(entry.id),
    )),
  ].filter((entry) => entry !== undefined);
  const documents: InspectDocument[] =
    (yield* template.getLiteratureNoteTemplateStatuses).map((entry) => {
      const owner = profiles.find(
        (profile) => profile.document === entry.reference,
      );
      const manifestId =
        entry.validation.state === "valid"
          ? entry.validation.manifest.id
          : (entry.validation.manifestId ??
            (entry.reference === DEFAULT_PROFILE_DOCUMENT
              ? "default"
              : undefined));
      const label =
        owner?.label ??
        (entry.validation.state === "valid"
          ? entry.validation.manifest.name
          : undefined) ??
        entry.reference;
      return {
        kind: "profile",
        id: entry.reference,
        label,
        path: entry.path,
        ...(manifestId ? { profileIdentity: { id: manifestId, label } } : {}),
        ...(owner ? { profile: profileRow(owner) } : {}),
        problems: [
          ...(entry.validation.state === "invalid"
            ? [entry.validation.error]
            : []),
          ...diagnostics.filter((problem) => problem.path === entry.path),
        ],
      };
    });
  for (const profile of profiles) {
    if (documents.some((entry) => entry.profile?.id === profile.selector))
      continue;
    documents.push({
      kind: "profile",
      id: profile.document ?? "default",
      label: profile.label ?? "Default",
      path: profile.document
        ? join(yield* templateFolder, profile.document)
        : null,
      profile: profileRow(profile),
      problems: profile.document
        ? [
            {
              code: "DOCUMENT_NOT_FOUND",
              ...INSPECT_DIAGNOSTICS.DOCUMENT_NOT_FOUND,
            },
          ]
        : [],
    });
  }
  const citation = yield* template.getCitationTemplateStatus;
  const compileErrors = yield* template.compileErrors;
  documents.push({
    kind: "citation",
    id: "citation",
    label: "Citation Template",
    path: citation.customized ? citation.path : null,
    problems: compileErrors.has("citation")
      ? [compileErrors.get("citation")!]
      : [],
  });
  for (const partial of yield* template.getPartialDocuments)
    documents.push({
      kind: "partial",
      id: `partial:${partial.name}`,
      label: partial.name,
      path: partial.path,
      problems: compileErrors.has(partial.name)
        ? [compileErrors.get(partial.name)!]
        : [],
    });
  for (const partial of yield* template.getReservedPartialFiles)
    documents.push({
      kind: "partial",
      id: `partial:${partial.name}`,
      label: partial.name,
      path: partial.path,
      problems: [
        {
          code: "RESERVED_PARTIAL_NAME",
          ...INSPECT_DIAGNOSTICS.RESERVED_PARTIAL_NAME,
        },
      ],
    });
  return documents;
});

/** The one target an inspection names. */
type InspectSelection = Pick<InspectRequest, "profile" | "document">;

/** Resolve one explicit target. Ambiguity is retained for the caller to report. */
export function selectInspectDocument(
  inventory: InspectDocument[],
  params: InspectSelection,
  options: { profileIdentityOnly?: boolean } = {},
): InspectDocument[] {
  if (typeof params.profile === "string") {
    const exact = inventory.filter(
      (entry) =>
        (entry.profile?.id ?? entry.profileIdentity?.id) === params.profile,
    );
    if (exact.length || options.profileIdentityOnly) return exact;
    return inventory.filter(
      (entry) =>
        (entry.profile?.label ?? entry.profileIdentity?.label) ===
        params.profile,
    );
  }
  return inventory.filter(
    (entry) =>
      entry.id === params.document ||
      entry.path === params.document ||
      (entry.path && basename(entry.path) === params.document),
  );
}

const INVALID_TARGET = INSPECT_DIAGNOSTICS.INVALID_SELECTOR.message;

const target = Schema.optionalKey(cliText(INVALID_TARGET));

/** The selectors and the editor switch, as the rules between them read them. */
type InspectTarget = {
  note?: string;
  profile?: string;
  document?: string;
  editor?: true;
};

const inspectParams = cliParams({
  note: target,
  profile: target,
  document: target,
  source: Schema.optionalKey(
    cliLiterals([INSPECT_SOURCE_FULL], INVALID_TARGET),
  ),
  editor: cliSwitch(INVALID_TARGET),
  "expect-source": expectSourceParam,
}).check(
  cliOneOf<InspectTarget>(INSPECT_SELECTORS, { many: INVALID_TARGET }),
  // Editor source belongs to one selected document.
  cliRule(
    "editor",
    (input: InspectTarget) =>
      input.editor === undefined ||
      INSPECT_SELECTORS.some((name) => input[name] !== undefined),
    INVALID_TARGET,
  ),
);

export type InspectRequest = CliOutput<typeof inspectParams>;
export type InspectParam = CliParamName<typeof inspectParams>;

/** The note an inspection or a field discovery selected, or why none is. */
export type InspectionNote =
  | {
      error: "AMBIGUOUS_TARGET" | "TARGET_NOT_FOUND";
      matches: string[];
    }
  | { error: "NOT_LITERATURE_NOTE" | "UNKNOWN_PROFILE_STAMP" }
  | {
      error?: undefined;
      note: { path: string; key: string };
      profile: string;
    };

/** The same Literature Note selector for document inspection and field discovery. */
export const selectInspectionNote = Effect.fnUntraced(function* (
  name: string,
): Effect.fn.Return<
  InspectionNote,
  ProfileOperationError,
  Vault | MetadataCache | Profile
> {
  const files = yield* (yield* Vault).getMarkdownFiles;
  const exact = files.filter((file) => file.path === name);
  const candidates = exact.length
    ? exact
    : files.filter((file) => file.basename === name);
  if (candidates.length !== 1)
    return {
      error: candidates.length ? "AMBIGUOUS_TARGET" : "TARGET_NOT_FOUND",
      matches: candidates.map((file) => file.path),
    };
  const file = candidates[0]!;
  const key = itemKeyFromFrontmatter(
    yield* (yield* MetadataCache).fileCache(file),
  );
  if (!key) return { error: "NOT_LITERATURE_NOTE" };
  const owner = yield* (yield* Profile).profileOf(file);
  const profile = owner.ok
    ? owner.profile.selector
    : (owner.stamped.id ?? parseProfileSelector(owner.stamped.stamp));
  if (profile === undefined) return { error: "UNKNOWN_PROFILE_STAMP" };
  return { note: { path: file.path, key }, profile };
});

export function createInspectHandler(
  draft?: { source: string; path: string },
  replacedDependency?: string,
): (params: CliData) => Effect.Effect<string, unknown, InspectServices> {
  return Effect.fn("TemplateWorkbenchCli.inspect")(function* (params: CliData) {
    const identity = yield* readWorkbenchIdentity;
    const profileStore = yield* Profile;
    const template = yield* Template;
    const vault = yield* Vault;
    const answer = (result: object) =>
      Effect.map(profileStore.diagnostics, (profileDiagnostics) =>
        JSON.stringify(
          {
            contractVersion: CONTRACT_VERSION,
            command: TEMPLATE_INSPECT_COMMAND,
            identity,
            profileDiagnostics,
            ...result,
          },
          (_key, value: unknown) =>
            value instanceof Error
              ? Object.assign({}, value, {
                  name: value.name,
                  message: value.message,
                  cause: value.cause,
                })
              : value,
        ),
      );
    const fail = (code: keyof typeof INSPECT_DIAGNOSTICS, context?: object) =>
      answer({
        ok: false,
        diagnostic: renderDiagnostic({ code, ...INSPECT_DIAGNOSTICS[code] }),
        ...context,
      });
    return yield* Effect.gen(function* () {
      const query = yield* decodeCliParams(params, inspectParams, {
        command: "template-inspect",
      });
      if (
        query["expect-source"] !== undefined &&
        query["expect-source"] !== identity.source.id
      )
        return yield* fail("TARGET_MISMATCH");
      const draftDocument: InspectDocument | undefined =
        draft && query.document?.startsWith("partial:")
          ? {
              kind: "partial",
              id: query.document,
              label: query.document.slice("partial:".length),
              path: null,
              problems: [],
            }
          : undefined;
      if (draftDocument && partialNameRefusal(draftDocument.label, new Set()))
        return yield* fail("INVALID_SELECTOR");
      const inventoryWithDraft = Effect.map(inspectInventory(), (documents) => {
        if (
          draftDocument &&
          !documents.some((document) => document.id === draftDocument.id)
        )
          documents.push(draftDocument);
        return documents;
      });
      let inventory = yield* inventoryWithDraft;
      if (
        query.note === undefined &&
        query.profile === undefined &&
        query.document === undefined
      ) {
        return yield* answer({
          ok: true,
          documents: inventory,
          problems: yield* profileStore.diagnostics,
        });
      }
      let selection: InspectSelection = query;
      let note: { path: string; key: string } | undefined;
      if (query.note !== undefined) {
        const selected = yield* selectInspectionNote(query.note);
        if (selected.error)
          return yield* fail(
            selected.error,
            "matches" in selected ? { matches: selected.matches } : {},
          );
        note = selected.note;
        selection = { profile: selected.profile };
      }
      const selectionOptions = { profileIdentityOnly: note !== undefined };
      let matches = selectInspectDocument(
        inventory,
        selection,
        selectionOptions,
      );
      if (matches.length !== 1)
        return yield* fail(
          matches.length ? "AMBIGUOUS_TARGET" : "TARGET_NOT_FOUND",
          { matches },
        );
      let document = matches[0]!;
      // Eta includes can be dynamic. Verify the complete installed partial registry
      // and the Citation Template so a selected Profile cannot hide an old dependency.
      const isDependency = (entry: InspectDocument) =>
        entry.id !== document.id &&
        entry.id !== replacedDependency &&
        (entry.kind === "partial" ||
          (document.kind !== "citation" && entry.kind === "citation"));
      let dependencies = inventory.filter(isDependency);
      const editor = query.editor === true;
      const folder = yield* templateFolder;
      const builtinPaths = [...(draft ? [] : [document]), ...dependencies]
        .filter((entry) => entry.path === null)
        .map((entry) =>
          entry.kind === "profile"
            ? join(folder, DEFAULT_PROFILE_DOCUMENT)
            : citationPath(folder),
        );
      const paths = [
        ...new Set([
          ...(document.path && !editor && !draft ? [document.path] : []),
          ...dependencies.flatMap((entry) => (entry.path ? [entry.path] : [])),
          ...builtinPaths,
        ]),
      ];
      const freshness = yield* verifySavedSources(
        {
          read: (path) => vault.readPath(path),
          loaded: (path) => template.getLoadedDocumentSource(path),
          changes: template.compileEvents,
          absent: new Set(builtinPaths),
        },
        paths,
      );
      if (freshness.state !== "current")
        return yield* fail(
          freshness.state === "read-failed"
            ? "SOURCE_READ_FAILED"
            : "SOURCE_NOT_LOADED",
          { document, note, freshness },
        );
      inventory = yield* inventoryWithDraft;
      matches = selectInspectDocument(inventory, selection, selectionOptions);
      if (matches.length !== 1 || matches[0]!.path !== document.path)
        return yield* fail("SOURCE_SUPERSEDED", { freshness });
      document = matches[0]!;
      dependencies = inventory.filter(isDependency);
      if (
        dependencies.some(
          (entry) => entry.path !== null && !paths.includes(entry.path),
        )
      )
        return yield* fail("SOURCE_SUPERSEDED", {
          document,
          dependencies,
          freshness,
        });
      let source: string;
      if (draft) source = draft.source;
      else if (editor) {
        const view = yield* (yield* Workspace).activeMarkdownView;
        if (!document.path || view?.file?.path !== document.path)
          return yield* fail("EDITOR_TARGET_MISMATCH");
        source = view.editor.getValue();
      } else if (document.path)
        source = (yield* template.getLoadedDocumentSource(document.path))!;
      else
        source =
          document.kind === "profile"
            ? yield* profileStore.getBuiltInSource
            : formatPlainTemplateDocument(CITATION_TEMPLATE_SOURCE, "liquid");
      return yield* answer({
        ok: true,
        document,
        note,
        dependencies,
        dependencyScope: "installed-partial-registry",
        freshness,
        input: {
          origin: draft
            ? "draft"
            : editor
              ? "editor"
              : document.path
                ? "saved"
                : "built-in",
          path: draft?.path ?? document.path,
          revision: sourceRevision(source),
        },
        ...(editor
          ? {
              contextOrigin: "saved",
              validation: {
                state: "not-checked",
                reason:
                  "Document metadata, bindings, dependencies, and problems describe saved source. Editor source was disclosed without validation.",
              },
            }
          : {}),
        ...(query.source === INSPECT_SOURCE_FULL ? { source } : {}),
        problems: document.problems,
      });
    }).pipe(
      Effect.catchIf(
        (error): error is CliRejection => error instanceof CliRejection,
        (error) =>
          answer({
            ok: false,
            diagnostic: rejectionDiagnostic(
              amendRejection(error, {
                hint: error.hint ?? INSPECT_DIAGNOSTICS.INVALID_SELECTOR.hint,
              }),
            ),
          }),
      ),
    );
  });
}
