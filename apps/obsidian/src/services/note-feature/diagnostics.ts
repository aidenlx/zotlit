// The refusals a Note Feature operation returns instead of writing a note.
import type { TFile } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { unknownProfileDiagnostic } from "@/lib/profile-stamp";
import type {
  ProfileId,
  ProfileSelector,
  UnknownProfileDiagnostic,
} from "@/lib/profile-stamp";

import type { ManagedFrontmatterPreparationFailure } from "./frontmatter";
import type {
  CreateNoteResult,
  LiteratureNoteTemplateConversionRequiredDiagnostic,
  ManagedFrontmatterFailureDiagnostic,
  ManagedFrontmatterRefusalDiagnostic,
  MissingLiteratureNoteTemplateDiagnostic,
  UpdateResult,
} from "./types";

const logger = getLogger("note-feature");

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

/** Map one Managed Frontmatter refusal to the diagnostic a caller reports. */
function frontmatterRefusal(
  failures: readonly ManagedFrontmatterPreparationFailure[],
  input: {
    itemKey: string;
    diagnosticContext: { path?: string; indexedKey?: string };
  },
): ManagedFrontmatterRefusalDiagnostic {
  const mapped = failures.map(({ key: field, reason, error }) => {
    if (reason === "evaluation") {
      logger.warn("Managed Frontmatter field failed", {
        key: field,
        itemKey: input.itemKey,
        error,
      });
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
  return {
    code: "managed-frontmatter-refused",
    hint: m.managed_frontmatter_refused_recovery(),
    failures: mapped,
    ...input.diagnosticContext,
  };
}

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
