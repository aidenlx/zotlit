import { Link, createFileRoute } from "@tanstack/react-router";

import { appDescription } from "@/lib/shared.ts";

export const Route = createFileRoute("/_home/")({
  component: Home,
});

const features = [
  {
    term: "Literature notes",
    href: "/docs/tutorial/first-note",
    ref: "Tutorial →",
    description:
      "One command turns a Zotero item into a Markdown note, shaped by your template.",
  },
  {
    term: "Citations",
    href: "/docs/how-to/insert-citations",
    ref: "How-to →",
    description:
      "Type to search your library and insert citations without leaving the editor.",
  },
  {
    term: "Annotation view",
    href: "/docs/how-to/use-annotation-view",
    ref: "How-to →",
    description:
      "A sidebar of highlights and notes that follows your active Zotero reader.",
  },
  {
    term: "Note import",
    href: "/docs/how-to/import-zotero-notes",
    ref: "How-to →",
    description:
      "Bring Zotero child notes and standalone notes into your vault as Markdown.",
  },
  {
    term: "Agent-assisted templates",
    href: "/docs/install-skill",
    ref: "How-to →",
    description:
      "Describe the note you want. Your agent edits and tests its templates against your Zotero library.",
  },
];

function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-14">
      <h1 className="mb-4 text-4xl font-medium text-balance">
        Your Zotero library, written into your vault.
      </h1>
      <p className="mb-6 max-w-[60ch] text-lg text-fd-muted-foreground">
        {appDescription}
      </p>
      <p className="mb-10 flex flex-wrap gap-4">
        <Link to="/docs/$" params={{ _splat: "tutorial/first-note" }}>
          Get started
        </Link>
        <Link to="/docs">Read the docs</Link>
      </p>

      <dl className="border-t border-fd-border pt-6">
        {features.map((feature) => (
          <div key={feature.term} className="py-3">
            <dt className="font-medium">
              {feature.term} —{" "}
              <a href={feature.href} className="text-fd-primary">
                {feature.ref}
              </a>
            </dt>
            <dd className="max-w-[60ch] text-fd-muted-foreground">
              {feature.description}
            </dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
