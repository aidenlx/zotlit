import { stringify as stringifyYaml } from "yaml";

import { parseLiteratureNoteTemplate } from "./literature-note-template";
import type { LiteratureNoteTemplatePartial } from "./literature-note-template";

export type { LiteratureNoteTemplatePartial } from "./literature-note-template";

export type LiteratureNotePackErrorCode =
  | "missing-partial"
  | "install-refused"
  | "revert-refused";

export class LiteratureNotePackError extends Error {
  readonly code: LiteratureNotePackErrorCode;
  readonly recovery: string;

  constructor(
    code: LiteratureNotePackErrorCode,
    message: string,
    options: ErrorOptions & { recovery: string },
  ) {
    super(message, options);
    this.name = "LiteratureNotePackError";
    this.code = code;
    this.recovery = options.recovery;
  }
}

export interface LiteratureNotePackFile {
  readonly key: string;
  readonly source: string;
}

export interface ParsedLiteratureNotePack {
  readonly pack: { readonly id: string; readonly version: string };
  readonly files: readonly LiteratureNotePackFile[];
}

/** Materialize one shared document into its document and bundled-partial files. */
export function parseLiteratureNotePack(
  reference: string,
  source: string,
): ParsedLiteratureNotePack {
  const document = parseLiteratureNoteTemplate(source);
  return {
    pack: {
      id: document.manifest.id,
      version: document.manifest.version,
    },
    files: [
      { key: `document:${reference}`, source },
      ...(document.manifest.partials ?? []).map((partial) => ({
        key: `partial:${partial.name}:${partial.language}`,
        source: partial.source,
      })),
    ],
  };
}

export interface LiteratureNotePackCurrentFile {
  readonly key: string;
  readonly source: string | null;
  readonly builtIn: boolean;
}

export type LiteratureNotePackPreviousState =
  | { readonly kind: "absent" | "built-in" }
  | {
      readonly kind: "user-file" | "prior-pack";
      readonly source: string;
    };

export interface LiteratureNotePackInstallRecord {
  readonly pack: { readonly id: string; readonly version: string };
  readonly files: readonly {
    readonly key: string;
    readonly installedSource: string;
    readonly previous: LiteratureNotePackPreviousState;
  }[];
}

export interface LiteratureNotePackDiffRow {
  readonly key: string;
  readonly previous: LiteratureNotePackPreviousState["kind"];
  readonly verdict: "apply" | "unchanged" | "refuse";
  readonly currentSource: string | null;
  readonly candidateSource: string;
}

/** Export one document, embedding only its reachable transitive partials. */
export function exportLiteratureNotePack(
  source: string,
  availablePartials: readonly LiteratureNoteTemplatePartial[],
): string {
  const document = parseLiteratureNoteTemplate(source);
  const available = new Map(
    availablePartials.map((partial) => [partial.name, partial]),
  );
  const bundled = new Map<string, LiteratureNoteTemplatePartial>();
  const pending = referencedPartialNames(
    `${document.body}\n${document.manifest.filename}`,
  );
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (bundled.has(name)) continue;
    const partial = available.get(name);
    if (!partial) {
      throw new LiteratureNotePackError(
        "missing-partial",
        `Literature Note Template references missing partial '${name}'`,
        {
          recovery: "Add the missing partial, then export the Pack again.",
        },
      );
    }
    bundled.set(name, partial);
    pending.push(...referencedPartialNames(partial.source));
  }
  if (bundled.size === 0) return source;

  const partials = [...bundled.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const manifest = stringifyYaml(
    { ...document.manifest, partials },
    { lineWidth: 0 },
  );
  return `---\n${manifest}---\n${document.body}`;
}

