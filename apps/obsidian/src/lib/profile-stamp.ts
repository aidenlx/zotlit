// Format and parse of the Profile stamp — the `zotlit-profile` frontmatter
// value that records which Literature Note Profile a note belongs to. It also
// owns the one read of that property from a note, so every reader of a stamp
// parses it the same way.

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

/** One `zotlit-profile` value, as a note carries it or as a write emits it. */
export interface ProfileStamp {
  /** The value itself, printed verbatim by diagnostics. */
  readonly stamp: string;
  /**
   * The Profile ID the stamp names — the only part membership resolves by. A
   * stamp with no parenthesised ID yields its whole value, so a bare-ID stamp
   * still resolves and any other text reaches the unknown-Profile diagnostic.
   */
  readonly id: string;
}

/**
 * Read a note's Profile stamp. `undefined` means the property is absent, which
 * selects the built-in default Profile.
 */
export function parseProfileStamp(value: unknown): ProfileStamp | undefined {
  if (value === undefined) return undefined;
  // A frontmatter value of any shape reads as its text, so a stamp Obsidian
  // stored as a one-item list still names its Profile and anything else falls
  // through to the unknown-Profile path with its text intact.
  // oxlint-disable-next-line no-base-to-string
  const stamp = String(value);
  return { stamp, id: STAMPED_ID.exec(stamp)?.groups.id ?? stamp };
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
