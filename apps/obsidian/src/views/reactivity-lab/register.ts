// PROTOTYPE (proto/view-reactivity) — throwaway. Registers the dev-only
// Reactivity Lab view and its command.
import type { Plugin } from "obsidian";

import { makeViewRegistry, seatedViewRegistry } from "./edge";
import type { ViewRegistryHandle } from "./edge";
import { labProbe } from "./source";
import { REACTIVITY_LAB_VIEW_TYPE, ReactivityLabView } from "./view";
import type { ReactivityLabDeps } from "./view";
import type { LabRuntime } from "./zustand-tab";

/** Local-storage key: "layer" seats the registry in pluginLayer, else plugin.register. */
const SEAT_KEY = "zotlit-lab-registry-seat";

export function registerReactivityLab(
  plugin: Pick<Plugin, "registerView" | "addCommand" | "app" | "register">,
  {
    runtime,
  }: {
    readonly runtime: LabRuntime & Parameters<typeof makeViewRegistry>[0];
  },
): void {
  plugin.register(() => labProbe.note("plugin.register callbacks"));
  const layerSeat = plugin.app.loadLocalStorage(SEAT_KEY) === "layer";
  labProbe.note(`registry seat: ${layerSeat ? "layer" : "register"}`);
  let registry: ViewRegistryHandle;
  if (layerSeat) {
    registry = seatedViewRegistry(runtime);
  } else {
    registry = makeViewRegistry(runtime);
    plugin.register(() => {
      labProbe.note("registry dispose (register seat)");
      registry.dispose();
    });
  }
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
