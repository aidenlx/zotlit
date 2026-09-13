// Resolve saved authoring inputs and prove which exact bytes reconciliation observed.
import { createHash } from "node:crypto";
import { basename, join } from "node:path/posix";
import { MarkdownView } from "obsidian";
import type { App, CliData, CliHandler } from "obsidian";

import { formatPlainTemplateDocument } from "@zotlit/templates/facade";

import { isErrno } from "@/lib/errno";
import { getLogger } from "@/lib/log";
import { parseProfileSelector } from "@/lib/profile-stamp";
import { itemKeyFromFrontmatter } from "@/services/note-index/service";
import type { ResolvedProfile } from "@/services/profile/bindings";
import type { ProfileService } from "@/services/profile/service";
import { DEFAULT_PROFILE_DOCUMENT } from "@/services/profile/service";
import { CITATION_TEMPLATE_SOURCE } from "@/services/template/defaults";
import { citationPath } from "@/services/template/defaults";
import type { TemplateService } from "@/services/template/service";

import { CONTRACT_VERSION } from "./envelope";
import type { WorkbenchIdentity } from "./envelope";
import {
  INSPECT_DIAGNOSTICS,
  INSPECT_SELECTORS,
  INSPECT_SOURCE_FULL,
  INSPECT_TIMEOUT_MS,
  inspectFlags,
  TEMPLATE_INSPECT_COMMAND,
} from "./inspect-contract";
export { inspectFlags, TEMPLATE_INSPECT_COMMAND } from "./inspect-contract";

const logger = getLogger("template-workbench");
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
  read: (path: string) => Promise<string>;
  loaded: (path: string) => string | undefined;
  onChange: (callback: () => void) => () => void;
  /** Canonical customization paths whose confirmed absence selects built-in source. */
  absent?: ReadonlySet<string>;
}

/** Compare adapter reads with exact reconciliation bytes, with a bounded event wait.
 * The initial disk snapshot remains the requested version throughout the attempt. */
export async function verifySavedSources(
  deps: FreshnessDeps,
  paths: readonly string[],
  timeoutMs = INSPECT_TIMEOUT_MS,
): Promise<{
  state: FreshnessState;
  versions: SourceVersion[];
  errors?: { path: string; message: string; code?: string }[];
}> {
  using stack = new DisposableStack();
  let wake = Promise.withResolvers<void>();
  stack.defer(deps.onChange(() => wake.resolve()));
  const deadline = Promise.withResolvers<void>();
  stack.adopt(
    setTimeout(() => deadline.resolve(), timeoutMs),
    clearTimeout,
  );
  let timedOut = false;
  void deadline.promise.then(() => {
    timedOut = true;
  });
  const errors: { path: string; message: string; code?: string }[] = [];
  const finish = (state: FreshnessState, versions: SourceVersion[]) => {
    logger.debug("Saved source verification completed", {
      state,
      paths,
      versions,
      errors,
    });
    return { state, versions, ...(errors.length ? { errors } : {}) };
  };
  const read = async (path: string) => {
    try {
      return await deps.read(path);
    } catch (error) {
      if (!isErrno(error, "ENOENT")) {
        errors.push({
          path,
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error &&
          "code" in error &&
          typeof error.code === "string"
            ? { code: error.code }
            : {}),
        });
      }
      return undefined;
    }
  };
  const requested = await Promise.all(paths.map(read));
  while (true) {
    const changed = wake.promise;
    const disk = errors.length ? requested : await Promise.all(paths.map(read));
    const versions = paths.map((path, index) => {
      const loaded = deps.loaded(path);
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
    if (errors.length) return finish("read-failed", versions);
    if (versions.some((entry) => entry.disk !== entry.requested))
      return finish("superseded", versions);
    if (
      versions.every(
        (entry) =>
          entry.disk === entry.loaded &&
          (entry.disk !== null || deps.absent?.has(entry.path)),
      )
    )
      return finish("current", versions);
    if (timedOut) return finish("timeout", versions);
    logger.trace("Waiting for saved source reconciliation", {
      paths,
      versions,
      timeoutMs,
    });
    await Promise.race([changed, deadline.promise]);
    wake = Promise.withResolvers<void>();
  }
}

export interface InspectDeps {
  app: App;
  profile: ProfileService;
  templates: TemplateService;
  folder: () => string;
  identity: () => Promise<WorkbenchIdentity>;
  timeoutMs?: number;
}

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
  problems: unknown[];
}

