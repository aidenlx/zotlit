// Per-instance store for one Welcome View banner: the Migration Prompt flag, the pending update, the dismissal, the request to show it, the connection readout, and the seeded literature-notes folder, with the one decision of which sections the banner shows.
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
  /**
   * How many times the researcher asked for the banner in this session; each
   * request moves focus to it.
   */
  requests: number;
  /**
   * The researcher converted the templates in this session: the banner keeps
   * the result they asked for until a dismissal.
   */
  converted: boolean;
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
  /**
   * ZotLit cannot read the Zotero data folder the settings name, so the
   * Library View under the banner shows its not-found card.
   */
  notFound: boolean;
  /** The running version of ZotLit, which the update section names. */
  version: string;
  /** `release.update-pending`: the running version is an update not yet seen. */
  updatePending: boolean;
  /** `release.notices-enabled`: the researcher wants to hear of updates. */
  noticesEnabled: boolean;
}

/** What the banner shows, section by section; each is absent while it does not apply. */
export interface BannerSections {
  /**
   * The setup steps: the checklist, `"folded"` into one "Setup done" line
   * while every step is done and the banner shows a notice, or absent.
   */
  readonly steps: "open" | "folded" | false;
  /**
   * The Connect step, among the steps: left out while the Library View
   * shows its not-found card, which says the same.
   */
  readonly connect: boolean;
  /** The template conversion: its offer while it is pending, else its result. */
  readonly conversion: "offer" | "result" | null;
  /** The Migration Prompt: the guide to the v1 templates still in the vault. */
  readonly migration: boolean;
  /** The Zotero 10 guidance for ZotLit Companion, for a v1 upgrade. */
  readonly companion: boolean;
  /** "ZotLit updated to <version>", until "What's new" or a dismissal. */
  readonly update: boolean;
}

/**
 * The one decision of what the banner shows. The Migration Prompt of a v1
 * upgrade shows until a dismissal acknowledges it. Otherwise nothing shows
 * once the researcher dismissed the banner, but an update that came after.
 *
 * The setup steps open while setup is incomplete (once the connection is
 * known, so a complete setup never flashes), and whenever the researcher
 * asked for the banner. When every step is done and the banner shows a
 * notice besides the update (the template conversion, the Migration Prompt
 * or the Companion guidance, which a v1 upgrade always shows), they fold into
 * one "Setup done" line; an update alone shows no steps. The Connect step
 * shows only while the Library View does not say Zotero is not found. The
 * template conversion offer shows while it is pending, and its result while
 * cleanup remains, after a conversion in this session, or while setup is
 * under way (a v1 upgrade, a request, an incomplete setup). An update shows until "What's new" or a dismissal
 * acknowledges it, beside whatever else shows, while release notices are on.
 *
 * @returns `null` where the banner shows nothing.
 * @see apps/obsidian/docs/adr/0077-the-library-view-is-the-first-screen.md
 */
export function bannerSections(state: WelcomeState): BannerSections | null {
  const update = state.updatePending && state.noticesEnabled;
  if (state.dismissed && !state.migrationPending) {
    return update
      ? {
          steps: false,
          connect: false,
          conversion: null,
          migration: false,
          companion: false,
          update,
        }
      : null;
  }
  const known = state.connection.status !== "checking";
  const done =
    state.connection.status === "connected" && state.literatureFolderExists;
  const open = state.requested || (known && !done);
  const underway = open || state.migrationPending;
  const result = state.templateConversionResult;
  const conversion = state.templateConversionPending
    ? "offer"
    : result &&
        (underway || state.converted || result.pendingCleanup.length > 0)
      ? "result"
      : null;
  const migration = underway && conversion === null && state.v1TemplatesPresent;
  const companion = state.migrationPending;
  const notice = conversion !== null || migration || companion;
  const steps = open ? "open" : notice && done ? "folded" : false;
  const sections: BannerSections = {
    steps,
    connect: steps !== false && !state.notFound,
    conversion,
    migration,
    companion,
    update,
  };
  return steps !== false || notice || update ? sections : null;
}

/**
 * The badge names the strongest notice the banner shows: an upgrade from
 * v1, else an update, also beside a template conversion, else a fresh
 * setup.
 */
export function bannerBadge(
  state: WelcomeState,
): "upgraded" | "updated" | "get-started" {
  if (state.migrationPending) return "upgraded";
  if (bannerSections(state)?.update) return "updated";
  return "get-started";
}

export type WelcomeStore = ReturnType<typeof createWelcomeStore>;

export function createWelcomeStore() {
  return createStore<WelcomeState>()(() => ({
    migrationPending: false,
    dismissed: false,
    requested: false,
    requests: 0,
    converted: false,
    connection: { status: "checking" },
    literatureFolder: "",
    literatureFolderExists: false,
    templateConversionPending: false,
    templateFolder: "",
    templateConversionResult: null,
    v1TemplatesPresent: false,
    notFound: false,
    version: "",
    updatePending: false,
    noticesEnabled: true,
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
