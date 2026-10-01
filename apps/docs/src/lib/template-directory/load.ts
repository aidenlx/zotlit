// Reads the Template Directory's files into Directory Entries, naming every file that breaks the entry format.

import { regex } from "arkregex";
import * as v from "valibot";
import { parse as parseYaml } from "yaml";

import ir from "@zotlit/db/contract/ir.json" with { type: "json" };
import {
  parseLiteratureNoteTemplate,
  parsePlainTemplateDocument,
} from "@zotlit/templates/facade";
import type {
  LiteratureNoteTemplateManifest,
  ManagedFrontmatterEntry,
  TemplateLanguage,
} from "@zotlit/templates/facade";

import { reachableCalls } from "./calls.ts";
import { ENTRY_KINDS, ENTRY_METADATA_SCHEMAS } from "./entry.ts";
import type { EntryKind, EntryLevel, EntryMetadata } from "./entry.ts";
import type { DirectoryProblem } from "./problem.ts";
import { entryId, entryIdParts } from "./site.ts";

/** The Directory's files, keyed by `/`-separated path relative to its root. */
export type DirectoryFiles = ReadonlyMap<string, string>;

/** The maintainer guide at the Directory root. */
export const GUIDE_FILE = "README.md";
/** What a Directory Entry says about itself: facets as metadata, prose as the body. */
export const ENTRY_FILE = "entry.md";
/** The rendered samples the verification suite stores beside an entry. */
export const SAMPLES_FILE = "samples.md";

/** Names the plugin reserves for its own Template slots. */
const RESERVED_PARTIAL_NAMES = new Set([
  "filename",
  "note",
  "annotation",
  "content",
  "citation",
]);

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The `zt` contract the Workbench renders against, which every Profile entry states. */
export const CONTRACT_VERSION = ir.contractVersion;

interface EntryBase {
  /** `<kind folder>/<slug>`, unique across the Directory. */
  readonly id: string;
  readonly slug: string;
  readonly level: EntryLevel;
  readonly title: string;
  readonly summary: string;
  readonly minAppVersion: string;
  readonly tasks: EntryMetadata["tasks"];
  readonly itemTypes: readonly string[];
  readonly features: EntryMetadata["features"];
  readonly problems: readonly string[];
  readonly keywords: readonly string[];
  readonly recommended: boolean;
  readonly audience: string;
  readonly effort: string;
  /** The reader-facing description, Markdown. */
  readonly description: string;
  /** The file a reader imports or copies, byte for byte. */
  readonly artifact: { readonly fileName: string; readonly source: string };
  /** Every Shared Partial the artifact calls, directly or through a partial. */
  readonly calls: readonly string[];
}

export type DirectoryEntry = EntryBase &
  (
    | {
        readonly kind: "profile";
        readonly manifest: LiteratureNoteTemplateManifest;
      }
    | {
        readonly kind: "partial";
        readonly context: EntryMetadata<"partial">["context"];
        /** The Liquid a Profile writes to call the partial, when the entry states one. */
        readonly call: string | undefined;
        readonly language: TemplateLanguage;
        /** The template source below the document's manifest. */
        readonly source: string;
      }
    | {
        readonly kind: "citation";
        readonly language: TemplateLanguage;
        readonly source: string;
      }
    | { readonly kind: "note-name"; readonly source: string }
    | {
        readonly kind: "property";
        readonly property: ManagedFrontmatterEntry;
        readonly expected: EntryMetadata<"property">["expected"];
      }
  );

export interface LoadedDirectory {
  readonly entries: readonly DirectoryEntry[];
  readonly problems: readonly DirectoryProblem[];
}

/**
 * Read every Directory Entry out of the Directory's files. An entry whose
 * metadata or artifact fails to parse is left out and named in `problems`.
 */
