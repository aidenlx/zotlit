// Rewrites every Profile entry's packed partials from the Directory's partial entries.

import { isMap, isScalar, parseDocument, stringify } from "yaml";

import { literatureNoteTemplateManifestRange } from "@zotlit/templates/facade";
import type { LiteratureNoteTemplateManifest } from "@zotlit/templates/facade";

import { loadTemplateDirectory } from "./load.ts";
import type { DirectoryFiles } from "./load.ts";

/**
 * The Profile artifacts whose packed partials no longer match the partial
 * entries, each with its re-packed content, keyed by Directory path. A
 * Profile packs exactly the partials it reaches, sorted by name, each
 * byte-identical to the partial entry of that name; every other byte of its
 * document stays as written.
 */
export function repackTemplateDirectory(
  files: DirectoryFiles,
): Map<string, string> {
  const { entries } = loadTemplateDirectory(files);
  const partials = new Map(
    entries.flatMap((entry) =>
      entry.kind === "partial"
        ? [
            [
              entry.slug,
              {
                name: entry.slug,
                language: entry.language,
                source: entry.source,
              },
            ] as const,
          ]
        : [],
    ),
  );
  const changes = new Map<string, string>();
  for (const entry of entries) {
    if (entry.kind !== "profile") continue;
    const packed = entry.calls.flatMap((name) => {
      const partial = partials.get(name);
      return partial ? [partial] : [];
    });
    const source = entry.artifact.source;
    const repacked = withPackedPartials(source, packed);
    if (repacked !== source) {
      changes.set(`${entry.id}/${entry.artifact.fileName}`, repacked);
    }
  }
  return changes;
}

/** Replace the manifest's `partials` key, or add it last, leaving every other byte alone. */
function withPackedPartials(
  source: string,
  partials: NonNullable<LiteratureNoteTemplateManifest["partials"]>,
): string {
  const { from, to } = literatureNoteTemplateManifestRange(source);
  const manifest = source.slice(from, to);
  const document = parseDocument(manifest);
  if (!isMap(document.contents)) return source;
  const pair = document.contents.items.find(
    ({ key }) => isScalar(key) && key.value === "partials",
  );
  const block =
    partials.length === 0
      ? ""
      : stringify({ partials }, { lineWidth: 0, blockQuote: "literal" });
  if (!pair) return source.slice(0, to) + block + source.slice(to);

  const keyStart = isScalar(pair.key) ? pair.key.range![0] : 0;
  const lineStart = manifest.lastIndexOf("\n", keyStart - 1) + 1;
  const valueEnd = (pair.value as { range?: [number, number, number] })
    .range![2];
  const lineEnd = manifest.indexOf("\n", valueEnd - 1);
  const end = lineEnd === -1 ? manifest.length : lineEnd + 1;
  return source.slice(0, from + lineStart) + block + source.slice(from + end);
}
