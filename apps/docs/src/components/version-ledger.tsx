// Current-version and compatibility ledger for the install pages.
import type { ReactNode } from "react";

import { useReleaseSnapshot } from "@/components/release-snapshot";
import type { ReleaseChannel } from "@/lib/github-releases";
import { formatReleaseInstant } from "@/lib/shared";

/** The channel label the ledger's first row carries. */
const channelLabels: Record<ReleaseChannel, string> = {
  "pre-release": "Pre-release",
  stable: "Stable",
};

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
 * Two-row leader-dots ledger showing the current release and its compatibility
 * range, read from the release snapshot the route loaded. A channel with
 * nothing to advertise — never released, or a dormant pre-release line —
 * renders a single status row instead; when the release facts could not be
 * fetched at all it renders nothing, so the page reads as its plain self.
 */
export function VersionLedger({ app, channel }: VersionLedgerProps) {
  const ledger = useReleaseSnapshot()?.[app][channel];
  if (!ledger) return null;

  const label = channelLabels[channel];
  if ("empty" in ledger) {
    return (
      <div className="not-prose mb-4 text-sm text-fd-foreground">
        <Row label={label}>
          <span className="text-fd-muted-foreground">{ledger.empty}</span>
        </Row>
      </div>
    );
  }

  return (
    <div className="not-prose mb-4 flex flex-col gap-1 text-sm text-fd-foreground tabular-nums">
      <Row label={label}>
        <a
          href={ledger.notesUrl}
          rel="noreferrer noopener"
          className="font-mono text-[0.8125rem] font-medium text-fd-primary hover:underline"
        >
          {ledger.version}
        </a>
        {ledger.publishedAt && (
          <span className="text-fd-muted-foreground">
            {" "}
            · {formatReleaseInstant(ledger.publishedAt)}
          </span>
        )}
      </Row>
      <Row label="Requires">
        {ledger.requires}
        {ledger.note && (
          <span className="text-fd-muted-foreground"> · {ledger.note}</span>
        )}
      </Row>
    </div>
  );
}
