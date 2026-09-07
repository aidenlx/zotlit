// The Workbench route: a prerendered static shell whose editor bundle — the
// document core, CodeMirror, and the render Worker — loads in the browser only,
// so the page costs no Worker invocation. The shell paints the page's own
// frame as a skeleton, and the bundle's fetch starts as soon as this module
// evaluates rather than after hydration.
// @see docs/adr/0025-the-docs-site-prerenders-asset-first-and-falls-through-to-an-ssr-worker.md

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ComponentType } from "react";

import { pageHead } from "@/lib/seo";
import { WorkbenchSkeleton } from "@/lib/workbench/frame";
import { m } from "@/paraglide/messages.js";

// Requested at module evaluation in the browser alone: the prerender pass
// evaluates this module too, and a static shell has no editor to fetch.
const editor =
  typeof window === "undefined"
    ? null
    : import("@/lib/workbench/workbench").then(({ Workbench }) => Workbench);

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
    void editor?.then((Workbench) => setEditor(() => Workbench));
  }, []);

  if (!Editor) return <WorkbenchSkeleton />;
  return <Editor />;
}
