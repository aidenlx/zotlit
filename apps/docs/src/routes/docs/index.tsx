import { createFileRoute } from "@tanstack/react-router";

import {
  DocsPageView,
  docsPageHead,
  loadDocsPage,
} from "@/components/docs-page";

export const Route = createFileRoute("/docs/")({
  component: DocsIndex,
  loader: () => loadDocsPage(""),
  head: ({ loaderData }) => docsPageHead(loaderData),
});

function DocsIndex() {
  const page = Route.useLoaderData();
  return (
    <DocsPageView
      path={page.path}
      snapshot={page.snapshot}
      availability={page.availability}
      changelogUrl={page.changelogUrl}
      githubUrl={page.githubUrl}
      markdownUrl={page.markdownUrl}
    />
  );
}
