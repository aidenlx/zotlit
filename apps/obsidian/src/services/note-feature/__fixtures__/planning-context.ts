// The services creation planning reads, over a Note Feature test's plain deps.
import { Context, Effect } from "effect";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Vault } from "@/lib/obsidian-vault";
import { QueryService } from "@/services/item-query/service";
import type { PlainNoteIndex } from "@/services/note-index/plain";
import { NoteIndex } from "@/services/note-index/service";
import type { PlainProfile } from "@/services/profile/plain";
import { Profile } from "@/services/profile/service";
import { Template } from "@/services/template/service";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";
import { ZoteroReads } from "@/services/zotero-reads/service";

import type { NoteFeatureDeps } from "@/services/note-feature/context";
import type { CreationPlanningServices } from "@/services/note-feature/creation-planning";

/** The plain deps the planning services read, as a Note Feature test holds them. */
export interface PlanningSources {
  profile: Pick<PlainProfile, "profiles" | "resolveProfile" | "profileOf">;
  noteIndex: Pick<
    PlainNoteIndex,
    "whenIndexed" | "getNotesByItemKey" | "getImportedNoteByNoteKey"
  >;
  zoteroReads: Pick<PlainZoteroReads, "reads" | "snapshot">;
  template: Pick<
    NoteFeatureDeps["template"],
    "renderFilename" | "getLiteratureNoteTemplate" | "frontmatterFields"
  >;
  app: {
    vault: Pick<NoteFeatureDeps["app"]["vault"], "getAbstractFileByPath">;
    metadataCache: Pick<NoteFeatureDeps["app"]["metadataCache"], "getFileCache">;
  };
}

/**
 * The planning services over `sources`. Each member reads `sources` when it
 * runs, so a test may replace a dep after it builds the context. `query`
 * stands for ZotLit Query; without one, a query fails the test.
 */
export function planningContext(
  sources: PlanningSources,
  query?: QueryService["Service"],
): Context.Context<CreationPlanningServices> {
  return Context.make(
    Profile,
    stubService<Profile["Service"]>("Profile", {
      profiles: Effect.sync(() => sources.profile.profiles),
      resolveProfile: (selector) =>
        Effect.sync(() => sources.profile.resolveProfile(selector)),
      profileOf: (file) => Effect.sync(() => sources.profile.profileOf(file)),
    }),
  ).pipe(
    Context.add(
      NoteIndex,
      stubService<NoteIndex["Service"]>("NoteIndex", {
        whenIndexed: Effect.tryPromise(() =>
          sources.noteIndex.whenIndexed(),
        ).pipe(Effect.orDie),
        getNotesByItemKey: (key) =>
          Effect.sync(() => sources.noteIndex.getNotesByItemKey(key)),
        getImportedNoteByNoteKey: (key) =>
          Effect.sync(() => sources.noteIndex.getImportedNoteByNoteKey(key)),
      }),
    ),
    Context.add(
      ZoteroReads,
      stubService<ZoteroReads["Service"]>("ZoteroReads", {
        reads: sources.zoteroReads.reads,
        snapshot: Effect.suspend(() => sources.zoteroReads.snapshot),
      }),
    ),
    Context.add(
      Template,
      stubService<Template["Service"]>("Template", {
        renderFilename: (data) =>
          Effect.sync(() => sources.template.renderFilename(data)),
        getLiteratureNoteTemplate: (reference) =>
          Effect.sync(() =>
            sources.template.getLiteratureNoteTemplate(reference),
          ),
        frontmatterFields: Effect.sync(
          () => sources.template.frontmatterFields,
        ),
      }),
    ),
    Context.add(
      Vault,
      stubService<Vault["Service"]>("Vault", {
        getAbstractFileByPath: (path) =>
          Effect.sync(() => sources.app.vault.getAbstractFileByPath(path)),
      }),
    ),
    Context.add(
      MetadataCache,
      stubService<MetadataCache["Service"]>("MetadataCache", {
        fileCache: (file) =>
          Effect.sync(() => sources.app.metadataCache.getFileCache(file)),
      }),
    ),
    Context.add(
      QueryService,
      query ??
        stubService<QueryService["Service"]>("QueryService", {
          run: () => Effect.die(new Error("This test runs no query.")),
        }),
    ),
  );
}
