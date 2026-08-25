import { createFileRoute } from "@tanstack/react-router";

import {
  DocsPageView,
  docsPageHead,
  loadDocsPage,
} from "@/components/docs-page.tsx";

export const Route = createFileRoute("/docs/")({
  component: DocsIndex,
  loader: () => loadDocsPage(""),
  head: ({ loaderData }) => docsPageHead(loaderData),
});

function DocsIndex() {
  return <DocsPageView path={Route.useLoaderData().path} />;
}
