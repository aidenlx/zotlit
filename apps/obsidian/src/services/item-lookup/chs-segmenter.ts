import { type App } from "obsidian";

import { type ChsSegmenter } from "@zotlit/item-lookup";

export function getChsSegmenter(
  app: App | null | undefined,
): ChsSegmenter | null {
  const plugin = app?.plugins?.plugins?.["cm-chs-patch"];
  if (!plugin || typeof plugin !== "object") return null;

  const cut = (plugin as { cut?: unknown }).cut;
  return typeof cut === "function" ? (plugin as ChsSegmenter) : null;
}
