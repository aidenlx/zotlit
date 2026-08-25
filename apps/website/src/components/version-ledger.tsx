import type { ReleaseChannel } from "@/lib/github-releases.ts";

export interface VersionLedgerProps {
  app: "obsidian" | "zotero";
  channel: ReleaseChannel;
}

/**
 * Current release and compatibility range for an install page. Release facts
 * come from GitHub at request time, which the routing shell does not fetch yet,
 * so the ledger renders its documented degraded form — nothing — and the page
 * reads as its plain self.
 */
// oxlint-disable-next-line no-unused-vars -- the props are the contract the MDX writes against
export function VersionLedger(props: VersionLedgerProps) {
  return null;
}
