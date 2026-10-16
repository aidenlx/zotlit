// The one place ZotLit reads Obsidian's private embed registry, which draws
// `![[file.ext]]` for a file type; Bases embeds its `.base` files through it.
// A build without the registry gets no ZotLit embed: Obsidian then draws its
// own file card, which opens the file.
//
// @see apps/obsidian/docs/adr/0068-query-files-are-a-zotlit-file-type-embedded-through-the-private-embed-registry.md
import type { App, EmbedCreator } from "obsidian";

import { getLogger } from "@/lib/log";

export type { EmbedComponent, EmbedContext, EmbedCreator } from "obsidian";

const logger = getLogger(["obsidian-private", "embed-registry"]);

/**
 * Draw `![[file.<extension>]]` with `creator`.
 *
 * @returns the callback that removes the creator, or `null` after one `warn`
 *   when this Obsidian build has no registry to take it.
 */
export function registerEmbed(
  app: App,
  extension: string,
  creator: EmbedCreator,
): (() => void) | null {
  const registry = app.embedRegistry;
  const register = registry?.registerExtension;
  const unregister = registry?.unregisterExtension;
  const isRegistered = registry?.isExtensionRegistered;
  if (!registry || !register || !unregister || !isRegistered) {
    logger.warn(
      "Obsidian's embed registry is missing; embeds show Obsidian's file card",
      {
        extension,
        missing: Object.entries({
          embedRegistry: registry,
          registerExtension: register,
          unregisterExtension: unregister,
          isExtensionRegistered: isRegistered,
        })
          .filter(([, member]) => member === undefined)
          .map(([name]) => name),
      },
    );
    return null;
  }
  // A plugin reload that left its creator behind would make the register throw.
  if (isRegistered.call(registry, extension))
    unregister.call(registry, extension);
  register.call(registry, extension, creator);
  return () => unregister.call(registry, extension);
}
