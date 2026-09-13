import { parseLiteratureNoteTemplate } from "./literature-note-template";
import type {
  LiteratureNoteTemplateDocument,
  LiteratureNoteTemplateManifest,
  LiteratureNoteTemplatePartial,
} from "./literature-note-template";
import { updateLiteratureNoteTemplateManifestKeys } from "./literature-note-template-manifest-edit";
import { formatPlainTemplateDocument } from "./plain-template-document";

export type { LiteratureNoteTemplatePartial } from "./literature-note-template";

export type LiteratureNotePackErrorCode =
  | "match-changed"
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

/**
 * What one bundled partial does to the vault's own Shared Partial files:
 * `write` for a name no document answers, `unchanged` for a document that
 * already holds this very source under this very language, `conflict` for one
 * that holds something else, which only a keep-or-replace answer settles,
 * `refused` for a name no Shared Partial file can be given, and `other-case`
 * for a name the vault's own files answer only under another case — one file
 * answers both spellings on a case-insensitive filesystem while a call
 * resolves by exact name. The last two reach no vault path and keep their
 * transport copy.
 */
export type LiteratureNotePartialUnpackVerdict =
  | "write"
  | "unchanged"
  | "conflict"
  | "refused"
  | "other-case";

/** One bundled partial and the file it unpacks to. */
export interface LiteratureNotePartialUnpack {
  readonly name: string;
  readonly verdict: LiteratureNotePartialUnpackVerdict;
  /** The plain Template Document bytes the partial's own file holds. */
  readonly document: string;
}

/**
 * Decide what the manifest's transport copy of each partial does to the files
 * a vault already holds, so a caller writes what is new, leaves identical text
 * alone, and asks about the rest before any byte of the reader's own file goes.
 *
 * @param held - what the vault holds under each name, keyed by name: a name
 *   the map does not carry has no document, and one mapped to `null` has a
 *   document whose text is unavailable, which reads as a conflict.
 * @param accepts - whether a name a bundle brings may become a file of its
 *   own. A name held under a document of the vault's own is settled before
 *   this is asked, so a reserved name still reads as `unchanged`.
 */
export function unpackLiteratureNotePartials(
  bundled: readonly LiteratureNoteTemplatePartial[],
  held: ReadonlyMap<
    string,
    Pick<LiteratureNoteTemplatePartial, "language" | "source"> | null
  >,
  accepts: (name: string) => boolean = () => true,
): LiteratureNotePartialUnpack[] {
  return bundled.map((partial) => {
    const current = held.get(partial.name);
    const verdict: LiteratureNotePartialUnpackVerdict = !held.has(partial.name)
      ? accepts(partial.name)
        ? "write"
        : "refused"
      : current?.language === partial.language &&
          current.source === partial.source
        ? "unchanged"
        : "conflict";
    return {
      name: partial.name,
      verdict,
      document: formatPlainTemplateDocument(partial.source, partial.language),
    };
  });
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

/**
 * Every name a document's own templates call, sorted, before any bundle
 * resolves them. A name another Template already answers — the document's own
 * Annotation Section among them — is a call this scan reports all the same:
 * which of them can be a Shared Partial is the caller's own list to hold, and
 * this package carries none.
 */
export function literatureNoteTemplateDependencies(
  document: LiteratureNoteTemplateDocument,
): string[] {
  const names = [
    document.body,
    document.annotationSection.source,
    document.manifest.filename,
  ].flatMap(referencedPartialNames);
  return [...new Set(names)].sort();
}

/** The fields Share and Import can change while retaining authored template text. */
export function updateLiteratureNotePackMetadata(
  source: string,
  changes: Partial<
    Pick<
      LiteratureNoteTemplateManifest,
      | "id"
      | "name"
      | "version"
      | "author"
      | "description"
      | "folder"
      | "citationStyle"
      | "importFolder"
      | "importColoredHighlights"
      | "importAnnotationsAsTemplate"
      | "partials"
    >
  >,
  options: { readonly includeMatch?: boolean } = {},
): string {
  const original = parseLiteratureNoteTemplate(source).manifest;
  const edits = Object.fromEntries(
    Object.entries({
      ...changes,
      ...(options.includeMatch === false ? { match: undefined } : {}),
    }).filter(
      ([key, value]) =>
        JSON.stringify(
          original[key as keyof LiteratureNoteTemplateManifest],
        ) !== JSON.stringify(value),
    ),
  );
  const content = updateLiteratureNoteTemplateManifestKeys(source, edits);
  if (
    options.includeMatch !== false &&
    JSON.stringify(parseLiteratureNoteTemplate(content).manifest.match) !==
      JSON.stringify(original.match)
  )
    throw new LiteratureNotePackError(
      "match-changed",
      "These metadata changes would also change the match conditions.",
      {
        recovery:
          "Write the match conditions independently of the metadata before changing these fields.",
      },
    );
  return content;
}

/** Export reachable partials, keeping folder bindings only when requested. */
export function exportLiteratureNotePack(
  source: string,
  availablePartials: readonly LiteratureNoteTemplatePartial[],
  options: {
    readonly includeFolders?: boolean;
    readonly includeMatch?: boolean;
    /** Extra partial names to bundle, reachable or not. */
    readonly include?: readonly string[];
    /**
     * Reports a name no partial answers and keeps going, so a caller that
     * previews a draft bundles what it has. Absent, a missing name throws.
     */
    readonly onMissingPartial?: (name: string) => void;
  } = {},
): string {
  const document = parseLiteratureNoteTemplate(source);
  const available = new Map(
    [...availablePartials, ...(document.manifest.partials ?? [])].map(
      (partial) => [partial.name, partial],
    ),
  );
  const bundled = new Map<string, LiteratureNoteTemplatePartial>();
  const reported = new Set<string>();
  const pending = [
    ...(options.include ?? []),
    ...[
      document.body,
      document.annotationSection.source,
      document.manifest.filename,
    ].flatMap(referencedPartialNames),
  ];
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (name === "annotation" || bundled.has(name)) continue;
    const partial = available.get(name);
    if (!partial) {
      if (options.onMissingPartial) {
        if (!reported.has(name)) {
          reported.add(name);
          options.onMissingPartial(name);
        }
        continue;
      }
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
  const stripFolders =
    !options.includeFolders &&
    (document.manifest.folder !== undefined ||
      document.manifest.importFolder !== undefined);
  if (bundled.size === 0 && !stripFolders && options.includeMatch !== false)
    return source;

  const partials = [...bundled.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return updateLiteratureNotePackMetadata(
    source,
    {
      ...(stripFolders ? { folder: undefined, importFolder: undefined } : {}),
      ...(bundled.size > 0 ? { partials } : {}),
    },
    { includeMatch: options.includeMatch },
  );
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
