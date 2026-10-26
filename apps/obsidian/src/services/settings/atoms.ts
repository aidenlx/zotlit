// The template folder every Template Document view classifies within.
import { Effect, Stream } from "effect";

import { held } from "@/lib/view-atoms";

import { PluginSettings } from "./service";
export const templateFolderAtom = held(
  Stream.unwrap(
    Effect.map(PluginSettings, (service) =>
      Stream.map(service.changes, (settings) => settings["template.folder"]),
    ),
  ),
  "templates",
);
