import { Outlet, createFileRoute } from "@tanstack/react-router";

import { LearnHeader } from "@/components/learn/learn-header";
import { RedirectNotice } from "@/components/redirect-notice";

export const Route = createFileRoute("/learn")({
  component: LearnShell,
});

/**
 * The course's own chrome, outside the docs and home layouts: a minimal top
 * bar over one narrow column, so the page reads at half a screen beside
 * Obsidian. A v1 permalink can land here, so the redirect notice rides along.
 */
function LearnShell() {
  return (
    <>
      <LearnHeader />
      <div className="mx-auto w-full max-w-[720px] px-5 empty:hidden">
        <RedirectNotice className="mt-5" />
      </div>
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </>
  );
}
