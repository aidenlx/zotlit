import { Outlet, createFileRoute } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { baseOptions } from "@/lib/layout.shared.tsx";

export const Route = createFileRoute("/_home")({
  component: HomeShell,
});

/** Chrome shared by the landing, blog, changelog, and community surfaces. */
function HomeShell() {
  return (
    <HomeLayout {...baseOptions()}>
      <Outlet />
    </HomeLayout>
  );
}
