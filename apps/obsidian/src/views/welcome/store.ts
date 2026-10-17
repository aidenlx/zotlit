// Per-instance store for one Welcome View banner: the Migration Prompt flag, the dismissal, the request to show it, the connection readout, and the seeded literature-notes folder, with the one decision of which sections the banner shows.
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
  /**
   * The researcher asked for the banner ("Open welcome view", "Review
   * conversion") in this session; a dismissal puts it away.
   */
  requested: boolean;
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

/** What the banner shows, section by section; each is absent while it does not apply. */
export interface BannerSections {
  /** The setup steps, with the links under them. */
  readonly steps: boolean;
  /** The template conversion: its offer while it is pending, else its result. */
  readonly conversion: "offer" | "result" | null;
  /** The Migration Prompt: the guide to the v1 templates still in the vault. */
  readonly migration: boolean;
  /** The Zotero 10 guidance for ZotLit Companion, for a v1 upgrade. */
  readonly companion: boolean;
}

/**
 * The one decision of what the banner shows. The Migration Prompt of a v1
 * upgrade shows until a dismissal acknowledges it. Otherwise nothing shows
 * once the researcher dismissed the banner. The setup steps show while setup
 * is incomplete (once the connection is known, so a complete setup never
 * flashes), and whenever the researcher asked for the banner; the template
 * conversion offer shows while it is pending, and its result while cleanup
 * remains or the steps show.
 *
 * @returns `null` where the banner shows nothing.
 * @see apps/obsidian/docs/adr/0076-the-library-view-is-the-first-screen.md
 */
export function bannerSections(state: WelcomeState): BannerSections | null {
  if (state.dismissed && !state.migrationPending) return null;
  const incomplete =
    state.connection.status !== "checking" &&
    !(state.connection.status === "connected" && state.literatureFolderExists);
  const steps = state.requested || state.migrationPending || incomplete;
  const result = state.templateConversionResult;
  const conversion = state.templateConversionPending
    ? "offer"
    : result && (steps || result.pendingCleanup.length > 0)
      ? "result"
      : null;
  const sections: BannerSections = {
    steps,
    conversion,
    migration: steps && conversion === null && state.v1TemplatesPresent,
    companion: state.migrationPending,
  };
  return steps || conversion !== null ? sections : null;
}

export type WelcomeStore = ReturnType<typeof createWelcomeStore>;

export function createWelcomeStore() {
  return createStore<WelcomeState>()(() => ({
    migrationPending: false,
    dismissed: false,
    requested: false,
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
