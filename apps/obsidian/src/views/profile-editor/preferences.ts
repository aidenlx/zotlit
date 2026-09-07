import type { App } from "obsidian";

const PREFERENCE_KEY = "zotlit-profile-customization";
export type ProfileCustomization = "ask" | "web" | "native";

export function profileCustomization(app: App): ProfileCustomization {
  const value: unknown = app.loadLocalStorage(PREFERENCE_KEY);
  return value === "web" || value === "native" ? value : "ask";
}

export function saveProfileCustomization(
  app: App,
  value: ProfileCustomization,
): void {
  app.saveLocalStorage(PREFERENCE_KEY, value);
}
