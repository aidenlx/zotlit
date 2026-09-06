// ProfileReader test double for consumers; registry behavior is tested with a vault.
import type { MetadataCache } from "obsidian";

import { readProfileStamp } from "@/lib/profile-stamp";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { bindProfile } from "@/services/profile/bindings";
import type { ResolvedProfile } from "@/services/profile/bindings";
import type { LiteratureNoteProfile, ProfileReader } from "@/services/profile/service";
import { compileProfileMatch } from "@/services/profile-selection";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

export type ProfileFixture = Pick<LiteratureNoteProfile, "id" | "label"> & Partial<Pick<LiteratureNoteProfile, "document" | "bindings" | "path" | "match">>;
export type ProfileFixtureSettings = Settings & { profiles?: readonly ProfileFixture[]; defaultDocument?: string };

export function profileReader(
  settings: ProfileFixtureSettings | (() => ProfileFixtureSettings) = defaults,
  metadataCache: Pick<MetadataCache, "getFileCache"> = { getFileCache: () => null },
): ProfileReader {
  const current = () => typeof settings === "function" ? settings() : settings;
  return {
    ready: Promise.resolve(), loaded: true,
    on: () => () => {},
    get profiles() { return (current().profiles ?? []).map((entry) => ({ document: `zotlit-profile.${entry.label.toLowerCase()}.md`, path: "", bindings: {}, match: compileProfileMatch(undefined, []), ...entry })); },
    resolveProfile(selector) { return resolveProfile(current(), selector); },
    profileOf(file) {
      const stamp = file && readProfileStamp(metadataCache, file);
      const profile = stamp === undefined ? resolveProfile(current(), "default") : stamp.id && resolveProfile(current(), stamp.id);
      return profile ? { ok: true, profile } : { ok: false, stamped: stamp! };
    },
  };
}

export function resolveProfile(settings: ProfileFixtureSettings, selector: "default"): ResolvedProfile;
export function resolveProfile(settings: ProfileFixtureSettings, selector: ProfileSelector): ResolvedProfile | undefined;
export function resolveProfile(settings: ProfileFixtureSettings, selector: ProfileSelector): ResolvedProfile | undefined {
  const entry = settings.profiles?.find(({ id }) => id === selector);
  if (selector !== "default" && !entry) return undefined;
  return bindProfile(settings, { selector, document: entry?.document ?? (selector === "default" ? settings.defaultDocument : undefined), entry: entry && { path: "", document: "", bindings: {}, match: compileProfileMatch(undefined, []), ...entry } });
}
