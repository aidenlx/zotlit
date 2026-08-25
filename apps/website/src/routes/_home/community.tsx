import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { RepoDatum } from "@/components/repo-datum.tsx";
import { getRepoStats } from "@/lib/release-data.ts";
import { pageHead } from "@/lib/seo.ts";
import { repoUrl } from "@/lib/shared.ts";

/** Live star and download counts, fetched per request with ~1h edge caching. */
const loadRepoStats = createServerFn({ method: "GET" }).handler(() =>
  getRepoStats(),
);

export const Route = createFileRoute("/_home/community")({
  component: Community,
  loader: () => loadRepoStats(),
  head: () =>
    pageHead({
      title: "Community",
      description: "Get help, share ideas, and shape where ZotLit goes next.",
      path: "/community",
      card: { type: "community", alt: "ZotLit Community" },
    }),
});

const destinations = [
  {
    label: "Discord",
    title: "Chat & get help",
    description:
      "Ask questions, get unstuck fast, and see how other users wire Zotero into their vaults.",
    cta: "Join the server",
    href: "https://discord.gg/CpVTHcReAe",
  },
  {
    label: "Discussions",
    title: "Ideas & bug reports",
    description:
      "Post feature requests, report bugs, and have in-depth threads about research workflows.",
    cta: "Open Discussions",
    href: `${repoUrl}/discussions`,
  },
];

function Community() {
  const stats = Route.useLoaderData();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-14">
      <h1 className="mb-3 text-4xl font-medium">Join the conversation.</h1>
      <p className="mb-6 max-w-[60ch] text-lg text-fd-muted-foreground">
        ZotLit is built in the open — come ask, argue, and help decide what
        ships next.
      </p>
      <RepoDatum stats={stats} className="mb-10" />

      <ul className="flex flex-col gap-6">
        {destinations.map(({ label, title, description, cta, href }) => (
          <li key={label} className="border-t border-fd-border pt-4">
            <h2 className="text-xl font-medium">{title}</h2>
            <p className="max-w-[60ch] text-fd-muted-foreground">
              {description}
            </p>
            <p className="mt-2">
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="text-fd-primary"
              >
                {cta} →
              </a>
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
