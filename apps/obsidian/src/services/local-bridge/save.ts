// The write boundary of the Local Bridge: everything a connected Save is
// checked against before one byte reaches the vault, and the write itself,
// which the Profile service owns.
//
// The order is the contract's: the session already authorized the request, then
// the document reference names this Connection's Profile, the draft is a Liquid
// Profile this build can run, it parses and compiles, its dependencies resolve
// in this vault, and the vault still holds the revision the page loaded.

import { gte } from "semver";

import { CONTRACT_VERSION } from "@zotlit/db";
import { TemplateFacade } from "@zotlit/templates/facade";
import type { LiteratureNoteTemplateManifest } from "@zotlit/templates/facade";
import { LiteratureNotePackError } from "@zotlit/templates/literature-note-pack";
import type {
  SaveSelectedProfileRequest,
  SaveSelectedProfileResponse,
} from "@zotlit/workbench/bridge";

import { getLogger } from "@/lib/log";
import type { ProfileService } from "@/services/profile/service";
import type { TemplateService } from "@/services/template/service";

import { ProfileDocumentMissingError, profileSelector } from "./reads";
import type { BridgeProfileReader } from "./reads";

const logger = getLogger("local-bridge");

/** The Profile service as the write boundary uses it: the reads plus the write. */
export type BridgeProfileWriter = BridgeProfileReader &
  Pick<ProfileService, "saveSource">;

/**
 * A Save answered. `reference-refused` is the one outcome the contract carries
 * no reason for: the draft names a document outside this Connection, which is a
 * refusal of the request rather than of the source.
 */
export type LocalBridgeSaveOutcome =
  | SaveSelectedProfileResponse
  | { readonly state: "reference-refused" };

export interface LocalBridgeSaveDeps {
  profile: BridgeProfileWriter;
  template: Pick<TemplateService, "ready" | "exportLiteratureNotePackSource">;
  /** This build's version, which a Profile's `minAppVersion` is read against. */
  pluginVersion: string;
  /** Fired once a Save has landed in the vault, never on a refusal. */
  onSaved(profileId: string): void;
}

/** The write half of the Local Bridge, apart from HTTP. */
export interface LocalBridgeSave {
  /** @throws {@link ProfileDocumentMissingError} */
  saveSelectedProfile(
    profileId: string,
    request: SaveSelectedProfileRequest,
  ): Promise<LocalBridgeSaveOutcome>;
}

export function createLocalBridgeSave(
  deps: LocalBridgeSaveDeps,
): LocalBridgeSave {
  return {
    async saveSelectedProfile(profileId, request) {
      await Promise.all([deps.profile.ready, deps.template.ready]);
      // The reference the page holds is the Profile id and nothing else, so a
      // draft for another Profile cannot reach this Connection's document.
      if (request.reference !== profileId)
        return { state: "reference-refused" };
      const selector = profileSelector(profileId);
      if (!selector || !deps.profile.resolveProfile(selector)) {
        throw new ProfileDocumentMissingError(profileId);
      }
      const refusal = await sourceRefusal(deps, request.source, profileId);
      if (refusal) return refusal;
      const write = await deps.profile.saveSource(
        selector,
        request.source,
        request.expected,
      );
      if (write.state === "saved") deps.onSaved(profileId);
      return write;
    },
  };
}

/**
 * Whether the web Workbench cannot edit this Profile: it is not Liquid, it
 * computes a property in JavaScript, it calls an Eta partial, or it asks for a
 * data contract or a plugin newer than this build.
 *
 * Ticket #1004 builds the same detection for the entry actions, which refuse
 * before a browser opens. Both readings are this one function, so the two
 * merge into a single helper rather than drifting apart.
 */
export function isUnsupportedProfile(
  manifest: LiteratureNoteTemplateManifest,
  pluginVersion: string,
): boolean {
  return (
    manifest.contract !== CONTRACT_VERSION ||
    manifest.language !== "liquid" ||
    (manifest.frontmatter?.some((entry) => "js" in entry) ?? false) ||
    (manifest.partials?.some(({ language }) => language === "eta") ?? false) ||
    (manifest.minAppVersion !== undefined &&
      !gte(pluginVersion, manifest.minAppVersion))
  );
}

/**
 * The refusal this draft earns, or `undefined` for one the vault accepts. A
 * draft that parses can still fail to compile or call a partial no vault holds,
 * so every source the Profile renders is compiled and its dependencies resolved
 * before anything reaches the file.
 */
async function sourceRefusal(
  deps: LocalBridgeSaveDeps,
  source: string,
  profileId: string,
): Promise<SaveSelectedProfileResponse | undefined> {
  const facade = new TemplateFacade();
  try {
    const document = facade.parseLiteratureNoteTemplate(source);
    if (document.manifest.id !== profileId) {
      return { state: "refused", reason: "invalid-source" };
    }
    if (isUnsupportedProfile(document.manifest, deps.pluginVersion)) {
      return { state: "refused", reason: "unsupported-profile" };
    }
    for (const partial of document.manifest.partials ?? []) {
      facade.define(partial.name, partial.source, partial.language);
    }
    facade.compileLiteratureNoteTemplate(document);
  } catch (error) {
    return invalidSource(profileId, error);
  }
  try {
    // The partials this draft calls, resolved the way the dependency bundle
    // resolves them: a call this vault cannot answer refuses the Save rather
    // than leaving behind a Profile the next render cannot run. A vault fault
    // while reading a partial is the route's own failure, not a refusal.
    await deps.template.exportLiteratureNotePackSource(source);
  } catch (error) {
    if (!(error instanceof LiteratureNotePackError)) throw error;
    return invalidSource(profileId, error);
  }
  return undefined;
}

/** The refusal an unparsable, uncompilable, or unresolvable draft earns. */
function invalidSource(
  profileId: string,
  error: unknown,
): SaveSelectedProfileResponse {
  // The cause by name only: an error message can quote the draft.
  logger.debug("Refused a Local Bridge Save at the source gate", {
    operation: "selected-profile:save",
    profileId,
    cause:
      error instanceof LiteratureNotePackError
        ? error.code
        : error instanceof Error
          ? error.name
          : typeof error,
  });
  return { state: "refused", reason: "invalid-source" };
}
