import { DocsLayout } from "fumadocs-ui/layouts/docs";

import { DocsSubnav } from "@/components/docs-subnav";
import {
  Sidebar,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/layouts/docs/slots/sidebar";
import { withDocsAvailability } from "@/lib/docs-availability";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";

export default function Layout({ children }: LayoutProps<"/docs">) {
  const tree = withDocsAvailability(source.getPageTree(), (item) => {
    const page = source.getNodePage(item);
    return page
      ? {
          introduced: page.data.introduced,
          updated: page.data.updated,
        }
      : undefined;
  });

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
      {children}
    </DocsLayout>
  );
}
