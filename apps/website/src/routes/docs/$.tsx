import { createFileRoute } from "@tanstack/react-router";

import { DocsPageView, loadDocsPage } from "@/components/docs-page.tsx";

export const Route = createFileRoute("/docs/$")({
  component: DocsCatchAll,
  loader: ({ params }) => loadDocsPage(params._splat ?? ""),
});

function DocsCatchAll() {
  return <DocsPageView path={Route.useLoaderData().path} />;
}
