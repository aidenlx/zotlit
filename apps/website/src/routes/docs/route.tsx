import { Outlet, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { Root } from "fumadocs-core/page-tree";
import { DocsLayout } from "fumadocs-ui/layouts/docs";

import { baseOptions } from "@/lib/layout.shared.tsx";
import { source } from "@/lib/source.ts";

// The sidebar tree crosses the server boundary as JSON. Its `name` and `icon`
// fields are typed as React nodes, which the serializer rejects at the type
// level, so the tree travels as a bare `object`: every name in this site's
// content is a string and no entry declares an icon.
const getPageTree = createServerFn({ method: "GET" }).handler(
  () => source.pageTree as object,
);

export const Route = createFileRoute("/docs")({
  component: DocsShell,
  loader: () => getPageTree(),
});

function DocsShell() {
  const tree = Route.useLoaderData() as Root;

  return (
    <DocsLayout
      tree={tree}
      {...baseOptions({ includeDocsLink: false })}
      sidebar={{ defaultOpenLevel: 1 }}
    >
      <Outlet />
    </DocsLayout>
  );
}
