// Resolved Profile values and the binding overlay used by note rendering.

import { formatProfileStamp } from "@/lib/profile-stamp";
import type { ProfileSelector, ProfileStamp } from "@/lib/profile-stamp";
import type { Settings } from "@/services/settings/schema";

import type { LiteratureNoteProfile } from "./service";

export interface ResolvedLiteratureNoteProfileBindings {
  readonly "note.literature-folder": string;
  readonly "citation.references-style": string | null;
  readonly "note.import-folder": string;
  readonly "note.import-colored-highlights": boolean;
  readonly "note.import-annotations-as-template": boolean;
}

export type ProfileBindingSettings = Readonly<Settings> &
  Partial<ResolvedLiteratureNoteProfileBindings>;

const boundProfiles = new WeakMap<ProfileBindingSettings, ResolvedProfile>();

/** Keep an in-flight operation on the Profile snapshot it resolved before its writes. */
export function boundProfile(
  settings: ProfileBindingSettings,
): ResolvedProfile | undefined {
  return boundProfiles.get(settings);
}

/** Read an effective binding from an optional resolved-Profile overlay. */
export function getProfileBinding<
  K extends keyof ResolvedLiteratureNoteProfileBindings,
>(
  settings: ProfileBindingSettings,
  key: K,
): ResolvedLiteratureNoteProfileBindings[K] {
  const value = settings[key] as
    | ResolvedLiteratureNoteProfileBindings[K]
    | undefined;
  return value === undefined
    ? settings["note.default-profile"].bindings[key]
    : value;
}

/** Merge one Profile's sparse bindings over the default Profile. `profile`
 *  undefined merges the default Profile with itself, i.e. resolves to it. */
function mergeBindings(
  settings: Readonly<Settings>,
  profile: LiteratureNoteProfile | undefined,
): ResolvedLiteratureNoteProfileBindings {
  const bindings = profile?.bindings;
  const base = settings["note.default-profile"].bindings;
  return {
    "note.literature-folder":
      bindings?.["note.literature-folder"] ?? base["note.literature-folder"],
    "citation.references-style":
      bindings?.["citation.references-style"] !== undefined
        ? bindings["citation.references-style"]
        : base["citation.references-style"],
    "note.import-folder":
      bindings?.["note.import-folder"] ?? base["note.import-folder"],
    "note.import-colored-highlights":
      bindings?.["note.import-colored-highlights"] ??
      base["note.import-colored-highlights"],
    "note.import-annotations-as-template":
      bindings?.["note.import-annotations-as-template"] ??
      base["note.import-annotations-as-template"],
  };
}

/** One Literature Note Profile as an operation runs under it. */
export interface ResolvedProfile {
  readonly selector: ProfileSelector;
  /** The label as the user wrote it; `undefined` for the default Profile, whose display name is a UI string. */
  readonly label: string | undefined;
  /** Stamp a note written under this Profile carries; `undefined` for the default Profile. */
  readonly stamp: string | undefined;
  readonly document: string | undefined;
  readonly bindings: ResolvedLiteratureNoteProfileBindings;
  /**
   * Settings snapshot with this Profile's effective bindings overlaid.
   *
   * @see boundProfile
   */
  readonly settings: ProfileBindingSettings;
  /** The Profile's own `citation.references-style` override, `undefined` when it inherits. Feeds the note's `citation-style` frontmatter, which states only what the Profile declares. */
  readonly citationStyle: string | null | undefined;
}

export function bindProfile(
  settings: Readonly<Settings>,
  profile: {
    selector: ProfileSelector;
    document?: string;
    entry?: LiteratureNoteProfile;
  },
): ResolvedProfile {
  const { selector, entry } = profile;
  const bindings = mergeBindings(settings, entry);
  const boundSettings: ProfileBindingSettings = { ...settings, ...bindings };
  const resolved: ResolvedProfile = {
    selector,
    label: entry?.label,
    stamp: entry && formatProfileStamp(entry),
    document: profile.document,
    bindings,
    settings: boundSettings,
    citationStyle: entry?.bindings?.["citation.references-style"],
  };
  boundProfiles.set(boundSettings, resolved);
  return resolved;
}

/** The Profile a note belongs to, or the parsed stamp that names no Profile. */
export type NoteProfile =
  | { readonly ok: true; readonly profile: ResolvedProfile }
  | { readonly ok: false; readonly stamped: ProfileStamp };

/**
 * The selector a note's stamp names — a parsed ID even when no Profile
 * carries it — or `undefined` when the stamp holds none.
 */
export function noteProfileSelector(
  note: NoteProfile,
): ProfileSelector | undefined {
  return note.ok ? note.profile.selector : note.stamped.id;
}
