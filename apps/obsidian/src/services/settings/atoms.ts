// The template folder every Template Document view classifies within.
import { Effect, Stream } from "effect";

import { held } from "@/lib/view-atoms";

import { defaults } from "./schema";
import { PluginSettings } from "./service";

export const templateFolderAtom = held(
  Stream.unwrap(
    Effect.map(PluginSettings, (service) =>
      Stream.map(service.changes, (settings) => settings["template.folder"]),
    ),
  ),
  "templates",
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
