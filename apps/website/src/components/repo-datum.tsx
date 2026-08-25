import { Download, Star } from "lucide-react";
import { Fragment } from "react";

import { GithubMark } from "@/components/github-mark.tsx";
import { cn } from "@/lib/cn.ts";
import type { RepoStats } from "@/lib/release-data.ts";
import { gitConfig, repoUrl } from "@/lib/shared.ts";

/** Humanizes a count: under a thousand verbatim, else `N.MK` with a trailing `.0` stripped. */
function humanize(count: number): string {
  return count < 1000
    ? String(count)
    : `${(count / 1000).toFixed(1).replace(/\.0$/, "")}K`;
}

/**
 * The repository link with its live counters. Stars and downloads are dropped
 * one at a time when their lookup is unavailable; the link itself always
 * renders, since the repo has to stay reachable from the page.
 */
export function RepoDatum({
  stats,
  className,
}: {
  stats: RepoStats;
  className?: string;
}) {
  const counters = [
    stats.stars !== null
      ? { Icon: Star, label: "stars", value: humanize(stats.stars) }
      : null,
    stats.downloads !== null
      ? { Icon: Download, label: "downloads", value: humanize(stats.downloads) }
      : null,
  ].filter((counter) => counter !== null);

  return (
    <a
      href={repoUrl}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        "group inline-flex items-center gap-2.5 border-l-2 border-fd-primary py-[3px] pl-3 no-underline",
        className,
      )}
    >
      <GithubMark className="size-[15px] shrink-0 text-fd-primary" />
      <span className="font-mono text-[13px] tracking-[0.01em] text-fd-muted-foreground tabular-nums transition-colors group-hover:text-fd-foreground">
        <span className="underline decoration-transparent underline-offset-4 transition-colors group-hover:decoration-fd-border">
          {gitConfig.user}/{gitConfig.repo}
        </span>
        {counters.map(({ Icon, label, value }) => (
          <Fragment key={label}>
            <span aria-hidden className="mx-2 text-fd-muted-foreground/50">
              ·
            </span>
            <span
              aria-label={`${value} ${label}`}
              className="whitespace-nowrap"
            >
              <Icon
                aria-hidden
                className="mr-1 inline-block size-3 -translate-y-px align-middle text-fd-primary"
              />
              {value}
            </span>
          </Fragment>
        ))}
      </span>
    </a>
  );
}
