import { Effect } from "effect";
import type { App } from "obsidian";

import { stubService } from "@/lib/__fixtures__/service-stub";

import type { registerTemplateWorkbench } from "./register";

type RegistrationDeps = Parameters<typeof registerTemplateWorkbench>[1];

/** Registration dependencies with stubs for every member a test leaves unread. */
export function workbenchRegistrationDeps(
  options: Pick<RegistrationDeps, "runtime" | "app"> &
    Partial<Omit<RegistrationDeps, "runtime" | "app">>,
): RegistrationDeps {
  return stubService<RegistrationDeps>("TemplateWorkbenchDeps", {
    zoteroReads: stubService<RegistrationDeps["zoteroReads"]>(
      "ZoteroReads",
      {},
    ),
    noteIndex: stubService<RegistrationDeps["noteIndex"]>("NoteIndex", {}),
    settings: stubService<RegistrationDeps["settings"]>("PluginSettings", {}),
    bridge: { runSync: Effect.runSync },
    profile: stubService<RegistrationDeps["profile"]>("Profile", {}),
    templates: stubService<RegistrationDeps["templates"]>("Template", {}),
    zoteroPref: stubService<RegistrationDeps["zoteroPref"]>("ZoteroPref", {}),
    ...options,
  });
}

export function emptyApp(): App {
  return stubService<App>("App", {});
}
