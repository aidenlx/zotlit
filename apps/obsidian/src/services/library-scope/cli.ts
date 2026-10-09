// Registers the `zotlit:library-scope` commands with Obsidian's CLI.
//
// Command, guide, and diagnostic text is all hardcoded English: an
// agent-facing contract surface, not localized UI. See
// apps/obsidian/policies/cli-text.md.

import type { CliData, CliHandler, Plugin } from "obsidian";

import { decodeCliParams, noCliParams } from "@/lib/cli-params";
import type { CliRejection } from "@/lib/cli-params";
import type { LibraryScopeService } from "@/services/library-scope/service";

/**
 * The wire format of the `zotlit:library-scope` commands, versioned on its
 * own (ADR 0026): a change to this namespace leaves the citations and
 * Template Workbench contracts untouched.
 */
export const CONTRACT_VERSION = 1;

export const LIBRARY_SCOPE_COMMAND = "zotlit:library-scope" as const;
export const LIBRARY_SCOPE_GUIDE_COMMAND =
  "zotlit:library-scope-guide" as const;

type LibraryScopeCommand =
  | typeof LIBRARY_SCOPE_COMMAND
  | typeof LIBRARY_SCOPE_GUIDE_COMMAND;

/**
 * The documented diagnostic codes of this CLI Contract, each defined with
 * the recovery action its diagnostic carries — mirrors the citation-index and
 * Template Workbench namespaces' own `DIAGNOSTIC_HINTS`, kept separate per
 * namespace by ADR 0026.
 */
const DIAGNOSTIC_HINTS = {
  INVALID_SELECTOR:
    "Correct the parameter named in details.parameter, then run the command again.",
  DATABASE_UNREADABLE:
    "Run the command again once the connected Zotero source is readable.",
} as const satisfies Record<string, string>;

type DiagnosticCode = keyof typeof DIAGNOSTIC_HINTS;

interface Diagnostic {
  code: DiagnosticCode;
  message: string;
  /** The recovery action for `code`, taken from `DIAGNOSTIC_HINTS`. */
  hint: string;
  details?: { parameter: string };
}

function diagnostic(
  code: DiagnosticCode,
  message: string,
  details?: Diagnostic["details"],
): Diagnostic {
  return { code, message, hint: DIAGNOSTIC_HINTS[code], details };
}

function envelope(command: LibraryScopeCommand, tail: object): string {
  return JSON.stringify({
    contractVersion: CONTRACT_VERSION,
    command,
    ...tail,
  });
}

interface LibraryScopeCliDeps {
  libraryScope: Pick<LibraryScopeService, "ready" | "current">;
}

export function registerLibraryScopeCli(
  plugin: Plugin,
  deps: LibraryScopeCliDeps,
): void {
  plugin.registerCliHandler(
    LIBRARY_SCOPE_COMMAND,
    "Report the resolved Library Scope: mode, available Libraries, and unavailable selectors",
    null,
    createLibraryScopeHandler(deps),
  );
  plugin.registerCliHandler(
    LIBRARY_SCOPE_GUIDE_COMMAND,
    "Print the zotlit:library-scope CLI guide",
    null,
    guideHandler,
  );
}

function createLibraryScopeHandler(deps: LibraryScopeCliDeps): CliHandler {
  return async (params: CliData): Promise<string> => {
    const request = decodeCliParams(params, noCliParams, {
      command: LIBRARY_SCOPE_COMMAND,
    });
    if (request.kind === "invalid") {
      return invalidRequest(LIBRARY_SCOPE_COMMAND, request);
    }

    await deps.libraryScope.ready;
    const current = deps.libraryScope.current;
    if (current === null) {
      return envelope(LIBRARY_SCOPE_COMMAND, {
        ok: false,
        diagnostic: diagnostic(
          "DATABASE_UNREADABLE",
          "The connected Zotero source is not currently readable.",
        ),
      });
    }

    return envelope(LIBRARY_SCOPE_COMMAND, {
      ok: true,
      mode: current.mode,
      invalid: current.invalid,
      // `AvailableLibrary` already reports exactly `selector`/`libraryID`/`name`.
      available: current.available,
      unavailable: current.unavailable,
    });
  };
}

const guideHandler: CliHandler = (params: CliData): string => {
  const request = decodeCliParams(params, noCliParams, {
    command: LIBRARY_SCOPE_GUIDE_COMMAND,
  });
  if (request.kind === "invalid") {
    return invalidRequest(LIBRARY_SCOPE_GUIDE_COMMAND, request);
  }
  return renderGuide();
};

function invalidRequest(
  command: LibraryScopeCommand,
  rejected: CliRejection,
): string {
  return envelope(command, {
    ok: false,
    diagnostic: {
      ...diagnostic("INVALID_SELECTOR", rejected.message, {
        parameter: rejected.parameter,
      }),
      ...(rejected.hint === undefined ? {} : { hint: rejected.hint }),
    },
  });
}

function renderGuide(): string {
  return [
    "zotlit:library-scope",
    "",
    "Reports the resolved Library Scope: which Zotero Libraries ZotLit reads",
    "Items from. Read-only, no parameters.",
    "",
    "Response:",
    "  { contractVersion, command, ok, ... }. contractVersion versions the",
    "  library-scope commands alone; every other zotlit:* namespace versions",
    "  its own CLI Contract independently.",
    "",
    "  ok: true",
    '    mode: "all" | "selected"',
    "    invalid: whether the saved value failed validation, so the report",
    "      describes the runtime My Library fallback rather than the saved value",
    "    available: Libraries the connected Zotero source holds that are in",
    "      scope, each { selector, libraryID, name }",
    "    unavailable: selected selectors the connected source holds no",
    "      Library for",
    "  ok: false",
    "    diagnostic: { code, message, hint, details? }",
    "      DATABASE_UNREADABLE: the connected Zotero source cannot be read",
    "        right now; retry once it is.",
    "      INVALID_SELECTOR: an unrecognized parameter was passed; this",
    "        command and zotlit:library-scope-guide both take none.",
    "",
    "zotlit:library-scope-guide",
    "",
    "Prints this page. Read-only, no parameters.",
  ].join("\n");
}
