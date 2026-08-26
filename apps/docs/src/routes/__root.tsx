import gelasioLatinItalic from "@fontsource-variable/gelasio/files/gelasio-latin-wght-italic.woff2?url";
import gelasioLatin from "@fontsource-variable/gelasio/files/gelasio-latin-wght-normal.woff2?url";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { RootProvider } from "fumadocs-ui/provider/tanstack";

import { LegacyBanner } from "@/components/legacy-banner";
import { Header } from "@/layouts/home/slots/header";
import { baseOptions } from "@/lib/layout.shared";
import { HOME_OG_ALT, ogImageMeta } from "@/lib/seo";
import { appDescription, appName, baseURL } from "@/lib/shared";
import appCss from "@/styles.css?url";

/**
 * Cloudflare Web Analytics, the privacy-friendly counter that replaced Vercel
 * Analytics at the move off Vercel. The site token is public — it identifies
 * the property, not the account — and rides in at build time, so a checkout
 * without one simply serves no beacon.
 */
const analyticsToken: string | undefined = import.meta.env.VITE_CF_BEACON_TOKEN;

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
    links: [
      { rel: "stylesheet", href: appCss },
      // `.ico` leads for the browsers that pass over an SVG icon; it pairs the
      // 16 px pixel-fit cut with the master tile at 32. Both editions are the
      // tile rather than the bare mark, which is what keeps them legible on a
      // dark tab bar.
      // @see docs/brand.md → Tile padding
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      // Serif display paints on essentially every route, so both its latin
      // faces are fetched eagerly — upright for headlines, italic for the lede
      // and standfirst lines that ride beside them. Inter and IBM Plex Mono
      // stay unpreloaded: both swap in from a system fallback of the same
      // class. The Archivo wordmark needs no entry — it is small enough that
      // Vite inlines it into the stylesheet.
      // @see apps/docs/DESIGN.md → Font loading
      ...[gelasioLatin, gelasioLatinItalic].map((href) => ({
        rel: "preload",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous" as const,
        href,
      })),
    ],
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
      <body className="flex min-h-screen flex-col">
        {/* The search dialog fetches `/api/search`, the fumadocs default. */}
        <RootProvider>
          <LegacyBanner />
          {children}
        </RootProvider>
        {analyticsToken && (
          <script
            defer
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: analyticsToken })}
          />
        )}
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
    // The owned header rides along, so the nav reads the same here as on every
    // other surface — this page renders outside the `_home` shell.
    <HomeLayout {...baseOptions()} slots={{ header: Header }}>
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
