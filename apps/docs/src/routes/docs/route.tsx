import { Outlet, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { Root } from "fumadocs-core/page-tree";
import { DocsLayout } from "fumadocs-ui/layouts/docs";

import { DocsSubnav } from "@/components/docs-subnav.tsx";
import {
  Sidebar,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/layouts/docs/slots/sidebar.tsx";
import { withDocsAvailability } from "@/lib/docs-availability.ts";
import { baseOptions } from "@/lib/layout.shared.tsx";
import { source } from "@/lib/source.ts";

// The sidebar tree crosses the server boundary as JSON. Its `name` and `icon`
// fields are typed as React nodes, which the serializer rejects at the type
// level, so the tree travels as a bare `object`: every name in this site's
// content is a string and no entry declares an icon. Each page's NEW/UPDATED
// badge is derived here, so `semver` and the Docs Release Line stay on the
// server and the sidebar slot reads a plain string.
const getPageTree = createServerFn({ method: "GET" }).handler(
  () =>
    withDocsAvailability(source.pageTree, (item) => {
      const page = source.getNodePage(item);
      return (
        page && {
          introduced: page.data.introduced,
          updated: page.data.updated,
        }
      );
    }) as object,
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
      slots={{
        header: DocsSubnav,
        sidebar: {
          provider: SidebarProvider,
          root: Sidebar,
          trigger: SidebarTrigger,
          useSidebar,
        },
      }}
    >
      <Outlet />
    </DocsLayout>
  );
}
