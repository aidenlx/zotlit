// Per-leaf Welcome session state and the service facts its banner renders.
import { useAtomValue } from "@effect/atom-react";
import { Effect, Option, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { normalizePath } from "obsidian";
import { createContext, useContext } from "react";

import { filterTag } from "@/lib/effect-stream";
import { Vault } from "@/lib/obsidian-vault";
import { held, viewRuntime } from "@/lib/view-atoms";
import type { ViewRegistryHandle } from "@/lib/view-atoms";
import { releaseVersionAtom } from "@/services/release/atoms";
import { Release } from "@/services/release/service";
import { settingsAtom } from "@/services/settings/atoms";
import { zoteroStateAtom } from "@/services/zotero-reads/atoms";

import { makeConversionCommand } from "./atoms";
import type { ConversionRun } from "./atoms";
import { connectionAtom, connectionLoadAtom, unavailable } from "./connection";
import { bannerSections } from "./presentation";
import type { WelcomeState } from "./presentation";

export interface WelcomeSession {
  readonly requests: number;
  readonly converted: boolean;
}

const vaultRevisionAtom = held(
  Stream.unwrap(
    Effect.gen(function* () {
      return Stream.scan(
        filterTag((yield* Vault).changes, "create", "delete", "rename"),
        () => 0,
        (revision) => revision + 1,
      );
    }),
  ),
  0,
);

// Only these settings change the vault evidence the banner reads.
const literatureFolderAtom = Atom.map(
  settingsAtom,
  (s) => s["note.default-profile"].bindings["note.literature-folder"],
);
const templateFolderAtom = Atom.map(settingsAtom, (s) => s["template.folder"]);
const evidenceAtom = viewRuntime.atom((get) => {
  get(vaultRevisionAtom);
  const folder = get(literatureFolderAtom);
  const templates = get(templateFolderAtom);
  return Effect.gen(function* () {
    return {
      literatureFolderExists:
        (yield* (yield* Vault).getFolderByPath(normalizePath(folder))) !== null,
      v1TemplatesPresent: yield* (yield* Release).hasV1Templates(templates),
    };
  });
});
export function makeWelcomeModel() {
  const session = Atom.make<WelcomeSession>({ requests: 0, converted: false });
  const state = Atom.make((get): WelcomeState => {
    const s = get(settingsAtom);
    return {
      ...get(session),
      migrationPending: s["release.migration-pending"],
      dismissed: s["welcome.dismissed"],
      requested: s["welcome.requested"],
      stepsShown: s["welcome.steps-shown"],
      literatureFolder: get(literatureFolderAtom),
      ...Option.getOrElse(AsyncResult.value(get(evidenceAtom)), () => ({
        literatureFolderExists: false,
        v1TemplatesPresent: false,
      })),
      templateConversionPending: s["note.template-conversion-pending"],
      templateFolder: get(templateFolderAtom),
      templateConversionResult: s["note.template-conversion-result"],
      updatePending: s["release.update-pending"],
      noticesEnabled: s["release.notices-enabled"],
      connection: get(connectionAtom),
      notFound: unavailable({ reads: get(zoteroStateAtom) }),
      version: Option.getOrElse(
        AsyncResult.value(get(releaseVersionAtom)),
        () => "",
      ),
    };
  });
  const shown = Atom.map(state, (s) => bannerSections(s) !== null);
  return {
    session,
    state,
    shown,
    loaded: connectionLoadAtom,
    conversion: makeConversionCommand(),
  };
}

export type WelcomeModel = ReturnType<typeof makeWelcomeModel>;

export function holdWelcomeModel(
  registry: ViewRegistryHandle,
  model: WelcomeModel,
): () => void {
  const releases = [registry.mount(model.session), registry.mount(model.state)];
  return () => {
    for (const release of releases) release();
  };
}

export const requestWelcome = (state: WelcomeSession): WelcomeSession => ({
  ...state,
  requests: state.requests + 1,
});
export const setConverted =
  (converted: boolean) =>
  (state: WelcomeSession): WelcomeSession =>
    state.converted === converted ? state : { ...state, converted };

/** What the banner's tree reads: its state and its conversion's last run. */
export interface WelcomeModelView {
  readonly state: Atom.Atom<WelcomeState>;
  readonly conversion: Atom.Atom<
    AsyncResult.AsyncResult<ConversionRun, unknown>
  >;
}

const WelcomeModelContext = createContext<WelcomeModelView | null>(null);
export const WelcomeModelProvider = WelcomeModelContext.Provider;

function useWelcomeModel(): WelcomeModelView {
  const model = useContext(WelcomeModelContext);
  if (!model)
    throw new Error("useWelcomeState must be used within WelcomeModelProvider");
  return model;
}

export function useWelcomeState<A>(select: (state: WelcomeState) => A): A {
  return useAtomValue(useWelcomeModel().state, select);
}

/** The last run of the banner's template conversion, while it runs and after. */
export function useConversion(): AsyncResult.AsyncResult<
  ConversionRun,
  unknown
> {
  return useAtomValue(useWelcomeModel().conversion);
}
