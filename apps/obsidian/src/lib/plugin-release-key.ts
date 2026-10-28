// The App key under which an unloaded plugin instance leaves its release.

/**
 * The description of the `Symbol.for` key on the App that holds the release
 * of the instance Obsidian unloaded last (`UnloadAwarePlugin`). The
 * End-to-end Run reads the same key to see a new instance wait.
 */
export const releaseKeyDescription = (pluginId: string): string =>
  `zotlit/obsidian/release/${pluginId}`;
