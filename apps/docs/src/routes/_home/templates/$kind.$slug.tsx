import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import directory from "virtual:zotlit/template-directory";

import { PartEntryPage } from "@/components/template-directory/part-entry";
import { ProfileEntryPage } from "@/components/template-directory/profile-entry";
import { pageHead } from "@/lib/seo";
import { appName } from "@/lib/shared";
import { breadcrumbListSchema } from "@/lib/structured-data";
import {
  DIRECTORY_PATH,
  entryId,
  entryIdParts,
  entryPath,
  isPartEntry,
} from "@/lib/template-directory/site";
import { m } from "@/paraglide/messages.js";

const getEntry = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(({ data: id }) => {
    const entry = directory.entries.find((candidate) => candidate.id === id);
    if (!entry) throw notFound();
    return entry;
  });

export const Route = createFileRoute("/_home/templates/$kind/$slug")({
  component: DirectoryEntryPage,
  loader: ({ params }) => getEntry({ data: entryId(params.kind, params.slug) }),
  staleTime: Infinity,
  head: ({ loaderData }) => {
    if (loaderData === undefined) return {};
    const entry = loaderData;
    return pageHead({
      title: entry.title,
      description: entry.summary,
      path: entryPath(entry.id),
      card: {
        type: "templates",
        slugs: entryIdParts(entry.id),
        alt: m.docs_directory_entry_og_alt({ title: entry.title }),
      },
      schemas: [
        breadcrumbListSchema([
          { name: appName, url: "/" },
          { name: m.docs_directory_title(), url: DIRECTORY_PATH },
          { name: entry.title, url: entryPath(entry.id) },
        ]),
      ],
    });
  },
});

function DirectoryEntryPage() {
  const entry = Route.useLoaderData();
  return isPartEntry(entry) ? (
    <PartEntryPage entry={entry} />
  ) : (
    <ProfileEntryPage entry={entry} />
  );
}