export function loadTemplateDirectory(files: DirectoryFiles): LoadedDirectory {
  const problems: DirectoryProblem[] = [];
  const folders = new Map<string, Map<string, string>>();
  for (const [path, content] of files) {
    const segments = path.split("/");
    const kind = kindOfFolder(segments[0]!);
    if (segments.length === 1 && path === GUIDE_FILE) continue;
    if (segments.length !== 3 || kind === undefined) {
      problems.push({
        entry: path,
        code: "unexpected-file",
        message: `${path} is outside every entry folder. An entry lives at <kind folder>/<slug>/, where the kind folder is one of ${Object.values(
          ENTRY_KINDS,
        )
          .map(({ folder }) => folder)
          .join(", ")}.`,
      });
      continue;
    }
    const id = entryId(segments[0]!, segments[1]!);
    const folder = folders.get(id) ?? new Map<string, string>();
    folder.set(segments[2]!, content);
    folders.set(id, folder);
  }

  const drafts = [...folders]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([id, folder]) => {
      const draft = readEntry(id, folder);
      problems.push(...draft.problems);
      return draft.entry ? [draft.entry] : [];
    });
  const partials = new Map(
    drafts.flatMap((draft) =>
      draft.kind === "partial" ? [[draft.slug, draft.source] as const] : [],
    ),
  );
  const entries = drafts.map(
    ({ callers, ...entry }) =>
      ({
        ...entry,
        calls: reachableCalls(callers, partials),
      }) as DirectoryEntry,
  );
  return { entries, problems };
}

