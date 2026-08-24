// Server-rendered current-version & compatibility ledger for the install pages.
import type { ReactNode } from "react";

import {
  assetUrl,
  fetchGitHubJson,
  getReleases,
  getZoteroCompanion,
  isDormant,
  mainManifestUrl,
  newestPreRelease,
  tagUrl,
} from "@/lib/github-releases";
import type { ReleaseChannel } from "@/lib/github-releases";

interface PluginManifest {
  version: string;
  minAppVersion: string;
  isDesktopOnly?: boolean;
}

interface LedgerData {
  channel: "Pre-release" | "Stable";
  version: string;
  notesUrl: string;
  publishedAt?: string;
  requires: string;
  note?: string;
}

/** A channel with nothing to advertise: never released, or dormant. */
interface Empty {
  channel: LedgerData["channel"];
  empty: "not yet released" | "no pre-release available";
}

const dormant: Empty = {
  channel: "Pre-release",
  empty: "no pre-release available",
};

async function getObsidianLedger(
  channel: ReleaseChannel,
): Promise<LedgerData | Empty | null> {
  const stable = await fetchGitHubJson<PluginManifest>(mainManifestUrl());

  if (channel === "pre-release") {
    const releases = await getReleases();
    if (!releases) return null;
    const release = newestPreRelease(releases);
    if (!release || isDormant(release.tag_name, stable?.version ?? null))
      return dormant;
    const manifest = await fetchGitHubJson<PluginManifest>(
      assetUrl(release.tag_name, "manifest.json"),
    );
    if (!manifest) return null;
    return {
      channel: "Pre-release",
      version: manifest.version,
      notesUrl: tagUrl(release.tag_name),
      publishedAt: release.published_at,
      requires: `Obsidian ≥ ${manifest.minAppVersion}`,
      note: manifest.isDesktopOnly ? "desktop only" : undefined,
    };
  }

  if (!stable) return null;
  const release = (await getReleases())?.find(
    (r) => r.tag_name === stable.version,
  );
  return {
    channel: "Stable",
    version: stable.version,
    notesUrl: tagUrl(stable.version),
    publishedAt: release?.published_at,
    requires: `Obsidian ≥ ${stable.minAppVersion}`,
    note: stable.isDesktopOnly ? "desktop only" : undefined,
  };
}

async function getZoteroLedger(
  channel: ReleaseChannel,
): Promise<LedgerData | Empty | null> {
  const companion = await getZoteroCompanion(channel);
  if (channel === "pre-release") {
    const stable = await getZoteroCompanion("stable");
    if (!companion || isDormant(companion.version, stable?.version ?? null))
      return dormant;
  }
  if (!companion) return { channel: "Stable", empty: "not yet released" };
  const release = (await getReleases())?.find(
    (r) => r.tag_name === companion.tag,
  );
  return {
    channel: channel === "pre-release" ? "Pre-release" : "Stable",
    version: companion.version,
    notesUrl: tagUrl(companion.tag),
    publishedAt: release?.published_at,
    requires: formatZoteroRange(companion.minVersion, companion.maxVersion),
  };
}

/**
 * Reader-facing compatibility range from the Mozilla-style version bounds.
 * `strict_max_version` may be absent or carry a trailing `*` wildcard, where
 * the wildcard spans every release in that line (`9.*` covers 9.0–9.x, `7.0.*`
 * covers 7.0.x). Those collapse to an open range or a whole-line label instead
 * of leaking the raw `*`.
 * @see https://extensionworkshop.com/documentation/develop/browser-compatibility/
 */
function formatZoteroRange(min: string, max?: string): string {
  if (!max || max === "*") return `Zotero ${min} or newer`;
  if (max.endsWith(".*")) {
    const line = max.slice(0, -2); // "9.*" -> "9", "7.0.*" -> "7.0"
    return min === `${line}.0`
      ? `Zotero ${line}.x`
      : `Zotero ${min} – ${line}.x`;
  }
  return min === max ? `Zotero ${min}` : `Zotero ${min} – ${max}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="shrink-0 font-mono text-xs font-medium tracking-[0.08em] text-fd-muted-foreground uppercase">
        {label}
      </span>
      <span
        aria-hidden
        className="min-w-8 flex-1 -translate-y-1 border-b-2 border-dotted border-fd-border"
      />
      <span className="text-right">{children}</span>
    </div>
  );
}

export interface VersionLedgerProps {
  app: "obsidian" | "zotero";
  channel: ReleaseChannel;
}

/**
 * Two-row leader-dots ledger showing the current release and its
 * compatibility range, fetched from GitHub with ISR. A channel with nothing to
 * advertise — never released, or a dormant pre-release line — renders a single
 * status row instead; when release data can't be checked at all it renders
 * nothing, so the page degrades to its plain form.
 */
export async function VersionLedger({ app, channel }: VersionLedgerProps) {
  const data = await (
    app === "obsidian" ? getObsidianLedger(channel) : getZoteroLedger(channel)
  ).catch(() => null);
  if (!data) return null;

  if ("empty" in data) {
    return (
      <div className="not-prose mb-4 text-sm text-fd-foreground">
        <Row label={data.channel}>
          <span className="text-fd-muted-foreground">{data.empty}</span>
        </Row>
      </div>
    );
  }

  return (
    <div className="not-prose mb-4 flex flex-col gap-1 text-sm text-fd-foreground tabular-nums">
      <Row label={data.channel}>
        <a
          href={data.notesUrl}
          rel="noreferrer noopener"
          className="font-mono text-[0.8125rem] font-medium text-fd-primary hover:underline"
        >
          {data.version}
        </a>
        {data.publishedAt && (
          <span className="text-fd-muted-foreground">
            {" "}
            · {formatDate(data.publishedAt)}
          </span>
        )}
      </Row>
      <Row label="Requires">
        {data.requires}
        {data.note && (
          <span className="text-fd-muted-foreground"> · {data.note}</span>
        )}
      </Row>
    </div>
  );
}
