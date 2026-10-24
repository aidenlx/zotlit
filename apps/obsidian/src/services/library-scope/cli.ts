// Registers the `zotlit:library-scope` commands with Obsidian's CLI.
//
// Command, guide, and diagnostic text is all hardcoded English: an
// agent-facing contract surface, not localized UI. See
// apps/obsidian/policies/cli-text.md.

import type { CliData } from "obsidian";

import type { CliCommandHandler, CliHost } from "@/lib/cli-command";
import { createCliDiagnostics } from "@/lib/cli-diagnostic";
import { catchRejection, decodeCliParams, noCliParams } from "@/lib/cli-params";
import type { CliRejection } from "@/lib/cli-params";
import { Effect, Layer } from "@/lib/effect";
import { PluginHost } from "@/lib/plugin-host";

import { LibraryScope } from "./service";

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
 * the recovery action its diagnostic carries.
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

const { diagnostic, rejectionDiagnostic } = createCliDiagnostics<
  typeof DIAGNOSTIC_HINTS,
  Diagnostic["details"]
>(DIAGNOSTIC_HINTS, "INVALID_SELECTOR");

function envelope(command: LibraryScopeCommand, tail: object): string {
  return JSON.stringify({
    contractVersion: CONTRACT_VERSION,
    command,
    ...tail,
  });
}

interface LibraryScopeCliDeps {
  libraryScope: Pick<LibraryScope["Service"], "current">;
}

/**
 * The `zotlit:library-scope` commands, for e2e: they read the resolved
 * Library Scope after a Scope Case switch through the plugin's own CLI
 * Contract surface rather than an internal eval. A dev-build diagnostic port,
 * never registered in a production build.
 */
export const layerLibraryScopeCli: Layer.Layer<
  never,
  never,
  PluginHost | LibraryScope
> = __DEV__
  ? Layer.effectDiscard(
      Effect.gen(function* () {
        registerLibraryScopeCli(yield* PluginHost, {
          libraryScope: yield* LibraryScope,
        });
      }),
    )
  : Layer.empty;

export function registerLibraryScopeCli(
  host: CliHost,
  deps: LibraryScopeCliDeps,
): void {
  host.registerCliCommand(LIBRARY_SCOPE_COMMAND, {
    description:
      "Report the resolved Library Scope: mode, available Libraries, and unavailable selectors",
    flags: null,
    handler: createLibraryScopeHandler(deps),
  });
  host.registerCliCommand(LIBRARY_SCOPE_GUIDE_COMMAND, {
    description: "Print the zotlit:library-scope CLI guide",
    flags: null,
    handler: guideHandler,
  });
}

function createLibraryScopeHandler(
  deps: LibraryScopeCliDeps,
): CliCommandHandler {
  return Effect.fn("LibraryScopeCli.report")(function* (params: CliData) {
    yield* decodeCliParams(params, noCliParams, {
      command: LIBRARY_SCOPE_COMMAND,
    });

    const current = yield* deps.libraryScope.current;
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
  }, answerRejection(LIBRARY_SCOPE_COMMAND));
}

const guideHandler: CliCommandHandler = (params) =>
  decodeCliParams(params, noCliParams, {
    command: LIBRARY_SCOPE_GUIDE_COMMAND,
  }).pipe(
    Effect.as(renderGuide()),
    answerRejection(LIBRARY_SCOPE_GUIDE_COMMAND),
  );

/** A rejected request answers its diagnostic envelope. */
const answerRejection = (command: LibraryScopeCommand) =>
  catchRejection((rejected) => invalidRequest(command, rejected));

function invalidRequest(
  command: LibraryScopeCommand,
  rejected: CliRejection,
): string {
  return envelope(command, {
    ok: false,
    diagnostic: rejectionDiagnostic(rejected),
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
