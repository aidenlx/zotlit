// Format and parse of the Profile stamp — the `zotlit-profile` frontmatter
// value that records which Literature Note Profile a note belongs to. It also
// owns the one read of that property from a note, so every reader of a stamp
// parses it the same way, and the one diagnostic shape for a stamp that names
// no Profile. It also owns `ProfileSelector`, the one way code names the
// Profile a note or an operation resolves against, and the one parse of
// selector text arriving from outside the plugin.

import { regex } from "arkregex";
import type { MetadataCache, TFile } from "obsidian";

import { FIELD_LITERATURE_NOTE_PROFILE } from "./constants";

/**
 * Character shape of a Literature Note Profile ID, the sole source both the
 * settings schema and the stamp parse read it from. It mirrors the Nano ID
 * alphabet and length `profileNanoid` mints in `services/settings/service.ts`.
 *
 * @see docs/adr/0030-profile-stamp-carries-a-label-hint-beside-the-id.md
 */
const PROFILE_ID_SOURCE = "[A-Za-z0-9]{12}";

/**
 * Whole-value Profile ID match, validating one configured Profile's id. Built
 * from {@link PROFILE_ID_SOURCE} rather than written as a literal so the ID
 * shape stays one string the stamp parse shares.
 */
export const PROFILE_ID_PATTERN = new RegExp(`^${PROFILE_ID_SOURCE}$`);

/**
 * Parenthesised Profile ID at the end of a stamp. Matching from the end is
 * what keeps a Profile label that contains or ends in `)` parseable.
 */
const STAMPED_ID = regex(`\\((?<id>${PROFILE_ID_SOURCE})\\)$`);

declare const PROFILE_ID: unique symbol;

/** A Profile ID that passed {@link PROFILE_ID_PATTERN}. */
export type ProfileId = string & { readonly [PROFILE_ID]: true };

/** Narrow `value` to {@link ProfileId} by checking its character shape. */
export function isProfileId(value: string): value is ProfileId {
  return PROFILE_ID_PATTERN.test(value);
}

/** The literal selector value naming the built-in default Profile. */
export const DEFAULT_PROFILE = "default";

/** The Profile a note or an operation resolves against: a Profile ID, or the default Profile. */
export type ProfileSelector = ProfileId | typeof DEFAULT_PROFILE;

/** One `zotlit-profile` value, as a note carries it or as a write emits it. */
export interface ProfileStamp {
  /** The value itself, printed verbatim by diagnostics. */
  readonly stamp: string;
  /**
   * The Profile ID the stamp names, or `undefined` when the stamp text is not
   * one — a bare-ID stamp still resolves; any other text has no id and reaches
   * the unknown-Profile diagnostic with `stamp` intact.
   */
  readonly id: ProfileId | undefined;
}

/**
 * Read a note's Profile stamp. `undefined` means the property is absent, which
 * selects the built-in default Profile.
 */
function parseProfileStamp(value: unknown): ProfileStamp | undefined {
  if (value === undefined) return undefined;
  // A frontmatter value of any shape reads as its text, so a stamp Obsidian
  // stored as a one-item list still names its Profile and anything else falls
  // through to the unknown-Profile path with its text intact.
  // oxlint-disable-next-line no-base-to-string
  const stamp = String(value);
  const parenthesised = STAMPED_ID.exec(stamp)?.groups.id as
    | ProfileId
    | undefined;
  return {
    stamp,
    id: parenthesised ?? (isProfileId(stamp) ? stamp : undefined),
  };
}

/**
 * Compose the stamp ZotLit writes: the Profile hint, then the Profile ID in
 * parentheses. The hint carries the label as the user wrote it, trimmed.
 */
export function formatProfileStamp(profile: {
  id: string;
  label: string;
}): string {
  return `${profile.label.trim()} (${profile.id})`;
}

/** Read one note's Profile stamp; `undefined` selects the default Profile. */
export function readProfileStamp(
  metadataCache: Pick<MetadataCache, "getFileCache">,
  file: TFile,
): ProfileStamp | undefined {
  return parseProfileStamp(
    metadataCache.getFileCache(file)?.frontmatter?.[
      FIELD_LITERATURE_NOTE_PROFILE
    ],
  );
}

/**
 * Parse selector text from outside the plugin (a URL parameter, a CLI
 * argument, a control key). `undefined` when the text is neither `default`
 * nor a Profile ID.
 */
export function parseProfileSelector(
  text: string,
): ProfileSelector | undefined {
  if (text === DEFAULT_PROFILE) return DEFAULT_PROFILE;
  return isProfileId(text) ? text : undefined;
}

export const UNKNOWN_PROFILE_HINT =
  "Re-stamp the note or recreate the Profile with the same ID.";

export interface UnknownProfileDiagnostic {
  readonly code: "unknown-literature-note-profile";
  readonly hint: string;
  /**
   * The Profile stamp as the note carries it, or the requested Profile ID when
   * the caller named one. Printed verbatim so the user can find the note.
   */
  readonly stamp: string;
  readonly path?: string;
  readonly indexedKey?: string;
}

export function unknownProfileDiagnostic(
  stamp: string,
  context: { path?: string; indexedKey?: string } = {},
): UnknownProfileDiagnostic {
  return {
    code: "unknown-literature-note-profile",
    hint: UNKNOWN_PROFILE_HINT,
    stamp,
    ...context,
  };
}
