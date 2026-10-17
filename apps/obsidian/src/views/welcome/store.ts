// Per-instance store for one Welcome View banner: the Migration Prompt flag, the dismissal, the connection readout, and the seeded literature-notes folder.
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type { Settings } from "@/services/settings/schema";

import type { ConnectionReadout } from "./connection";

export interface WelcomeState {
  /**
   * `release.migration-pending`: the upgraded state, whose Migration Prompt
   * stays on screen until it is acknowledged. The fresh state shows the
   * footer migration link instead.
   */
  migrationPending: boolean;
  /** `welcome.dismissed`: the researcher put the banner away. */
  dismissed: boolean;
  connection: ConnectionReadout;
  /** Current `note.literature-folder` setting; seeded once by the view on open. */
  literatureFolder: string;
  /** The literature-notes folder exists in the vault. */
  literatureFolderExists: boolean;
  /** The legacy Literature Note Template slots await user-consented conversion. */
  templateConversionPending: boolean;
  templateFolder: string;
  templateConversionResult: Settings["note.template-conversion-result"];
  v1TemplatesPresent: boolean;
}

/**
 * Whether the banner shows: the Migration Prompt of a v1 upgrade always,
 * the setup steps until the researcher dismisses them or the library is
 * connected and the literature-notes folder exists. While the connection is
 * still being checked, the steps wait, so a complete setup never flashes.
 */
export function welcomeShown(state: WelcomeState): boolean {
  if (state.migrationPending) return true;
  if (state.dismissed || state.connection.status === "checking") return false;
  return !(
    state.connection.status === "connected" && state.literatureFolderExists
  );
}

export type WelcomeStore = ReturnType<typeof createWelcomeStore>;

export function createWelcomeStore() {
  return createStore<WelcomeState>()(() => ({
    migrationPending: false,
    dismissed: false,
    connection: { status: "checking" },
    literatureFolder: "",
    literatureFolderExists: false,
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
