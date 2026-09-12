// What the Local Bridge answers a connected page with: the Template schema, the
// selected Item as a redacted Snapshot, the selected Profile's exact source, the
// partials one draft calls, and the citation styles this Zotero has installed.
//
// Every answer is built from what a template renders. Absolute paths, note
// bodies, attachment contents, and image bytes are kept out by the shared
// exporter and by the vault-target module, and none is assembled here.

import type { App } from "obsidian";

import { getItemsByKey, resolveIndexedKeyLibrary } from "@zotlit/db";
import type { Item } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
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
import { exportItemSnapshot } from "@zotlit/workbench/snapshot";
import type {
  ItemSnapshot,
  SnapshotSelection,
} from "@zotlit/workbench/snapshot";

import * as m from "@/lib/i18n/generated/messages";
import { profileRevision } from "@/lib/profile-revision";
import { DEFAULT_PROFILE, isProfileId } from "@/lib/profile-stamp";
import type { ProfileSelector } from "@/lib/profile-stamp";
import type { DatabaseService } from "@/services/database/service";
import type { NoteIndex } from "@/services/note-index/service";
import {
  listInstalledStyles,
  resolveInstalledStyle,
} from "@/services/pandoc/styles";
import type { ProfileReader, ProfileService } from "@/services/profile/service";
import type { SettingsService } from "@/services/settings/service";
import type { TemplateService } from "@/services/template/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import type { SelectedItemIdentity } from "./sessions";
import { collectVaultTargets } from "./vault-targets";

/** The Profile service as the bridge reads it: the registry plus exact source. */
export type BridgeProfileReader = ProfileReader &
  Pick<ProfileService, "getSource">;

/** The selected Profile no longer has a document in this vault. */
export class ProfileDocumentMissingError extends Error {
  constructor(profileId: string) {
    super(`Profile '${profileId}' has no document in this vault.`);
    this.name = "ProfileDocumentMissingError";
  }
}

/** The selected Item is not in the library this vault reads. */
export class SelectedItemUnavailableError extends Error {
  constructor(key: string) {
    super(`Item '${key}' is not available in this library.`);
    this.name = "SelectedItemUnavailableError";
  }
}

export interface LocalBridgeReadDeps {
  app: App;
  settings: Pick<SettingsService, "loaded">;
  db: Pick<DatabaseService, "acquireRead">;
  noteIndex: Pick<
    NoteIndex,
    "whenIndexed" | "getNotesByItemKey" | "getImportedNoteByNoteKey"
  >;
  profile: BridgeProfileReader;
  template: Pick<TemplateService, "ready" | "exportLiteratureNotePackSource">;
  zoteroPref: Pick<ZoteroPrefService, "ready" | "dataDir">;
  /** The device id the page keys its drafts on, minted by the service. */
  installationId(): string;
  /** The vault name the Snapshot's provenance carries. */
  vaultName(): string;
}

/** The read half of the Local Bridge, apart from HTTP. */
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

export function createLocalBridgeReads(
  deps: LocalBridgeReadDeps,
): LocalBridgeReads {
  return {
    templateSchema: () => {
      if (!__WEB_WORKBENCH_ENABLED__)
        throw new Error("Web Workbench support is disabled.");
      return {
        note: noteSchema,
        annotation: annotationSchema,
        filename: filenameSchema,
      };
    },

    async selectedItem(item) {
      await Promise.all([deps.noteIndex.whenIndexed(), deps.zoteroPref.ready]);
      using lease = await deps.db.acquireRead();
      const selected = resolveSelection(lease.client, item.key);
      const vaultTargets = await collectVaultTargets(
        lease.client,
        selected.item,
        deps,
      );
      return exportItemSnapshot(lease.client, selected.selection, {
        provenance: {
          kind: "connected",
          installationId: deps.installationId(),
          vault: deps.vaultName(),
        },
        vaultTargets,
      });
    },

    async selectedProfile(profileId) {
      await deps.profile.ready;
      const selector = profileSelector(profileId);
      const resolved = selector && deps.profile.resolveProfile(selector);
      if (!selector || !resolved) {
        throw new ProfileDocumentMissingError(profileId);
      }
      const profile = {
        id: profileId,
        name: resolved.label ?? m.settings_profile_default_name(),
      };
      // The document reference a Save addresses is the Profile id and nothing
      // else, so no vault path crosses and the page can key a draft on it.
      const reference = profileId;
      const source = await readSource(deps.profile, selector, profileId);
      // A built-in Default that was never ejected has no file: the source is the
      // document an eject would write, and the page learns it is still absent.
      return resolved.document === undefined
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
    },

    async templateDependencies(source) {
      await deps.template.ready;
      return dependencyBundle(deps.template, source);
    },

    async citationStyles() {
      await deps.zoteroPref.ready;
      return listInstalledStyles(deps.zoteroPref.dataDir);
    },

    async selectedCitationStyle(request) {
      await deps.zoteroPref.ready;
      return resolveInstalledStyle(deps.zoteroPref.dataDir, request);
    },
  };
}

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
async function dependencyBundle(
  template: Pick<TemplateService, "exportLiteratureNotePackSource">,
  source: string,
): Promise<TemplateDependenciesResponse> {
  const missing: string[] = [];
  const bundled = await template.exportLiteratureNotePackSource(source, {
    include: [CITATION_TEMPLATE],
    onMissingPartial: (name) => missing.push(name),
  });
  const { manifest } = new TemplateFacade().parseLiteratureNoteTemplate(
    bundled,
  );
  const partials = manifest.partials ?? [];
  return {
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
}

/** The Snapshot selection and the Item row an Indexed Key names. */
function resolveSelection(
  client: NodeDatabaseClient,
  indexedKey: string,
): { item: Item; selection: SnapshotSelection } {
  const resolved = resolveIndexedKeyLibrary(client, indexedKey);
  const item =
    resolved && getItemsByKey(client, resolved.libraryID, [resolved.key])[0];
  if (!resolved || !item) throw new SelectedItemUnavailableError(indexedKey);
  return {
    item,
    selection: {
      library:
        item.groupID === null
          ? { type: "personal" }
          : { type: "group", groupID: item.groupID },
      key: resolved.key,
    },
  };
}

/** The selector the registry knows a Profile id by, or `undefined` for none. */
export function profileSelector(
  profileId: string,
): ProfileSelector | undefined {
  if (profileId === DEFAULT_PROFILE) return DEFAULT_PROFILE;
  return isProfileId(profileId) ? profileId : undefined;
}

async function readSource(
  profile: BridgeProfileReader,
  selector: ProfileSelector,
  profileId: string,
): Promise<string> {
  try {
    return await profile.getSource(selector);
  } catch {
    throw new ProfileDocumentMissingError(profileId);
  }
}
