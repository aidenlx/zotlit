// The plugin as a service the Effect layers register their commands on.
import type { Plugin } from "obsidian";

import type { CliHost } from "@/lib/cli-command";
import { Context } from "@/lib/effect";

/** What a layer registers on: Obsidian commands, zotlit:* commands, and the manifest. */
export type PluginHostShape = Pick<Plugin, "addCommand" | "app" | "manifest"> &
  CliHost;

/** The plugin the layer graph runs in. */
export class PluginHost extends Context.Service<PluginHost, PluginHostShape>()(
  "zotlit/obsidian/PluginHost",
) {}
