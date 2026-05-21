import { type SettingsService } from "@/services/settings/service";

/**
 * Shared shape every section receives. Groups that need extra services
 * declare a local interface extending this in their own file.
 */
export interface SectionContext {
  containerEl: HTMLElement;
  settings: SettingsService;
}
