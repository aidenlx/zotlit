// What one render failure names. A template that fails inside another
// template is reported where it failed and repaired where it was called, so
// three answers are read apart and each is given only on its own evidence: the
// engine's own reported location, the document whose call reached it, and the
// call itself. A name the source never spells earns no repair location, and a
// line the engine embeds is a line of the template it named — never of the
// document the reader has open.

import type { TemplateLanguage } from "@zotlit/templates/constants";
import {
  CitationInputError,
  MissingTemplateError,
  TemplateError,
} from "@zotlit/templates/facade";

import { errorChain } from "./report";
import type {
  RenderCaller,
  RenderDiagnostic,
  RenderEngineLocation,
} from "./result";

import { templateCalls } from "#/document/regions";

/** The source one render read, which a repair location is an offset into. */
export interface RenderCallerSource {
  readonly source: string;
  readonly language: TemplateLanguage;
}

/**
 * The diagnostic one thrown render failure reads as, attributed against the
 * source that render read.
 *
 * A call to a Shared Partial the vault holds no document for is the engine's
 * own missing-partial report, which the Partial Placeholder, the Problems
 * area, and a refused Literature Note all read by code. Citation input mismatch
 * requires runtime provenance of a direct read from the entry root and a
 * verified caller. Every other failure carries the engine's own words.
 *
 * @see docs/adr/0055-the-citation-template-is-one-document-and-partials-are-files.md
 * @see docs/adr/0056-template-diagnosis-belongs-to-the-editor.md
 */
export function renderFailureDiagnostic(
  error: unknown,
  caller: RenderCallerSource,
): Omit<RenderDiagnostic, "part"> {
  const chain = errorChain(error);
  const engine = engineLocation(chain);
  const named = chain.find(
    (link): link is MissingTemplateError =>
      link instanceof MissingTemplateError,
  );
  // The partial the engine could not resolve is the one to repair the call to;
  // every other failure is repaired where the template it names was called.
  const site = named
    ? callSites(caller, named.templateName)[0]
    : verifiedCallSite(caller, engine?.template);
  const from = callerOf(chain);
  const attribution = {
    ...(engine ? { engine } : {}),
    ...(from ? { caller: from } : {}),
    ...(site ? { callSite: site } : {}),
  };
  if (named)
    return {
      code: "missing-partial",
      params: { name: named.templateName },
      ...attribution,
    };
  return {
    code:
      engine?.template === "citation" &&
      site !== undefined &&
      chain.some((link) => link instanceof CitationInputError)
        ? "citation-data-mismatch"
        : "render-error",
    message: errorText(error),
    ...attribution,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What the engine itself said one thrown failure was, as the fact two attempts
 * are told apart by. A render path that tries one part of a document after
 * another reads this to report one fault once: the template the engine could
 * not resolve, or the place it stopped inside the template it named. Undefined
 * where the engine named neither, which leaves two such failures separate —
 * equal wording is not equal cause, so nothing here reads a message.
 */
export function renderFailureCause(
  error: unknown,
): RenderFailureCause | undefined {
  const chain = errorChain(error);
  const missing = chain.find(
    (link): link is MissingTemplateError =>
      link instanceof MissingTemplateError,
  );
  if (missing) return { missing: missing.templateName };
  const at = engineLocation(chain);
  return at ? { at } : undefined;
}

/** @see renderFailureCause */
export interface RenderFailureCause {
  /** The template the engine could not resolve at all. */
  readonly missing?: string;
  /** Where it stopped in the template it named. */
  readonly at?: RenderEngineLocation;
}

/**
 * Where the engine said it happened. liquidjs carries the token it raised on,
 * whose file is the registered name the source was parsed under; the facade's
 * own {@link TemplateError} carries that name for a failure inside a named
 * template. A template the engine could not resolve at all is named as the
 * object rather than as a location, because nothing was read there. Eta writes
 * its location into the message alone, which stays evidence rather than
 * becoming a location.
 */
function engineLocation(
  chain: readonly Error[],
): RenderEngineLocation | undefined {
  for (const link of chain) {
    if (link instanceof MissingTemplateError) return undefined;
    const token = liquidToken(link);
    if (token) {
      const before = token.input.slice(0, token.begin);
      const line = before.split("\n").length;
      return {
        template: token.file,
        line,
        column: token.begin - (before.lastIndexOf("\n") + 1) + 1,
      };
    }
    if (link instanceof TemplateError) return { template: link.templateName };
  }
  return undefined;
}

/**
 * The document a failure named as holding the call, when it named one. A draft
 * compiled from source rather than from a file carries a placeholder reference
 * instead of a vault path, so only a document path is read as one — a name
 * that locates no document says nothing about where to look.
 */
function callerOf(chain: readonly Error[]): RenderCaller | undefined {
  for (const link of chain) {
    const path = (link as { documentPath?: unknown }).documentPath;
    if (typeof path === "string" && path.endsWith(".md"))
      return { document: path };
  }
  return undefined;
}

/** The token liquidjs raised on, when `error` is one of its render errors. */
function liquidToken(
  error: Error,
): { file: string; input: string; begin: number } | undefined {
  const token = (error as { token?: unknown }).token;
  if (token === null || typeof token !== "object") return undefined;
  const { file, input, begin } = token as Record<string, unknown>;
  return typeof file === "string" &&
    typeof input === "string" &&
    typeof begin === "number"
    ? { file, input, begin }
    : undefined;
}

/**
 * Every call in `caller` naming `template`, in source order. Empty for a name
 * the source never spells, so an unnamed location stays unnamed.
 */
function callSites(
  { source, language }: RenderCallerSource,
  template: string | undefined,
): { from: number; to: number }[] {
  if (template === undefined) return [];
  return templateCalls(source, { from: 0, to: source.length }, language)
    .filter(({ name }) => name === template)
    .map(({ call }) => call);
}

/**
 * Where a failure the engine reported inside `template` is repaired: the one
 * call that reached it. A source spelling that name twice reached it from one
 * of them and nothing here says which, so the repair location stays absent
 * rather than sending the reader to whichever call comes first — which may be
 * one this render never took. Missing templates use the first call instead:
 * every call naming the missing document needs the same repair.
 */
function verifiedCallSite(
  caller: RenderCallerSource,
  template: string | undefined,
): { from: number; to: number } | undefined {
  const calls = callSites(caller, template);
  return calls.length === 1 ? calls[0] : undefined;
}
