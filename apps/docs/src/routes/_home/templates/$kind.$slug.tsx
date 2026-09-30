import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import directory from "virtual:zotlit/template-directory";

import { PartEntryPage } from "@/components/template-directory/part-entry";
import { ProfileEntryPage } from "@/components/template-directory/profile-entry";
import { pageHead } from "@/lib/seo";
import { appName } from "@/lib/shared";
import { breadcrumbListSchema } from "@/lib/structured-data";
import {
  calledPartials,
  DIRECTORY_PATH,
  entryId,
  entryIdParts,
  entryPath,
} from "@/lib/template-directory/site";
import { m } from "@/paraglide/messages.js";

const getEntry = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(({ data: id }) => {
    const entry = directory.entries.find((candidate) => candidate.id === id);
    if (!entry) throw notFound();
    // A Profile's Source tabs title every partial its file packs, called or not.
    const packed = new Set(
      entry.profileSource?.partials.flatMap(({ id: partialId }) =>
        partialId === null ? [] : [partialId],
      ),
    );
    const partials = [
      ...calledPartials(directory.entries, entry.calls),
      ...directory.entries.filter(
        (candidate) =>
          packed.has(candidate.id) &&
          !entry.calls.includes(entryIdParts(candidate.id)[1]),
      ),
    ];
    return {
      entry,
      partials: partials.map(({ id: partialId, title, summary }) => ({
        id: partialId,
        title,
        summary,
      })),
    };
  });

export const Route = createFileRoute("/_home/templates/$kind/$slug")({
  component: DirectoryEntryPage,
  loader: ({ params }) => getEntry({ data: entryId(params.kind, params.slug) }),
  staleTime: Infinity,
  head: ({ loaderData }) => {
    if (loaderData === undefined) return {};
    const { entry } = loaderData;
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
  const { entry, partials } = Route.useLoaderData();
  if (entry.kind === "profile") {
    return <ProfileEntryPage entry={entry} partials={partials} />;
  }
  return <PartEntryPage entry={entry} partials={partials} />;
}
