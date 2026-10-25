// The write boundary of the Local Bridge: everything a connected Save is
// checked against before one byte reaches the vault, and the write itself,
// which the Profile service owns.
//
// The order is the contract's: the session already authorized the request, then
// the document reference names this Connection's Profile, the draft is a Liquid
// Profile this build can run, it parses and compiles, its dependencies resolve
// in this vault, and the vault still holds the revision the page loaded.
import { Effect } from "effect";

import { TemplateFacade } from "@zotlit/templates/facade";
import { LiteratureNotePackError } from "@zotlit/templates/literature-note-pack";
import type {
  SaveSelectedProfileRequest,
  SaveSelectedProfileResponse,
} from "@zotlit/workbench/bridge";

import { withLogCategory } from "@/lib/effect-log";
import { Profile } from "@/services/profile/service";
import { Template } from "@/services/template/service";

import { profileDocumentMissing, profileSelector } from "./reads";
import { unsupportedProfileReason } from "./unsupported";

/**
 * A Save answered. `reference-refused` is the one outcome the contract carries
 * no reason for: the draft names a document outside this Connection, which is a
 * refusal of the request rather than of the source.
 */
export type LocalBridgeSaveOutcome =
  | SaveSelectedProfileResponse
  | { readonly state: "reference-refused" };

/** The write half of the Local Bridge as the HTTP routes call it. */
export interface LocalBridgeSave {
  /** @throws {@link ProfileDocumentMissingError} */
  saveSelectedProfile(
    profileId: string,
    request: SaveSelectedProfileRequest,
  ): Promise<LocalBridgeSaveOutcome>;
}

/**
 * The Save for the HTTP routes, run over the services of the layer that makes
 * it. `onSaved` runs once a Save has landed in the vault, never on a refusal.
 */
export const makeLocalBridgeSave = Effect.fnUntraced(function* (options: {
  /** This build's version, which a Profile's `minAppVersion` is read against. */
  readonly pluginVersion: string;
  onSaved(profileId: string): Effect.Effect<void>;
}) {
  const run = Effect.runPromiseWith(
    yield* Effect.context<Profile | Template>(),
  );
  const save: LocalBridgeSave = {
    saveSelectedProfile: (profileId, request) =>
      run(
        saveSelectedProfile(profileId, request, options.pluginVersion).pipe(
          Effect.tap((outcome) =>
            outcome.state === "saved"
              ? options.onSaved(profileId)
              : Effect.void,
          ),
        ),
      ),
  };
  return save;
});

/** Check one Save against the boundary, then write it through the Profile. */
export const saveSelectedProfile = Effect.fn("LocalBridge.saveSelectedProfile")(
  function* (
    profileId: string,
    request: SaveSelectedProfileRequest,
    pluginVersion: string,
  ) {
    // The reference the page holds is the Profile id and nothing else, so a
    // draft for another Profile cannot reach this Connection's document.
    if (request.reference !== profileId) {
      const refused: LocalBridgeSaveOutcome = { state: "reference-refused" };
      return refused;
    }
    const profiles = yield* Profile;
    const selector = profileSelector(profileId);
    if (!selector || !(yield* profiles.resolveProfile(selector))) {
      return yield* profileDocumentMissing(profileId);
    }
    const refusal = yield* sourceRefusal(
      request.source,
      profileId,
      pluginVersion,
    );
    if (refusal) return refusal;
    const write: LocalBridgeSaveOutcome = yield* profiles.saveSource(
      selector,
      request.source,
      request.expected,
    );
    return write;
  },
);

/**
 * The refusal this draft earns, or `undefined` for one the vault accepts. A
 * draft that parses can still fail to compile or call a partial no vault holds,
 * so every source the Profile renders is compiled and its dependencies resolved
 * before anything reaches the file.
 */
const sourceRefusal = Effect.fnUntraced(function* (
  source: string,
  profileId: string,
  pluginVersion: string,
) {
  const facade = new TemplateFacade();
  const checked = yield* Effect.try(() => {
    const document = facade.parseLiteratureNoteTemplate(source);
    if (document.manifest.id !== profileId) return "invalid-source" as const;
    if (unsupportedProfileReason(document.manifest, pluginVersion) !== null)
      return "unsupported-profile" as const;
    for (const partial of document.manifest.partials ?? []) {
      facade.define(partial.name, partial.source, partial.language);
    }
    facade.compileLiteratureNoteTemplate(document);
    return undefined;
  }).pipe(
    Effect.catch(({ cause }) =>
      Effect.as(logInvalidSource(profileId, cause), "invalid-source" as const),
    ),
  );
  if (checked !== undefined) return refused(checked);
  // The partials this draft calls, resolved the way the dependency bundle
  // resolves them: a call this vault cannot answer refuses the Save rather
  // than leaving behind a Profile the next render cannot run. A vault fault
  // while reading a partial is the route's own failure, not a refusal.
  return yield* (yield* Template).exportLiteratureNotePackSource(source).pipe(
    Effect.flatMap((bundled) =>
      Effect.try(() => facade.parseLiteratureNoteTemplate(bundled)),
    ),
    Effect.map((document) =>
      unsupportedProfileReason(document.manifest, pluginVersion) === null
        ? undefined
        : refused("unsupported-profile"),
    ),
    Effect.catchIf(
      (error) => packError(error) !== undefined,
      (error) =>
        Effect.as(
          logInvalidSource(profileId, packError(error)),
          refused("invalid-source"),
        ),
    ),
  );
});

const refused = (
  reason: "invalid-source" | "unsupported-profile",
): SaveSelectedProfileResponse => ({ state: "refused", reason });

/** The pack error a failure carries, whether the Template or a parse raised it. */
function packError(error: unknown): LiteratureNotePackError | undefined {
  if (error instanceof LiteratureNotePackError) return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "cause" in error &&
    error.cause instanceof LiteratureNotePackError
  )
    return error.cause;
  return undefined;
}

/** Log a refused draft by the name of its cause only: a message can quote the draft. */
function logInvalidSource(profileId: string, error: unknown) {
  return Effect.logDebug("Refused a Local Bridge Save at the source gate").pipe(
    Effect.annotateLogs({
      operation: "selected-profile:save",
      profileId,
      cause:
        error instanceof LiteratureNotePackError
          ? error.code
          : error instanceof Error
            ? error.name
            : typeof error,
    }),
    withLogCategory("local-bridge"),
  );
}
