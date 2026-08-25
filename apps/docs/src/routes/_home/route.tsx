import { Outlet, createFileRoute } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { RedirectNotice } from "@/components/redirect-notice.tsx";
import { Header } from "@/layouts/home/slots/header.tsx";
import { baseOptions } from "@/lib/layout.shared.tsx";

export const Route = createFileRoute("/_home")({
  component: HomeShell,
});

/** Chrome shared by the landing, blog, changelog, and community surfaces. */
function HomeShell() {
  return (
    // Serif is opt-in per surface (see apps/docs/DESIGN.md type roles), not blanket-
    // inherited here: the app-wide default is sans, and each page roots its own
    // `font-serif` on its <main>. Shared chrome — nav, banner, search — stays
    // on the sans/mono stack.
    <HomeLayout {...baseOptions()} slots={{ header: Header }}>
      {/* Sits below the header, above page content, on every home route: the
          zh-CN locale strip lands Chinese visitors on /blog and /changelog too.
          Capped at the narrowest content column any of those pages uses (the
          rest run 4xl–5xl) so the notice is never wider than the page under it. */}
      <div className="mx-auto w-full max-w-3xl px-6">
        <RedirectNotice className="mt-6" />
      </div>
      <Outlet />
    </HomeLayout>
  );
}
