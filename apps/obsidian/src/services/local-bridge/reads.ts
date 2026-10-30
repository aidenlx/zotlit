// What the Local Bridge answers a connected page with: the Template schema, the
// selected Item as a redacted Snapshot, the selected Profile's exact source, the
// partials one draft calls, and the citation styles this Zotero has installed.
//
// Every answer is built from what a template renders. Absolute paths, note
// bodies, attachment contents, and image bytes are kept out by the shared
// exporter and by the vault-target module, and none is assembled here.
import { Effect, FiberSet, Schema } from "effect";
import type { FileSystem } from "effect";

import annotationSchema from "@zotlit/db/contract/annotation.schema.json" with { type: "json" };
import filenameSchema from "@zotlit/db/contract/filename.schema.json" with { type: "json" };
import noteSchema from "@zotlit/db/contract/note.schema.json" with { type: "json" };
import { TemplateFacade } from "@zotlit/templates/facade";
import type {
  InstalledCitationStyle,
  SelectedCitationStyleRequest,
  SelectedCitationStyleResponse,
  SelectedProfileResponse,
  TemplateDependenciesResponse,
  TemplateSchemaResponse,
} from "@zotlit/workbench/bridge";
import type {
  ItemSnapshot,
  SnapshotSelection,
} from "@zotlit/workbench/snapshot";

import { profileRevision } from "@/lib/profile-revision";
import { DEFAULT_PROFILE, isProfileId } from "@/lib/profile-stamp";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { NoteIndex } from "@/services/note-index/service";
import { listInstalledStyles } from "@/services/pandoc/installed-styles";
import { resolveInstalledStyle } from "@/services/pandoc/styles";
import { Profile } from "@/services/profile/service";
import { Template } from "@/services/template/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

import { profileDisplayName } from "./profile-name";
import type { SelectedItemIdentity } from "./sessions";
import { collectVaultTargets } from "./vault-targets";
import type { VaultTargetServices } from "./vault-targets";

/** The selected Profile no longer has a document in this vault. */
export class ProfileDocumentMissingError extends Schema.TaggedError<
  ProfileDocumentMissingError,
  { readonly brand: unique symbol }
>()("ProfileDocumentMissingError", {
  profileId: Schema.String,
  message: Schema.String,
}) {}

/** The selected Item is not in the library this vault reads. */
export class SelectedItemUnavailableError extends Schema.TaggedError<
  SelectedItemUnavailableError,
  { readonly brand: unique symbol }
>()("SelectedItemUnavailableError", {
  key: Schema.String,
  message: Schema.String,
}) {}

export const profileDocumentMissing = (
  profileId: string,
): ProfileDocumentMissingError =>
  new ProfileDocumentMissingError({
    profileId,
    message: `Profile '${profileId}' has no document in this vault.`,
  });

/** The services every read answers from. */
export type BridgeReadServices =
  | VaultTargetServices
  | Profile
  | Template
  | ZoteroReads
  | FileSystem.FileSystem;

/** Who answers a connected Snapshot: this device's id and the vault's name. */
export interface BridgeProvenance {
  /** The device id the page keys its drafts on, minted by the service. */
  readonly installationId: string;
  readonly vault: string;
}

/** The read half of the Local Bridge as the HTTP routes call it. */
export interface LocalBridgeReads {
  templateSchema(): TemplateSchemaResponse;
  /** @throws {@link SelectedItemUnavailableError} */
  selectedItem(item: SelectedItemIdentity): Promise<ItemSnapshot>;
  /** @throws {@link ProfileDocumentMissingError} */
  selectedProfile(profileId: string): Promise<SelectedProfileResponse>;
  templateDependencies(source: string): Promise<TemplateDependenciesResponse>;
  citationStyles(): Promise<InstalledCitationStyle[]>;
  selectedCitationStyle(
    request: SelectedCitationStyleRequest,
  ): Promise<SelectedCitationStyleResponse>;
}

/**
 * The reads for the HTTP routes, each run over the services of the layer that
 * makes them: a route handler is the edge where a request enters Effect. Each
 * read runs on a `FiberSet` of the caller's Scope, so a layer close ends a
 * pending read.
 */
export const makeLocalBridgeReads = Effect.fnUntraced(function* (
  provenance: BridgeProvenance,
) {
  const run = yield* FiberSet.makeRuntimePromise<BridgeReadServices>();
  const reads: LocalBridgeReads = {
    templateSchema,
    selectedItem: (item) => run(readSelectedItem(item, provenance)),
    selectedProfile: (profileId) => run(readSelectedProfile(profileId)),
    templateDependencies: (source) => run(readTemplateDependencies(source)),
    citationStyles: () => run(readCitationStyles),
    selectedCitationStyle: (request) => run(readSelectedCitationStyle(request)),
  };
  return reads;
});

function templateSchema(): TemplateSchemaResponse {
  if (!__WEB_WORKBENCH_ENABLED__)
    throw new Error("Web Workbench support is disabled.");
  return {
    note: noteSchema,
    annotation: annotationSchema,
    filename: filenameSchema,
  };
}

