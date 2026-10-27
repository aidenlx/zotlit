// View atoms over the plugin settings, shared by every leaf.
import { Effect, Stream } from "effect";
import * as Atom from "effect/reactivity/Atom";

import { held } from "@/lib/view-atoms";

import { defaults } from "./schema";
import { PluginSettings } from "./service";

export const settingsAtom = held(
  Stream.unwrap(Effect.map(PluginSettings, (settings) => settings.changes)),
  defaults,
);

export const templateFolderAtom = Atom.map(
  settingsAtom,
  (settings) => settings["template.folder"],
);

/** Only the default bindings invalidate Workbench renders. */
export const defaultBindingsAtom = held(
  Stream.unwrap(
    Effect.map(PluginSettings, (service) =>
      Stream.map(
        service.changes,
        (settings) => settings["note.default-profile"].bindings,
      ),
    ),
  ),
  defaults["note.default-profile"].bindings,
);