function kindOfFolder(folder: string): EntryKind | undefined {
  return (Object.keys(ENTRY_KINDS) as EntryKind[]).find(
    (kind) => ENTRY_KINDS[kind].folder === folder,
  );
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** An entry before its calls resolve: `callers` are the sources whose calls count. */
type EntryDraft = DistributiveOmit<DirectoryEntry, "calls"> & {
  readonly callers: readonly string[];
};

/** The kind-specific half of an entry, read from its artifact. */
type ArtifactPart = DistributiveOmit<DirectoryEntry, keyof EntryBase>;

/** What an entry states about itself: a recipe in its metadata, a Profile in its manifest. */
type StatedPart = Pick<EntryBase, "title" | "summary" | "minAppVersion">;

function readEntry(
  id: string,
  folder: ReadonlyMap<string, string>,
): { entry?: EntryDraft; problems: DirectoryProblem[] } {
  const [kindFolder, slug] = entryIdParts(id);
  const kind = kindOfFolder(kindFolder)!;
  const artifactName = ENTRY_KINDS[kind].artifact(slug);
  const problem = (
    code: DirectoryProblem["code"],
    message: string,
  ): { problems: DirectoryProblem[] } => ({
    problems: [{ entry: id, code, message }],
  });

  if (!SLUG.test(slug)) {
    return problem(
      "invalid-slug",
      `The folder name "${slug}" must be lowercase words joined by hyphens.`,
    );
  }
  if (kind === "partial" && RESERVED_PARTIAL_NAMES.has(slug)) {
    return problem(
      "reserved-partial-name",
      `"${slug}" is a name the plugin reserves; a partial entry needs another.`,
    );
  }
  const stray = [...folder.keys()].filter(
    (name) => ![ENTRY_FILE, SAMPLES_FILE, artifactName].includes(name),
  );
  if (stray.length > 0) {
    return problem(
      "unexpected-file",
      `${stray.join(", ")} ${stray.length === 1 ? "is" : "are"} not part of a ${kind} entry, which holds ${ENTRY_FILE}, ${artifactName}, and ${SAMPLES_FILE}.`,
    );
  }
  const entryFile = folder.get(ENTRY_FILE);
  const artifact = folder.get(artifactName);
  if (entryFile === undefined || artifact === undefined) {
    return problem(
      "missing-file",
      `A ${kind} entry needs both ${ENTRY_FILE} and ${artifactName}.`,
    );
  }

  const described = readEntryFile(entryFile, kind);
  if (!described.ok) return problem("invalid-metadata", described.message);
  const { metadata, description } = described;
  const common = {
    id,
    slug,
    level: kind === "profile" ? "ready-to-use" : "customize",
    tasks: metadata.tasks,
    itemTypes: metadata.itemTypes,
    features: metadata.features,
    problems: metadata.problems,
    keywords: metadata.keywords,
    recommended: metadata.recommended,
    audience: metadata.audience,
    effort: metadata.effort,
    description,
    artifact: { fileName: artifactName, source: artifact },
  } as const;

  try {
    const { part, callers } = readArtifact(kind, artifact, metadata);
    const entry: EntryDraft = {
      ...common,
      ...statedPart(part, metadata),
      ...part,
      callers,
    };
    return { entry, problems: [] };
  } catch (error) {
    return problem(
      "invalid-artifact",
      `${artifactName} does not parse: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Parse an entry's artifact by its kind. Throws when the artifact does not
 * parse; `callers` are the sources whose partial calls count.
 */
function readArtifact(
  kind: EntryKind,
  artifact: string,
  metadata: EntryMetadata,
): { part: ArtifactPart; callers: readonly string[] } {
  switch (kind) {
    case "profile": {
      const document = parseLiteratureNoteTemplate(artifact);
      const { manifest } = document;
      return {
        part: { kind, manifest },
        callers: [
          document.body,
          document.annotationSection.source,
          manifest.filename,
        ],
      };
    }
    case "partial": {
      const { manifest, source } = parsePlainTemplateDocument(artifact);
      const { context, call } = metadata as EntryMetadata<"partial">;
      return {
        part: { kind, context, call, language: manifest.language, source },
        callers: [source],
      };
    }
    case "citation": {
      const { manifest, source } = parsePlainTemplateDocument(artifact);
      return {
        part: { kind, language: manifest.language, source },
        callers: [source],
      };
    }
    case "note-name":
      parseLiteratureNoteTemplate(harnessProfile({ filename: artifact }));
      return { part: { kind, source: artifact }, callers: [artifact] };
    case "property": {
      const [property] =
        parseLiteratureNoteTemplate(
          harnessProfile({ frontmatter: [parseYaml(artifact) as unknown] }),
        ).manifest.frontmatter ?? [];
      if (property === undefined) {
        throw new Error("it holds no Managed Frontmatter entry.");
      }
      const { expected } = metadata as EntryMetadata<"property">;
      return { part: { kind, property, expected }, callers: [] };
    }
  }
}

function statedPart(part: ArtifactPart, metadata: EntryMetadata): StatedPart {
  if ("title" in metadata) {
    const { title, summary, minAppVersion } = metadata;
    return { title, summary, minAppVersion };
  }
  const manifest = part.kind === "profile" ? part.manifest : undefined;
  return {
    title: manifest?.name ?? "",
    summary: manifest?.description ?? "",
    minAppVersion: manifest?.minAppVersion ?? "",
  };
}

/**
 * A Profile document that holds nothing but what it is given, so a recipe is
 * parsed and rendered by the same code a Profile of the reader's own is.
 */
export function harnessProfile({
  filename = "{{ zt.key }}",
  frontmatter,
  body = "{% managed %}\n{% endmanaged %}\n",
  annotation = "{{ zt.text }}\n",
}: {
  filename?: string;
  frontmatter?: readonly unknown[];
  body?: string;
  annotation?: string;
}): string {
  const manifest = {
    id: "DirHarness01",
    name: "Template Directory harness",
    version: "1",
    contract: CONTRACT_VERSION,
    filename,
    ...(frontmatter ? { frontmatter } : {}),
  };
  return `---\n${JSON.stringify(manifest, null, 2)}\n---\n${body}\n--- zotlit:annotation ---\n${annotation}`;
}

type ReadEntryFile =
  | { ok: true; metadata: EntryMetadata; description: string }
  | { ok: false; message: string };

const ENTRY_FILE_PARTS = regex(
  "^---\r?\n(?<yaml>[\\s\\S]*?)\r?\n---\r?\n(?<body>[\\s\\S]*)$",
);

function readEntryFile(content: string, kind: EntryKind): ReadEntryFile {
  const match = ENTRY_FILE_PARTS.exec(content);
  if (!match) {
    return {
      ok: false,
      message: `${ENTRY_FILE} must open with its metadata between two "---" lines.`,
    };
  }
  let raw: unknown;
  try {
    raw = parseYaml(match.groups.yaml);
  } catch (error) {
    return {
      ok: false,
      message: `${ENTRY_FILE} metadata is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const result = v.safeParse(ENTRY_METADATA_SCHEMAS[kind], raw);
  if (!result.success) {
    return {
      ok: false,
      message: result.issues
        .map(
          (issue) => `${v.getDotPath(issue) ?? "metadata"}: ${issue.message}`,
        )
        .join("; "),
    };
  }
  const description = match.groups.body.trim();
  if (description === "") {
    return {
      ok: false,
      message: `${ENTRY_FILE} needs a reader-facing description below its metadata.`,
    };
  }
  return { ok: true, metadata: result.output, description };
}