/** The selected Item as a Snapshot: the vault targets and the export read one state. */
export const readSelectedItem = Effect.fn("LocalBridge.selectedItem")(
  function* (item: SelectedItemIdentity, provenance: BridgeProvenance) {
    yield* NoteIndex.use((index) => index.whenIndexed);
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const reads = yield* (yield* ZoteroReads).snapshot;
        const selected = yield* resolveSelection(reads, item.key);
        const vaultTargets = yield* collectVaultTargets(reads, selected.item);
        return yield* reads.ItemSnapshot({
          selection: selected.selection,
          provenance: { kind: "connected", ...provenance },
          vaultTargets,
        });
      }),
    );
  },
);

/** The selected Profile's exact source, and whether its document exists yet. */
export const readSelectedProfile = Effect.fn("LocalBridge.selectedProfile")(
  function* (profileId: string) {
    const profiles = yield* Profile;
    const selector = profileSelector(profileId);
    const resolved = selector && (yield* profiles.resolveProfile(selector));
    if (!selector || !resolved) {
      return yield* profileDocumentMissing(profileId);
    }
    const profile = {
      id: profileId,
      name: yield* profileDisplayName(profileId),
    };
    // The document reference a Save addresses is the Profile id and nothing
    // else, so no vault path crosses and the page can key a draft on it.
    const reference = profileId;
    const source = yield* profiles
      .getSource(selector)
      .pipe(Effect.mapError(() => profileDocumentMissing(profileId)));
    // A built-in Default that was never ejected has no file: the source is the
    // document an eject would write, and the page learns it is still absent.
    const response: SelectedProfileResponse =
      resolved.document === undefined
        ? { profile, source, document: { state: "built-in-absent", reference } }
        : {
            profile,
            source,
            document: {
              state: "present",
              reference,
              revision: profileRevision(source),
            },
          };
    return response;
  },
);

/** The name the page renders an annotation's citation through. */
const CITATION_TEMPLATE = "citation";

/**
 * The partials this exact draft calls, resolved through the vault's own pack
 * export — which offers the installed partials and the Citation Template
 * alike. The Citation Template is bundled whether the draft calls it or not,
 * because the page renders each annotation's citation through it the way
 * Obsidian does. A call no vault can answer and a partial the web Workbench
 * cannot run are diagnostics rather than a refusal, so the page keeps every
 * partial that did resolve.
 */
export const readTemplateDependencies = Effect.fn(
  "LocalBridge.templateDependencies",
)(function* (source: string) {
  const missing: string[] = [];
  const bundled = yield* (yield* Template).exportLiteratureNotePackSource(
    source,
    {
      include: [CITATION_TEMPLATE],
      onMissingPartial: (name) => missing.push(name),
    },
  );
  const { manifest } = yield* Effect.try(() =>
    new TemplateFacade().parseLiteratureNoteTemplate(bundled),
  );
  const partials = manifest.partials ?? [];
  const response: TemplateDependenciesResponse = {
    templates: partials.filter(({ language }) => language === "liquid"),
    diagnostics: [
      ...missing.map((name) => ({
        code: "missing-dependency" as const,
        message: `Template dependency '${name}' is missing from this vault.`,
      })),
      ...partials
        .filter(({ language }) => language !== "liquid")
        .map(({ name }) => ({
          code: "unsupported-dependency" as const,
          message: `Template dependency '${name}' uses an unsupported language.`,
        })),
    ],
  };
  return response;
});

/**
 * The citation styles this Zotero has installed; none when its styles folder
 * refuses to be read, so the page's style picker still opens.
 */
export const readCitationStyles = Effect.gen(function* () {
  const { dataDir } = yield* (yield* ZoteroPref).current;
  return yield* listInstalledStyles(dataDir).pipe(
    Effect.catchTag("PlatformError", (error) =>
      Effect.as(
        Effect.logWarning("Cannot read the installed CSL styles", error),
        [],
      ),
    ),
  );
}).pipe(Effect.withSpan("LocalBridge.citationStyles"));

/** The installed style the page asked for, resolved against this Zotero. */
export const readSelectedCitationStyle = Effect.fn(
  "LocalBridge.selectedCitationStyle",
)(function* (request: SelectedCitationStyleRequest) {
  const { dataDir } = yield* (yield* ZoteroPref).current;
  return yield* resolveInstalledStyle(dataDir, request);
});

/** The Snapshot selection and the Item row an Indexed Key names. */
const resolveSelection = Effect.fnUntraced(function* (
  reads: ZoteroReadsApi,
  indexedKey: string,
) {
  const items = yield* reads.ItemsByIndexedKeys({ indexedKeys: [indexedKey] });
  const item = items.values().next().value;
  if (!item) {
    return yield* new SelectedItemUnavailableError({
      key: indexedKey,
      message: `Item '${indexedKey}' is not available in this library.`,
    });
  }
  const selection: SnapshotSelection = {
    library:
      item.groupID === null
        ? { type: "personal" }
        : { type: "group", groupID: item.groupID },
    key: item.key,
  };
  return { item, selection };
});

/** The selector the registry knows a Profile id by, or `undefined` for none. */
export function profileSelector(
  profileId: string,
): ProfileSelector | undefined {
  if (profileId === DEFAULT_PROFILE) return DEFAULT_PROFILE;
  return isProfileId(profileId) ? profileId : undefined;
}
