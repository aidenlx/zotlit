import type { App } from "obsidian";

type DeviceStorage = Pick<App, "loadLocalStorage" | "saveLocalStorage">;

const PREFERENCE_KEY = "zotlit-profile-customization";
export type ProfileCustomization = "ask" | "web" | "native";

export function profileCustomization(app: DeviceStorage): ProfileCustomization {
  const value: unknown = app.loadLocalStorage(PREFERENCE_KEY);
  if (value === null || value === undefined)
    return app.loadLocalStorage("zotlit-workbench-launch-approved") === "1"
      ? "web"
      : "ask";
  return value === "web" || value === "native" ? value : "ask";
}

export function saveProfileCustomization(
  app: DeviceStorage,
  value: ProfileCustomization,
): void {
  app.saveLocalStorage(PREFERENCE_KEY, value);
}
