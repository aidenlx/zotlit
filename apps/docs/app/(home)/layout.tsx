import { HomeLayout } from "fumadocs-ui/layouts/home";

import { RedirectNotice } from "@/components/redirect-notice";
import { Header } from "@/layouts/home/slots/header";
import { baseOptions } from "@/lib/layout.shared";

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    // Serif is opt-in per surface (see DESIGN.md type roles), not blanket-
    // inherited here: the app-wide default is sans (Inter, via the <html>
    // font-family). Each (home) page roots its own `font-serif` on its <main>;
    // shared chrome (nav, banner, search) stays on the sans/mono stack.
    <HomeLayout {...baseOptions()} slots={{ header: Header }}>
      {/* Sits below the header, above page content, on every (home) route: the
          zh-CN locale strip lands Chinese visitors on /blog and /changelog too.
          Capped at the narrowest content column any of those pages uses (the
          rest run 4xl–5xl) so the notice is never wider than the page under it. */}
      <div className="mx-auto w-full max-w-3xl px-6">
        <RedirectNotice className="mt-6" />
      </div>
      {children}
    </HomeLayout>
  );
}
