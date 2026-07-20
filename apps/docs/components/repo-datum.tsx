import cn from "cnfast";
// Ruled GitHub datum for the landing hero: live stars + downloads, degrading to just the slug when GitHub is unreachable.
import { Download, Star } from "lucide-react";
import { unstable_cache } from "next/cache";
import { Fragment } from "react";

import GithubMark from "@/assets/github.svg?svgr";
import { fetchGitHubJson, REVALIDATE_SECONDS } from "@/lib/github-releases";
import { gitConfig } from "@/lib/shared";

interface RepoStats {
  stargazers_count: number;
}

type PluginStats = Record<string, { downloads: number }>;

async function getStars(): Promise<number | null> {
  const data = await fetchGitHubJson<RepoStats>(
    `https://api.github.com/repos/${gitConfig.user}/${gitConfig.repo}`,
  ).catch(() => null);
  return data?.stargazers_count ?? null;
}

// The upstream community-plugin-stats blob is >2MB and can't go in the fetch
// data cache, so fetch it uncached and memoize only the one count we read.
const getDownloads = unstable_cache(
  async (): Promise<number | null> => {
    const data = await fetchGitHubJson<PluginStats>(
      "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json",
      { cache: "no-store" },
    ).catch(() => null);
    return data?.zotlit?.downloads ?? null;
  },
  ["obsidian-plugin-downloads"],
  { revalidate: REVALIDATE_SECONDS },
);

/** Humanizes a count like the hero prototype: <1000 verbatim, else `N.MK` with a trailing `.0` stripped. */
function humanize(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}K`;
}

/**
 * The sole GitHub link on the landing page: a 2px primary left bar (no box,
 * no background) with a leading github glyph and a muted-mono slug line.
 * Stars/downloads are dropped individually when their fetch is unavailable;
 * the datum itself always renders since the repo link must stay reachable.
 */
export async function RepoDatum({ className }: { className?: string }) {
  const [stars, downloads] = await Promise.all([getStars(), getDownloads()]);
  const stats = [
    stars !== null
      ? { Icon: Star, label: "stars", value: humanize(stars) }
      : null,
    downloads !== null
      ? { Icon: Download, label: "downloads", value: humanize(downloads) }
      : null,
  ].filter((s) => s !== null);

  return (
    <div className={cn("max-w-[460px]", className)}>
      <a
        href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
        target="_blank"
        rel="noreferrer noopener"
        className="group inline-flex items-center gap-2.5 border-l-2 border-fd-primary py-[3px] pl-3 no-underline"
      >
        <GithubMark
          aria-hidden
          className="size-[15px] shrink-0 text-fd-primary [&_path]:fill-current"
        />
        <span className="font-mono text-[13px] tracking-[0.01em] text-fd-muted-foreground tabular-nums transition-colors group-hover:text-fd-foreground">
          <span className="underline decoration-transparent underline-offset-4 transition-colors group-hover:decoration-fd-border">
            {gitConfig.user}/{gitConfig.repo}
          </span>
          {stats.map(({ Icon, label, value }) => (
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
    </div>
  );
}
