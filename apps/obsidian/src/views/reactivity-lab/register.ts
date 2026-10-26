// PROTOTYPE (proto/view-reactivity) — throwaway. Registers the dev-only
// Reactivity Lab view and its command.
import type { Plugin } from "obsidian";

import { makeViewRegistry } from "./edge";
import { REACTIVITY_LAB_VIEW_TYPE, ReactivityLabView } from "./view";
import type { ReactivityLabDeps } from "./view";
import type { LabRuntime } from "./zustand-tab";

export function registerReactivityLab(
  plugin: Pick<Plugin, "registerView" | "addCommand" | "app" | "register">,
  {
    runtime,
  }: { readonly runtime: LabRuntime & Parameters<typeof makeViewRegistry>[0] },
): void {
  // Production seat: a scoped Layer in pluginLayer that acquires the registry
  // and disposes it with the other services.
  const registry = makeViewRegistry(runtime);
  plugin.register(() => registry.dispose());
  const deps: ReactivityLabDeps = { runtime, registry };
  plugin.registerView(
    REACTIVITY_LAB_VIEW_TYPE,
    (leaf) => new ReactivityLabView(leaf, deps),
  );
  plugin.addCommand({
    id: "open-reactivity-lab",
    name: "Open reactivity lab (prototype)",
    callback: async () => {
      const leaf = plugin.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: REACTIVITY_LAB_VIEW_TYPE, active: true });
    },
  });
}
