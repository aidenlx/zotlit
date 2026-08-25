import { Outlet, createFileRoute } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { RedirectNotice } from "@/components/redirect-notice.tsx";
import { baseOptions } from "@/lib/layout.shared.tsx";

export const Route = createFileRoute("/_home")({
  component: HomeShell,
});

/** Chrome shared by the landing, blog, changelog, and community surfaces. */
function HomeShell() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="mx-auto w-full max-w-4xl px-6">
        <RedirectNotice className="mt-6" />
      </div>
      <Outlet />
    </HomeLayout>
  );
}
