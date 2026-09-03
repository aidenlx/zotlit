// The Workbench route: a prerendered static shell whose editor bundle — the
// document core, CodeMirror, and the render Worker — loads in the browser only,
// so the page costs no Worker invocation.
// @see docs/adr/0025-the-docs-site-prerenders-asset-first-and-falls-through-to-an-ssr-worker.md

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ComponentType } from "react";

import { pageHead } from "@/lib/seo";
import { m } from "@/paraglide/messages.js";

export const Route = createFileRoute("/workbench")({
  component: WorkbenchPage,
  head: () =>
    pageHead({
      title: m.workbench_title(),
      description: m.workbench_description(),
      path: "/workbench",
      card: { type: "workbench", alt: m.workbench_title() },
    }),
});

function WorkbenchPage() {
  const [Editor, setEditor] = useState<ComponentType | null>(null);

  useEffect(() => {
    void import("@/lib/workbench/workbench").then(({ Workbench }) => {
      setEditor(() => Workbench);
    });
  }, []);

  if (!Editor) {
    return (
      <main className="flex h-dvh flex-col items-center justify-center gap-2 px-6">
        <h1 className="font-serif text-2xl font-medium">
          {m.workbench_title()}
        </h1>
        <p className="text-fd-muted-foreground italic">
          {m.workbench_loading()}
        </p>
      </main>
    );
  }
  return <Editor />;
}