/** Compare candidate bytes with effective files and prior Pack ownership. */
export function diffLiteratureNotePack(
  candidate: readonly LiteratureNotePackFile[],
  current: readonly LiteratureNotePackCurrentFile[],
  options: {
    readonly overwrite?: readonly string[];
    readonly prior?: LiteratureNotePackInstallRecord;
  } = {},
): LiteratureNotePackDiffRow[] {
  const currentByKey = new Map(current.map((file) => [file.key, file]));
  const priorByKey = new Map(
    options.prior?.files.map((file) => [file.key, file]) ?? [],
  );
  const overwrite = new Set(options.overwrite);
  return candidate.map((file) => {
    const effective = currentByKey.get(file.key) ?? {
      key: file.key,
      source: null,
      builtIn: false,
    };
    const prior = priorByKey.get(file.key);
    const previous =
      effective.source === null
        ? "absent"
        : effective.builtIn
          ? "built-in"
          : prior?.installedSource === effective.source
            ? "prior-pack"
            : "user-file";
    const verdict =
      effective.source === file.source
        ? "unchanged"
        : previous === "user-file" && !overwrite.has(file.key)
          ? "refuse"
          : "apply";
    return {
      key: file.key,
      previous,
      verdict,
      currentSource: effective.source,
      candidateSource: file.source,
    };
  });
}

/** Create the durable exact-byte replacement record after an accepted diff. */
export function createLiteratureNotePackInstallRecord(
  pack: LiteratureNotePackInstallRecord["pack"],
  candidate: readonly LiteratureNotePackFile[],
  diff: readonly LiteratureNotePackDiffRow[],
): LiteratureNotePackInstallRecord {
  const diffByKey = new Map(diff.map((row) => [row.key, row]));
  const refused = diff.find((row) => row.verdict === "refuse");
  if (refused) {
    throw new LiteratureNotePackError(
      "install-refused",
      `Pack install would overwrite user file '${refused.key}'`,
      {
        recovery: "Approve that file explicitly, then apply the Pack again.",
      },
    );
  }
  return {
    pack,
    files: candidate.map((file) => {
      const row = diffByKey.get(file.key)!;
      const previous: LiteratureNotePackPreviousState =
        row.previous === "absent" || row.previous === "built-in"
          ? { kind: row.previous }
          : { kind: row.previous, source: row.currentSource! };
      return { key: file.key, installedSource: file.source, previous };
    }),
  };
}

export type LiteratureNotePackRevertAction =
  | { readonly key: string; readonly action: "trash" }
  | {
      readonly key: string;
      readonly action: "restore";
      readonly source: string;
    };

/** Refuse edited installed files; otherwise restore exact prior bytes. */
export function planLiteratureNotePackRevert(
  record: LiteratureNotePackInstallRecord,
  current: readonly LiteratureNotePackFile[],
): LiteratureNotePackRevertAction[] {
  const currentByKey = new Map(current.map((file) => [file.key, file.source]));
  return record.files.map((file) => {
    if (currentByKey.get(file.key) !== file.installedSource) {
      throw new LiteratureNotePackError(
        "revert-refused",
        `Installed Pack file '${file.key}' was edited after installation`,
        {
          recovery:
            "Back up the edited file or approve its removal, then revert again.",
        },
      );
    }
    const previous = file.previous;
    if (!("source" in previous)) {
      return { key: file.key, action: "trash" };
    }
    return {
      key: file.key,
      action: "restore",
      source: previous.source,
    };
  });
}

function referencedPartialNames(source: string): string[] {
  return [
    ...quotedNamesAfter(source, "render"),
    ...quotedNamesAfter(source, "include"),
  ];
}

function quotedNamesAfter(source: string, keyword: string): string[] {
  const names: string[] = [];
  let from = 0;
  while (from < source.length) {
    const start = source.indexOf(keyword, from);
    if (start === -1) break;
    let cursor = start + keyword.length;
    while (source[cursor] === " " || source[cursor] === "\t") cursor += 1;
    if (source[cursor] === "(") {
      cursor += 1;
      while (source[cursor] === " " || source[cursor] === "\t") cursor += 1;
    }
    const quote = source[cursor];
    if (quote === '"' || quote === "'") {
      const end = source.indexOf(quote, cursor + 1);
      if (end !== -1) names.push(source.slice(cursor + 1, end));
    }
    from = start + keyword.length;
  }
  return names;
}
