// A test host's `app` with the capability tags over its members, for a layer
// under test that reads both until it reads only the tags. Each capability tag
// adds its layer here, over the matching member of `app`.
import type { App } from "obsidian";

import { Layer } from "@/lib/effect";
import { ObsidianApp } from "@/lib/obsidian-app";
import { layerMetadataCacheFrom } from "@/lib/obsidian-metadata-cache";
import type { MetadataCache } from "@/lib/obsidian-metadata-cache";

/** `ObsidianApp` as `app`, and each capability tag over its member of `app`. */
export function layerHostApp(
  app: App,
): Layer.Layer<ObsidianApp | MetadataCache> {
  return Layer.mergeAll(layerMetadataCacheFrom(app.metadataCache)).pipe(
    Layer.provideMerge(Layer.succeed(ObsidianApp, app)),
  );
}
