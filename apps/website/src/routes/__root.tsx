import { TanStackDevtools } from "@tanstack/react-devtools";
import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { RootProvider } from "fumadocs-ui/provider/tanstack";

import { baseOptions } from "@/lib/layout.shared.tsx";
import { HOME_OG_ALT, ogImageMeta } from "@/lib/seo.ts";
import { appDescription, appName, baseURL } from "@/lib/shared.ts";
import appCss from "@/styles.css?url";

export const Route = createRootRoute({
  // Site-wide defaults. A page's own `head` overrides these tag by tag, so a
  // route only names what differs — see `src/lib/seo.ts`.
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: appName },
      { name: "application-name", content: appName },
      { name: "description", content: appDescription },
      { property: "og:site_name", content: appName },
      { property: "og:locale", content: "en_US" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: baseURL },
      { property: "og:title", content: appName },
      { property: "og:description", content: appDescription },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: appName },
      { name: "twitter:description", content: appDescription },
      ...ogImageMeta("home", HOME_OG_ALT),
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {/* The search dialog fetches `/api/search`, the fumadocs default. */}
        <RootProvider>{children}</RootProvider>
        <TanStackDevtools
          config={{ position: "bottom-right" }}
          plugins={[
            {
              name: "TanStack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}

function NotFound() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-16">
        <h1 className="mb-2 text-3xl font-medium">Page not found</h1>
        <p className="text-fd-muted-foreground">
          That page has moved or never existed. Start from the{" "}
          <a href="/docs" className="text-fd-primary underline">
            documentation
          </a>
          .
        </p>
      </main>
    </HomeLayout>
  );
}
