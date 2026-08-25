import { createFileRoute } from "@tanstack/react-router";

import { DocsPageView, loadDocsPage } from "@/components/docs-page.tsx";

export const Route = createFileRoute("/docs/")({
  component: DocsIndex,
  loader: () => loadDocsPage(""),
});

function DocsIndex() {
  return <DocsPageView path={Route.useLoaderData().path} />;
}
