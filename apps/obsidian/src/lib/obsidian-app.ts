// The vault's Obsidian App, as a service the Effect layers read.
import type { App } from "obsidian";

import { Context } from "@/lib/effect";

/** The Obsidian `App` of the vault the plugin runs in. */
export class ObsidianApp extends Context.Service<ObsidianApp, App>()(
  "zotlit/obsidian/ObsidianApp",
) {}
