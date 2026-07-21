import DiscordMark from "@/assets/discord.svg?svgr";
import GithubMark from "@/assets/github.svg?svgr";
import { RepoDatum } from "@/components/repo-datum";
import { SiteFooter } from "@/components/site-footer";
import { gitConfig, ogImageUrl } from "@/lib/shared";

export const metadata = {
  title: "Community",
  description: "Get help, share ideas, and shape where ZotLit goes next.",
  alternates: { canonical: "/community" },
  openGraph: { images: ogImageUrl("community") },
};

const destinations: Array<{
  label: string;
  title: string;
  description: string;
  cta: string;
  href: string;
  Icon: typeof GithubMark;
}> = [
  {
    label: "Discord",
    title: "Chat & get help",
    description:
      "Ask questions, get unstuck fast, and see how other users wire Zotero into their vaults.",
    cta: "Join the server",
    href: "https://discord.gg/CpVTHcReAe",
    Icon: DiscordMark,
  },
  {
    label: "GitHub",
    title: "Ideas & bug reports",
    description:
      "Post feature requests, report bugs, and have in-depth threads about research workflows.",
    cta: "Open Discussions",
    href: `https://github.com/${gitConfig.user}/${gitConfig.repo}/discussions`,
    Icon: GithubMark,
  },
];

export default function CommunityPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6">
      <header className="max-w-2xl pt-16 pb-2">
        <p className="mb-4 font-mono text-xs font-semibold tracking-[0.2em] text-fd-primary uppercase">
          Community
        </p>
        <h1 className="mb-3 text-4xl leading-[1.16] font-medium text-balance lg:text-[44px]">
          Join the conversation.
        </h1>
        <p className="max-w-[46ch] text-lg text-fd-muted-foreground italic">
          ZotLit is built in the open — come ask, argue, and help decide what
          ships next.
        </p>
        <RepoDatum className="mt-5" />
      </header>

      <section className="grid gap-7 py-10 sm:grid-cols-2">
        {destinations.map(({ label, title, description, cta, href, Icon }) => (
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
            <Icon
              aria-hidden
              className="size-7 shrink-0 text-fd-primary [&_path]:fill-current"
            />
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
        ))}
      </section>

      <SiteFooter />
    </main>
  );
}
