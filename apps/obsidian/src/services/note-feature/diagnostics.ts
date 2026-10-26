// The refusals a Note Feature operation returns instead of writing a note.
import { Effect } from "effect";
import type { TFile } from "obsidian";

import { withLogCategory } from "@/lib/effect-log";
import * as m from "@/lib/i18n/generated/messages";
import { unknownProfileDiagnostic } from "@/lib/profile-stamp";
import type {
  ProfileId,
  ProfileSelector,
  UnknownProfileDiagnostic,
} from "@/lib/profile-stamp";

import type { ComposeWarn } from "./compose";
import type { ManagedFrontmatterPreparationFailure } from "./frontmatter";
import type {
  CreateNoteResult,
  LiteratureNoteTemplateConversionRequiredDiagnostic,
  ManagedFrontmatterFailureDiagnostic,
  ManagedFrontmatterRefusalDiagnostic,
  MissingLiteratureNoteTemplateDiagnostic,
  UpdateResult,
} from "./types";

const logged = withLogCategory("note-feature");

/**
 * The composition's warnings, logged through Effect's logger from inside a
 * render's synchronous callback.
 */
export const composeWarn: Effect.Effect<ComposeWarn> = Effect.gen(function* () {
  const run = Effect.runSyncWith(yield* Effect.context<never>());
  return (message, annotations) =>
    run(
      Effect.logWarning(message).pipe(Effect.annotateLogs(annotations), logged),
    );
});

/** Result for an update that intentionally leaves the body region untouched. */
const NO_BODY_UPDATE: UpdateResult = {
  bodyUpdated: false,
  duplicateRegionCount: 0,
};

function refusedCreate(
  indexedKey: string,
  existing: readonly TFile[],
): Extract<CreateNoteResult, { outcome: "refused" }> {
  const paths = existing.map((file) => file.path) as [string, ...string[]];
  return {
    outcome: "refused",
    diagnostic: {
      code:
        existing.length === 1
          ? "literature-note-exists"
          : "duplicate-literature-notes",
      hint:
        existing.length === 1
          ? "Open the existing Literature Note instead of creating another."
          : "Resolve the duplicate Literature Notes, then run create again.",
      indexedKey,
      paths,
    },
  };
}

/**
 * Map one Managed Frontmatter refusal to the diagnostic a caller reports, and
 * log each field whose evaluation failed.
 */
const frontmatterRefusal = Effect.fnUntraced(function* (
  failures: readonly ManagedFrontmatterPreparationFailure[],
  input: {
    itemKey: string;
    diagnosticContext: { path?: string; indexedKey?: string };
  },
) {
  for (const { key, reason, error } of failures)
    if (reason === "evaluation")
      yield* Effect.logWarning("Managed Frontmatter field failed").pipe(
        Effect.annotateLogs({ key, itemKey: input.itemKey, error }),
        logged,
      );
  const mapped = failures.map(({ key: field, reason }) => {
    if (reason === "evaluation") {
      return {
        field,
        message: m.managed_frontmatter_eval_failure({ field }),
        hint: m.managed_frontmatter_eval_recovery({ field }),
      };
    }
    return {
      field,
      message: m.managed_frontmatter_inert_failure({ field }),
      hint: m.managed_frontmatter_inert_recovery({ field }),
    };
  }) as [
    ManagedFrontmatterFailureDiagnostic,
    ...ManagedFrontmatterFailureDiagnostic[],
  ];
  const diagnostic: ManagedFrontmatterRefusalDiagnostic = {
    code: "managed-frontmatter-refused",
    hint: m.managed_frontmatter_refused_recovery(),
    failures: mapped,
    ...input.diagnosticContext,
  };
  return diagnostic;
});

function refusedUnknownProfile(
  stamp: string,
  context: { path?: string; indexedKey?: string },
): {
  outcome: "refused";
  diagnostic: UnknownProfileDiagnostic;
} {
  return {
    outcome: "refused",
    diagnostic: unknownProfileDiagnostic(stamp, context),
  };
}

function refusedUpdateProfile(stamp: string, path: string): UpdateResult {
  return {
    ...NO_BODY_UPDATE,
    diagnostic: refusedUnknownProfile(stamp, { path }).diagnostic,
  };
}

function refusedMissingDocument(
  document: string,
  context: { path?: string; indexedKey?: string },
): { outcome: "refused"; diagnostic: MissingLiteratureNoteTemplateDiagnostic } {
  return {
    outcome: "refused",
    diagnostic: {
      code: "missing-literature-note-template",
      hint: `Restore '${document}' in the template folder or clear the Profile document reference.`,
      document,
      ...context,
    },
  };
}

function refusedUpdateMissingDocument(
  document: string,
  path: string,
): UpdateResult {
  return {
    ...NO_BODY_UPDATE,
    diagnostic: refusedMissingDocument(document, { path }).diagnostic,
  };
}

function refusedTemplateConversion(
  profileId: ProfileId,
  context: { path?: string; indexedKey?: string },
): {
  outcome: "refused";
  diagnostic: LiteratureNoteTemplateConversionRequiredDiagnostic;
} {
  return {
    outcome: "refused",
    diagnostic: {
      code: "literature-note-template-conversion-required",
      hint: "Convert the legacy Literature Note Templates before using added Profiles.",
      profileId,
      ...context,
    },
  };
}

function refusedUpdateTemplateConversion(
  profileId: ProfileId,
  path: string,
): UpdateResult {
  return {
    ...NO_BODY_UPDATE,
    diagnostic: refusedTemplateConversion(profileId, { path }).diagnostic,
  };
}

function refusedUpdateProfileConflict(
  indexedKey: string,
  path: string,
  profiles: {
    existingProfile: ProfileSelector;
    requestedProfile: ProfileSelector;
  },
): UpdateResult {
  return {
    ...NO_BODY_UPDATE,
    diagnostic: {
      code: "literature-note-profile-conflict",
      hint: "Follow the stamped Profile, or switch the note interactively before this headless update.",
      indexedKey,
      path,
      existingProfile: profiles.existingProfile,
      requestedProfile: profiles.requestedProfile,
    },
  };
}

function refusedProfileConflict(
  indexedKey: string,
  file: TFile,
  profiles: {
    existingProfile: ProfileSelector;
    requestedProfile: ProfileSelector;
  },
): Extract<CreateNoteResult, { outcome: "refused" }> {
  return {
    outcome: "refused",
    diagnostic: {
      code: "literature-note-profile-conflict",
      hint: "Keep the existing Profile, or switch the note to the requested Profile and refresh its managed content.",
      indexedKey,
      path: file.path,
      existingProfile: profiles.existingProfile,
      requestedProfile: profiles.requestedProfile,
    },
  };
}

export {
  frontmatterRefusal,
  NO_BODY_UPDATE,
  refusedCreate,
  refusedMissingDocument,
  refusedProfileConflict,
  refusedTemplateConversion,
  refusedUnknownProfile,
  refusedUpdateMissingDocument,
  refusedUpdateProfile,
  refusedUpdateProfileConflict,
  refusedUpdateTemplateConversion,
};
