// The resolvers a Literature Note's template render calls: note paths and links, annotations, Child Notes.
import { Effect } from "effect";
import type { TFile } from "obsidian";

import { toTemplateCollection } from "@zotlit/db";
import type {
  ItemFacets,
  ItemTag,
  NoteResolvers,
  NoteSource,
  TemplateCollection,
  TemplateFilenameItemData,
} from "@zotlit/db";
import type { AttachmentPathContext } from "@zotlit/db/path";
import { joinNotePath } from "@zotlit/templates";

import { buildAnnotationResolvers } from "@/lib/annotation-render";
import { withLogCategory } from "@/lib/effect-log";
import { creatorSummary } from "@/lib/item-summary";
import { syntheticFile } from "@/lib/markdown-link";
import type { MarkdownLinker } from "@/lib/obsidian-file-manager";
import { Vault } from "@/lib/obsidian-vault";
import type { AttachmentImportBatch } from "@/services/attachment-import/service";
import type { PreparedExcerpts } from "@/services/excerpt-image/prepare";
import { childNoteLink } from "@/services/note-import/child-note-link";
import { NoteIndex } from "@/services/note-index/service";
import { getProfileBinding } from "@/services/profile/bindings";
import type { ProfileBindingSettings } from "@/services/profile/bindings";
import type { Settings } from "@/services/settings/schema";
import { Template } from "@/services/template/service";

import { baseNoteName } from "./filename";

const logged = withLogCategory("note-feature");

/** The services the note resolvers read during a render. */
export type NoteResolverServices = NoteIndex | Template | Vault;

/**
 * Runs one resolver read synchronously, inside the template render that
 * calls the resolver: `Effect.runSyncWith` over the write's context.
 */
export type NoteResolverRun = <A, E>(
  effect: Effect.Effect<A, E, NoteResolverServices>,
) => A;

interface NoteTarget {
  path: string;
  file: TFile;
}

/** An item's facets as its note filename reads them. */
export function templateFacets(facets: ItemFacets): {
  itemTags: readonly ItemTag[];
  itemCollections: TemplateCollection[];
} {
  return {
    itemTags: facets.tags,
    itemCollections: facets.collections.map(toTemplateCollection),
  };
}

/** The item's own tags and collections in `source`, for its note filename. */
export function itemFacets(
  source: NoteSource,
): ReturnType<typeof templateFacets> {
  const { itemID } = source.item;
  return templateFacets({
    tags: source.tagsByItemID.get(itemID) ?? [],
    collections: source.collectionsByItemID.get(itemID) ?? [],
  });
}

/**
 * The full resolver bundle for `item`'s note context, passed to
 * `@zotlit/db`'s `fetchNoteContext`: annotation resolvers, the literature-note
 * path/link/author-summary resolvers, and `zt.notes`' child-note link mapper.
 * The template render calls each resolver synchronously; `run` reads the
 * services for it.
 */
export function buildNoteResolvers(
  run: NoteResolverRun,
  options: {
    attachmentImport: Pick<AttachmentImportBatch, "decide" | "resolveLink">;
    settings: ProfileBindingSettings | null;
    sourcePath: string;
    zoteroPref: AttachmentPathContext;
    excerptImages?: PreparedExcerpts;
    /** The render's link call. */
    link: MarkdownLinker;
  },
): NoteResolvers {
  const resolvingFallback = new Set<string>();
  const resolveTarget = (item: TemplateFilenameItemData): NoteTarget =>
    resolveNoteTarget(run, item, {
      settings: options.settings,
      resolvingFallback,
    });
  const failed = (message: string, itemKey: string, error: unknown) =>
    run(
      Effect.logError(message).pipe(
        Effect.annotateLogs({ itemKey, error }),
        logged,
      ),
    );
  const generateMarkdownLink = (
    ...[file, sourcePath, subpath, alias]: [TFile, string, string?, string?]
  ) => options.link(file, sourcePath, { subpath, alias });

  return {
    annotation: buildAnnotationResolvers({
      zoteroPref: options.zoteroPref,
      attachmentImport: options.attachmentImport,
      annotationImageLink: options.excerptImages?.annotationImageLink,
    }),
    item: {
      authorsShort: creatorSummary,
      notePath: (item) => {
        try {
          return resolveTarget(item).path;
        } catch (error) {
          failed(
            "Failed to resolve literature note path",
            item.indexedKey,
            error,
          );
          return null;
        }
      },
      noteLink: (item, alias, subpath) => {
        try {
          const target = resolveTarget(item);
          return generateMarkdownLink(
            target.file,
            options.sourcePath,
            subpath,
            alias,
          );
        } catch (error) {
          failed(
            "Failed to resolve literature note link",
            item.indexedKey,
            error,
          );
          return null;
        }
      },
    },
    resolveChildNote: (note) =>
      childNoteLink(
        {
          importedNote: (noteKey) =>
            run(
              Effect.flatMap(NoteIndex, (noteIndex) =>
                noteIndex.getImportedNoteByNoteKey(noteKey),
              ),
            )[0],
          link: options.link,
        },
        note,
        options.sourcePath,
      ),
  };
}

function resolveNoteTarget(
  run: NoteResolverRun,
  item: TemplateFilenameItemData,
  options: {
    settings: Readonly<Settings> | null;
    resolvingFallback: Set<string>;
  },
): NoteTarget {
  const byItemKey = run(
    Effect.flatMap(NoteIndex, (noteIndex) =>
      noteIndex.getNotesByItemKey(item.indexedKey),
    ),
  )[0];
  if (byItemKey) return { path: byItemKey.path, file: byItemKey };

  const { settings, resolvingFallback } = options;
  if (settings === null) {
    throw new Error("Settings are not loaded");
  }

  if (resolvingFallback.has(item.indexedKey)) {
    throw new Error("Recursive literature note path resolution");
  }
  resolvingFallback.add(item.indexedKey);
  try {
    const folderSetting = getProfileBinding(settings, "note.literature-folder");
    // A synthetic link target must be deterministic, so drop any `suffix()`
    // marker to the base name.
    const rel = baseNoteName(
      run(
        Effect.flatMap(Template, (template) => template.renderFilename(item)),
      ),
    );
    const path = joinNotePath(folderSetting, rel);
    // This item has no indexed note (checked above), so an occupant at the
    // base path belongs to a different item. The real note's random `suffix()`
    // can't be predicted here, so linking to the occupant would point at the
    // wrong item — surface no target instead.
    if (
      run(Effect.flatMap(Vault, (vault) => vault.getAbstractFileByPath(path)))
    ) {
      throw new Error(
        `Cannot resolve a synthetic note path: ${path} is occupied by another note`,
      );
    }
    return { path, file: syntheticFile(path) };
  } finally {
    resolvingFallback.delete(item.indexedKey);
  }
}
