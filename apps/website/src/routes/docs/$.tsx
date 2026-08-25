import { createFileRoute } from "@tanstack/react-router";

import {
  DocsPageView,
  docsPageHead,
  loadDocsPage,
} from "@/components/docs-page.tsx";

export const Route = createFileRoute("/docs/$")({
  component: DocsCatchAll,
  loader: ({ params }) => loadDocsPage(params._splat ?? ""),
  head: ({ loaderData }) => docsPageHead(loaderData),
});

function DocsCatchAll() {
  return <DocsPageView path={Route.useLoaderData().path} />;
}