function profileRow(profile: ResolvedProfile) {
  return {
    id: profile.selector,
    label: profile.label ?? "Default",
    bindings: profile.bindings,
  };
}

export function inspectInventory(deps: InspectDeps): InspectDocument[] {
  const profiles = [
    deps.profile.resolveProfile("default"),
    ...deps.profile.profiles.map((entry) =>
      deps.profile.resolveProfile(entry.id),
    ),
  ].filter((entry) => entry !== undefined);
  const documents: InspectDocument[] = deps.templates
    .getLiteratureNoteTemplateStatuses()
    .map((entry) => {
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
          ...deps.profile.diagnostics.filter(
            (problem) => problem.path === entry.path,
          ),
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
      path: profile.document ? join(deps.folder(), profile.document) : null,
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
  const citation = deps.templates.getCitationTemplateStatus();
  documents.push({
    kind: "citation",
    id: "citation",
    label: "Citation Template",
    path: citation.customized ? citation.path : null,
    problems: deps.templates.compileErrors.has("citation")
      ? [deps.templates.compileErrors.get("citation")]
      : [],
  });
  for (const partial of deps.templates.getPartialDocuments())
    documents.push({
      kind: "partial",
      id: `partial:${partial.name}`,
      label: partial.name,
      path: partial.path,
      problems: deps.templates.compileErrors.has(partial.name)
        ? [deps.templates.compileErrors.get(partial.name)]
        : [],
    });
  for (const partial of deps.templates.getReservedPartialFiles())
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
}

/** Resolve one explicit target. Ambiguity is retained for the caller to report. */
export function selectInspectDocument(
  inventory: InspectDocument[],
  params: CliData,
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

/** The same Literature Note selector for document inspection and field discovery. */
export function selectInspectionNote(
  deps: Pick<InspectDeps, "app" | "profile">,
  name: string,
) {
  const files = deps.app.vault.getMarkdownFiles();
  const exact = files.filter((file) => file.path === name);
  const candidates = exact.length
    ? exact
    : files.filter((file) => file.basename === name);
  if (candidates.length !== 1)
    return {
      error: candidates.length
        ? ("AMBIGUOUS_TARGET" as const)
        : ("TARGET_NOT_FOUND" as const),
      matches: candidates.map((file) => file.path),
    };
  const file = candidates[0]!;
  const key = itemKeyFromFrontmatter(deps.app.metadataCache.getFileCache(file));
  if (!key) return { error: "NOT_LITERATURE_NOTE" as const };
  const owner = deps.profile.profileOf(file);
  const profile = owner.ok
    ? owner.profile.selector
    : (owner.stamped.id ?? parseProfileSelector(owner.stamped.stamp));
  if (profile === undefined) return { error: "UNKNOWN_PROFILE_STAMP" as const };
  return { note: { path: file.path, key }, profile };
}

export function createInspectHandler(deps: InspectDeps): CliHandler {
  return async (params) => {
    const identity = await deps.identity();
    const answer = (result: object) =>
      JSON.stringify(
        {
          contractVersion: CONTRACT_VERSION,
          command: TEMPLATE_INSPECT_COMMAND,
          identity,
          profileDiagnostics: deps.profile.diagnostics,
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
      );
    const fail = (code: keyof typeof INSPECT_DIAGNOSTICS, context?: object) =>
      answer({
        ok: false,
        diagnostic: { code, ...INSPECT_DIAGNOSTICS[code] },
        ...context,
      });
    const selectors = INSPECT_SELECTORS.map((name) => params[name]).filter(
      (entry) => entry !== undefined,
    );
    if (
      Object.keys(params).some((key) => !(key in inspectFlags)) ||
      selectors.length > 1 ||
      selectors.some(
        (value) => typeof value !== "string" || value.trim() === "",
      ) ||
      (params.source !== undefined && params.source !== INSPECT_SOURCE_FULL)
    )
      return fail("INVALID_SELECTOR");
    if (
      params["expect-source"] !== undefined &&
      params["expect-source"] !== identity.source.id
    )
      return fail("TARGET_MISMATCH");
    await Promise.all([deps.templates.ready, deps.profile.ready]);
    let inventory = inspectInventory(deps);
    if (selectors.length === 0) {
      if (params.editor !== undefined) return fail("INVALID_SELECTOR");
      return answer({
        ok: true,
        documents: inventory,
        problems: deps.profile.diagnostics,
      });
    }
    let selection = params;
    let note: { path: string; key: string } | undefined;
    if (typeof params.note === "string") {
      const selected = selectInspectionNote(deps, params.note);
      if (selected.error)
        return fail(selected.error, { matches: selected.matches });
      note = selected.note;
      selection = { profile: selected.profile };
    }
    const selectionOptions = { profileIdentityOnly: note !== undefined };
    let matches = selectInspectDocument(inventory, selection, selectionOptions);
    if (matches.length !== 1)
      return fail(matches.length ? "AMBIGUOUS_TARGET" : "TARGET_NOT_FOUND", {
        matches,
      });
    let document = matches[0]!;
    // Eta includes can be dynamic. Verify the complete installed partial registry
    // and the Citation Template so a selected Profile cannot hide an old dependency.
    const isDependency = (entry: InspectDocument) =>
      entry.id !== document.id &&
      (entry.kind === "partial" ||
        (document.kind === "profile" && entry.kind === "citation"));
    let dependencies = inventory.filter(isDependency);
    const editor = params.editor !== undefined;
    const builtinPaths = [document, ...dependencies]
      .filter((entry) => entry.path === null)
      .map((entry) =>
        entry.kind === "profile"
          ? join(deps.folder(), DEFAULT_PROFILE_DOCUMENT)
          : citationPath(deps.folder()),
      );
    const paths = [
      ...new Set([
        ...(document.path && !editor ? [document.path] : []),
        ...dependencies.flatMap((entry) => (entry.path ? [entry.path] : [])),
        ...builtinPaths,
      ]),
    ];
    const freshness = await verifySavedSources(
      {
        read: (path) => deps.app.vault.adapter.read(path),
        loaded: (path) => deps.templates.getLoadedDocumentSource(path),
        onChange: (callback) =>
          deps.templates.on("compile-status-changed", callback),
        absent: new Set(builtinPaths),
      },
      paths,
      deps.timeoutMs,
    );
    if (freshness.state !== "current")
      return fail(
        freshness.state === "read-failed"
          ? "SOURCE_READ_FAILED"
          : "SOURCE_NOT_LOADED",
        { document, note, freshness },
      );
    inventory = inspectInventory(deps);
    matches = selectInspectDocument(inventory, selection, selectionOptions);
    if (matches.length !== 1 || matches[0]!.path !== document.path)
      return fail("SOURCE_SUPERSEDED", { freshness });
    document = matches[0]!;
    dependencies = inventory.filter(isDependency);
    if (
      dependencies.some(
        (entry) => entry.path !== null && !paths.includes(entry.path),
      )
    )
      return fail("SOURCE_SUPERSEDED", { document, dependencies, freshness });
    let source: string;
    if (editor) {
      const view = deps.app.workspace.getActiveViewOfType(MarkdownView);
      if (!document.path || view?.file?.path !== document.path)
        return fail("EDITOR_TARGET_MISMATCH");
      source = view.editor.getValue();
    } else if (document.path)
      source = deps.templates.getLoadedDocumentSource(document.path)!;
    else
      source =
        document.kind === "profile"
          ? deps.profile.getBuiltInSource()
          : formatPlainTemplateDocument(CITATION_TEMPLATE_SOURCE, "liquid");
    return answer({
      ok: true,
      document,
      note,
      dependencies,
      dependencyScope: "installed-partial-registry",
      freshness,
      input: {
        origin: editor ? "editor" : document.path ? "saved" : "built-in",
        path: document.path,
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
      ...(params.source === INSPECT_SOURCE_FULL ? { source } : {}),
      problems: document.problems,
    });
  };
}
