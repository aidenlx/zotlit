// Literature Note Profile resolution: the one place a Profile selector or a
// note's Profile stamp becomes the Profile an operation runs under, with its
// bindings merged over the default Profile.

import type { MetadataCache, TFile } from "obsidian";

import {
  DEFAULT_PROFILE,
  formatProfileStamp,
  readProfileStamp,
} from "@/lib/profile-stamp";
import type {
  ProfileId,
  ProfileSelector,
  ProfileStamp,
} from "@/lib/profile-stamp";

import type { LiteratureNoteProfile, Settings } from "./schema";

export interface ResolvedLiteratureNoteProfileBindings {
  readonly "note.literature-folder": string;
  readonly "citation.references-style": string | null;
  readonly "note.import-folder": string;
  readonly "note.import-colored-highlights": boolean;
  readonly "note.import-annotations-as-template": boolean;
}

export type ProfileBindingSettings = Readonly<Settings> &
  Partial<ResolvedLiteratureNoteProfileBindings>;

const boundProfileIds = new WeakMap<ProfileBindingSettings, ProfileId>();

/** Read the named Profile carried by a bound settings snapshot. */
export function boundLiteratureNoteProfileId(
  settings: ProfileBindingSettings,
): ProfileId | undefined {
  return boundProfileIds.get(settings);
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

function findLiteratureNoteProfile(
  settings: Readonly<Settings>,
  id: ProfileId,
): LiteratureNoteProfile | undefined {
  return settings["note.profiles"].find((candidate) => candidate.id === id);
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

/** Resolve one Profile's sparse bindings over the default Profile. */
export function resolveLiteratureNoteProfileBindings(
  current: Readonly<Settings>,
  selector: ProfileSelector,
): ResolvedLiteratureNoteProfileBindings | undefined {
  if (selector === DEFAULT_PROFILE) return mergeBindings(current, undefined);
  const profile = findLiteratureNoteProfile(current, selector);
  if (profile === undefined) return undefined;
  return mergeBindings(current, profile);
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
   * @see boundLiteratureNoteProfileId
   */
  readonly settings: ProfileBindingSettings;
  /** The Profile's own `citation.references-style` override, `undefined` when it inherits. Feeds the note's `citation-style` frontmatter, which states only what the Profile declares. */
  readonly citationStyle: string | null | undefined;
}

export function resolveProfile(
  settings: Readonly<Settings>,
  selector: typeof DEFAULT_PROFILE,
): ResolvedProfile;
export function resolveProfile(
  settings: Readonly<Settings>,
  selector: ProfileSelector,
): ResolvedProfile | undefined;
export function resolveProfile(
  settings: Readonly<Settings>,
  selector: ProfileSelector,
): ResolvedProfile | undefined {
  const profile =
    selector === DEFAULT_PROFILE
      ? undefined
      : findLiteratureNoteProfile(settings, selector);
  if (selector !== DEFAULT_PROFILE && profile === undefined) return undefined;
  const bindings = mergeBindings(settings, profile);
  const boundSettings: ProfileBindingSettings = { ...settings, ...bindings };
  if (profile) boundProfileIds.set(boundSettings, profile.id);
  return {
    selector,
    label: profile?.label,
    stamp: profile && formatProfileStamp(profile),
    document: profile
      ? profile.document
      : settings["note.default-profile"].document,
    bindings,
    settings: boundSettings,
    citationStyle: profile?.bindings?.["citation.references-style"],
  };
}

/** The Profile a note belongs to, or the parsed stamp that names no Profile. */
export type NoteProfile =
  | { readonly ok: true; readonly profile: ResolvedProfile }
  | { readonly ok: false; readonly stamped: ProfileStamp };

/**
 * Resolve the Profile a note belongs to from its `zotlit-profile` stamp. A
 * note with no stamp resolves to the default Profile; a stamp that names no
 * Profile resolves to `ok: false` carrying the parsed stamp — never to the
 * default Profile, since membership is never inferred.
 */
export function profileOf(
  metadataCache: Pick<MetadataCache, "getFileCache">,
  settings: Readonly<Settings>,
  file: TFile,
): NoteProfile {
  const stamped = readProfileStamp(metadataCache, file);
  if (stamped === undefined) {
    return { ok: true, profile: resolveProfile(settings, DEFAULT_PROFILE) };
  }
  if (stamped.id === undefined) return { ok: false, stamped };
  const profile = resolveProfile(settings, stamped.id);
  if (!profile) return { ok: false, stamped };
  return { ok: true, profile };
}

/**
 * The selector a note's stamp names — a parsed ID even when no Profile
 * carries it — or `undefined` when the stamp holds none.
 */
export function noteProfileSelector(
  note: NoteProfile,
): ProfileSelector | undefined {
  return note.ok ? note.profile.selector : note.stamped.id;
}
