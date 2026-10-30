// Shared in-memory baseline composition for native preview and CLI checks.
import { getFrontMatterInfo, parseYaml } from "obsidian";

import { replaceManagedRegion } from "@zotlit/templates/obsidian";

/** Keep the real note's outside body and unrelated Properties, entirely in memory. */
export function previewBaseline(
  source: string | null,
  created: string,
  managed: string | null,
) {
  const info = source === null ? null : getFrontMatterInfo(source);
  const current: unknown = info?.exists ? parseYaml(info.frontmatter) : {};
  const frontmatter: Record<string, unknown> =
    current !== null && typeof current === "object" && !Array.isArray(current)
      ? { ...current }
      : {};
  const body = source === null ? created : source.slice(info!.contentStart);
  return {
    frontmatter,
    body:
      managed === null
        ? body
        : replaceManagedRegion(body, () => managed).content,
  };
}
