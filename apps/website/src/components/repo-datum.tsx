import { Download, Star } from "lucide-react";
import { Fragment } from "react";

import { cn } from "@/lib/cn.ts";
import type { RepoStats } from "@/lib/release-data.ts";
import { gitConfig, repoUrl } from "@/lib/shared.ts";

/**
 * GitHub's mark, inlined rather than imported as an asset so it renders as
 * <svg> and inherits `currentColor` — the same shape as `ObsidianMark`.
 */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      viewBox="0 0 98 96"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
    >
      <path d="M41.4395 69.3848C28.8066 67.8535 19.9062 58.7617 19.9062 46.9902C19.9062 42.2051 21.6289 37.0371 24.5 33.5918C23.2559 30.4336 23.4473 23.7344 24.8828 20.959C28.7109 20.4805 33.8789 22.4902 36.9414 25.2656C40.5781 24.1172 44.4062 23.543 49.0957 23.543C53.7852 23.543 57.6133 24.1172 61.0586 25.1699C64.0254 22.4902 69.2891 20.4805 73.1172 20.959C74.457 23.543 74.6484 30.2422 73.4043 33.4961C76.4668 37.1328 78.0937 42.0137 78.0937 46.9902C78.0937 58.7617 69.1934 67.6621 56.3691 69.2891C59.623 71.3945 61.8242 75.9883 61.8242 81.252L61.8242 91.2051C61.8242 94.0762 64.2168 95.7031 67.0879 94.5547C84.4102 87.9512 98 70.6289 98 49.1914C98 22.1074 75.9883 6.69539e-07 48.9043 4.309e-07C21.8203 1.92261e-07 -1.9479e-07 22.1074 -4.3343e-07 49.1914C-6.20631e-07 70.4375 13.4941 88.0469 31.6777 94.6504C34.2617 95.6074 36.75 93.8848 36.75 91.3008L36.75 83.6445C35.4102 84.2188 33.6875 84.6016 32.1562 84.6016C25.8398 84.6016 22.1074 81.1563 19.4277 74.7441C18.375 72.1602 17.2266 70.6289 15.0254 70.3418C13.877 70.2461 13.4941 69.7676 13.4941 69.1934C13.4941 68.0449 15.4082 67.1836 17.3223 67.1836C20.0977 67.1836 22.4902 68.9063 24.9785 72.4473C26.8926 75.2227 28.9023 76.4668 31.2949 76.4668C33.6875 76.4668 35.2187 75.6055 37.4199 73.4043C39.0469 71.7773 40.291 70.3418 41.4395 69.3848Z" />
    </svg>
  );
}

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
      <span className="font-mono text-[13px] text-fd-muted-foreground tabular-nums transition-colors group-hover:text-fd-foreground">
        <span>
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
