// The vault's Obsidian App, as a service the Effect layers read.
import { Context } from "effect";
import type { App } from "obsidian";

/** The Obsidian `App` of the vault the plugin runs in. */
export class ObsidianApp extends Context.Service<ObsidianApp, App>()(
  "zotlit/obsidian/ObsidianApp",
) {}
