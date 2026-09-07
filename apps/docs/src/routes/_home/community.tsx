import { createFileRoute } from "@tanstack/react-router";

import { DiscordMark } from "@/components/discord-mark";
import { GithubMark } from "@/components/github-mark";
import { RepoDatum, loadRepoStats } from "@/components/repo-datum";
import { SiteFooter } from "@/components/site-footer";
import { pageHead } from "@/lib/seo";
import { repoUrl } from "@/lib/shared";
import { m } from "@/paraglide/messages.js";

export const Route = createFileRoute("/_home/community")({
  component: Community,
  loader: () => loadRepoStats(),
  head: () =>
    pageHead({
      title: m.docs_nav_community(),
      description: m.docs_community_description(),
      path: "/community",
      card: { type: "community", alt: m.docs_community_og_alt() },
    }),
});

const destinations = () => [
  {
    label: m.docs_community_discord(),
    title: m.docs_community_chat_title(),
    description: m.docs_community_chat_description(),
    cta: m.docs_community_join(),
    href: "https://discord.gg/CpVTHcReAe",
    Mark: DiscordMark,
  },
  {
    label: m.docs_community_discussions(),
    title: m.docs_community_ideas_title(),
    description: m.docs_community_ideas_description(),
    cta: m.docs_community_open_discussions(),
    href: `${repoUrl}/discussions`,
    Mark: GithubMark,
  },
];

function Community() {
  const stats = Route.useLoaderData();
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 font-serif">
      <header className="max-w-2xl pt-16 pb-2">
        <p className="mb-4 font-mono text-xs font-semibold tracking-[0.2em] text-fd-primary uppercase">
          {m.docs_nav_community()}
        </p>
        <h1 className="mb-3 text-4xl leading-[1.16] font-medium text-balance lg:text-[44px]">
          {m.docs_community_heading()}
        </h1>
        <p className="max-w-[46ch] text-lg text-fd-muted-foreground italic">
          {m.docs_community_intro()}
        </p>
        <RepoDatum stats={stats} className="mt-5" />
      </header>

      <section className="grid gap-7 py-10 sm:grid-cols-2">
        {destinations().map(
          ({ label, title, description, cta, href, Mark }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="group relative flex min-h-63 flex-col border border-fd-border bg-fd-card p-7 no-underline shadow-[6px_6px_0_0_var(--color-fd-border)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:border-fd-primary hover:shadow-[6px_6px_0_0_var(--color-fd-primary)]"
            >
              <span
                aria-hidden
                className="absolute -top-1.75 right-7.5 h-9.5 w-5 bg-fd-primary [clip-path:polygon(0_0,100%_0,100%_100%,50%_74%,0_100%)]"
              />
              <Mark className="size-7 shrink-0 text-fd-primary" />
              <span className="mt-4 font-mono text-xs font-semibold tracking-[0.12em] text-fd-muted-foreground uppercase">
                {label}
              </span>
              <h2 className="mt-1 text-[1.6rem] font-medium">{title}</h2>
              <p className="mt-2.5 leading-relaxed text-fd-muted-foreground">
                {description}
              </p>
              <span className="mt-auto inline-flex items-center gap-2 pt-6 font-mono text-xs font-semibold tracking-[0.12em] text-fd-primary uppercase">
                {cta}
                <span
                  aria-hidden
                  className="text-base transition-transform group-hover:translate-x-1"
                >
                  →
                </span>
              </span>
            </a>
          ),
        )}
      </section>

      <SiteFooter />
    </main>
  );
}
