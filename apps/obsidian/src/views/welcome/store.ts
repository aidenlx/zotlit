// Per-instance store for one Welcome View: mode, one-shot connection readout, and the seeded literature-notes folder.
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type { Settings } from "@/services/settings/schema";

import type { ConnectionReadout } from "./connection";

export interface WelcomeState {
  /** Upgraded mode changes the Companion guidance and hides the footer migration link. */
  mode: "fresh" | "upgraded";
  connection: ConnectionReadout;
  /** Current `note.literature-folder` setting; seeded once by the view on open. */
  literatureFolder: string;
  /** The legacy Literature Note Template slots await user-consented conversion. */
  templateConversionPending: boolean;
  templateFolder: string;
  templateConversionResult: Settings["note.template-conversion-result"];
  v1TemplatesPresent: boolean;
}

export type WelcomeStore = ReturnType<typeof createWelcomeStore>;

export function createWelcomeStore() {
  return createStore<WelcomeState>()(() => ({
    mode: "fresh",
    connection: { status: "checking" },
    literatureFolder: "",
    templateConversionPending: false,
    templateFolder: "",
    templateConversionResult: null,
    v1TemplatesPresent: false,
  }));
}

const WelcomeStoreContext = createContext<WelcomeStore | null>(null);
export const WelcomeStoreProvider = WelcomeStoreContext.Provider;

function useWelcomeStoreApi(): WelcomeStore {
  const store = useContext(WelcomeStoreContext);
  if (!store) {
    throw new Error("useWelcomeStore must be used within WelcomeStoreProvider");
  }
  return store;
}

export function useWelcomeStore<T>(selector: (s: WelcomeState) => T): T {
  return useStore(useWelcomeStoreApi(), selector);
}
