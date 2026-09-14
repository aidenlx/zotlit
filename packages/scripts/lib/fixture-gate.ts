// Integrity gate for a reset Development Vault.
//
// A reset that rebuilds the seed and reopens the vault can still leave ZotLit
// reading this machine's own Zotero library: the vault-scoped Device Overrides
// are what point it at the Fixture, and a plain synchronize does not write
// them. Every later run then reads the wrong database while looking healthy.
//
// The gate asks the three questions that separate a usable reset from that
// silent failure — which database the plugin answers from, how many Libraries
// it sees, and whether the Fixture Items a run renders resolve — and fails
// closed on each. It drives ZotLit's own CLI commands, so the caller supplies
// a runner and every call carries that runner's bound.

/**
 * Items the gate resolves through the Template Workbench: the Workbench sample
 * book, a book whose Venue is its publisher, and the Item behind the stamped
 * Books Literature Note. Between them they read Item fields, creators, and a
 * Profile stamp, so a database that answers for all three is readable.
 */
export const FIXTURE_GATE_ITEM_KEYS = [
  "NW2CPDTC",
  "BKPUBLR4",
  "BBBB2222",
] as const;

const TEMPLATE_STATUS_COMMAND = "zotlit:template-status";
const LIBRARY_SCOPE_COMMAND = "zotlit:library-scope";
const TEMPLATE_DATA_COMMAND = "zotlit:template-data";

export interface FixtureGateEffects {
  /** Run one ZotLit CLI command in the reset vault and return its answer. */
  runCommand: (command: string, params?: readonly string[]) => Promise<string>;
}

export interface FixtureGateExpectation {
  /** Absolute path of the Fixture database the vault must answer from. */
  databasePath: string;
  /** Libraries the Scope Case puts in scope. */
  libraryCount: number;
  /** Fixture Item keys to resolve; defaults to {@link FIXTURE_GATE_ITEM_KEYS}. */
  itemKeys?: readonly string[];
}

/** What the vault answered, once every assertion held. */
export interface FixtureGateReport {
  databasePath: string;
  libraries: number;
  items: readonly string[];
}

interface Diagnostic {
  code?: string;
  message?: string;
}

interface Envelope {
  ok?: boolean;
  diagnostic?: Diagnostic;
}

interface TemplateStatusReply extends Envelope {
  identity?: { source?: { databasePath?: string } };
}

interface LibraryScopeReply extends Envelope {
  available?: unknown[];
}

/** A CLI answer that is not an envelope is a failure, not an empty result. */
function parseEnvelope<T extends Envelope>(command: string, answer: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    throw new Error(
      `${command} did not answer with a CLI envelope: ${answer.trim() || "(no output)"}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${command} answered ${answer.trim()}, not an envelope.`);
  }
  return parsed as T;
}

function describeDiagnostic({ diagnostic }: Envelope): string {
  if (!diagnostic) return "no diagnostic";
  return [diagnostic.code, diagnostic.message].filter(Boolean).join(": ");
}

export async function runFixtureGate(
  { runCommand }: FixtureGateEffects,
  {
    databasePath,
    libraryCount,
    itemKeys = FIXTURE_GATE_ITEM_KEYS,
  }: FixtureGateExpectation,
): Promise<FixtureGateReport> {
  const status = parseEnvelope<TemplateStatusReply>(
    TEMPLATE_STATUS_COMMAND,
    await runCommand(TEMPLATE_STATUS_COMMAND),
  );
  const answeredFrom = status.identity?.source?.databasePath;
  if (answeredFrom !== databasePath) {
    throw new Error(
      `${TEMPLATE_STATUS_COMMAND} answers from ${answeredFrom ?? "no database"}, not the Fixture database ${databasePath}.\n\n` +
        "The vault-scoped Device Overrides are absent, so ZotLit reads this\n" +
        "machine's own Zotero library. Reset the vault with\n" +
        "`obsidian-vault.ts reset --vault-case <id>`, which writes them.",
    );
  }

  const scope = parseEnvelope<LibraryScopeReply>(
    LIBRARY_SCOPE_COMMAND,
    await runCommand(LIBRARY_SCOPE_COMMAND),
  );
  const libraries = scope.available?.length ?? 0;
  if (libraries !== libraryCount) {
    throw new Error(
      `${LIBRARY_SCOPE_COMMAND} reports ${libraries} available of the Fixture's ${libraryCount} ` +
        `${libraryCount === 1 ? "Library" : "Libraries"} (${describeDiagnostic(scope)}). ` +
        "The database is incomplete.",
    );
  }

  for (const key of itemKeys) {
    const data = parseEnvelope<Envelope>(
      TEMPLATE_DATA_COMMAND,
      await runCommand(TEMPLATE_DATA_COMMAND, [`key=${key}`, "root=note"]),
    );
    if (data.ok !== true) {
      throw new Error(
        `${TEMPLATE_DATA_COMMAND} cannot resolve Fixture Item ${key} (${describeDiagnostic(data)}). ` +
          "The database is incomplete.",
      );
    }
  }

  return { databasePath: answeredFrom, libraries, items: itemKeys };
}
