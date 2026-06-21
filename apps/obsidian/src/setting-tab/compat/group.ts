import { SettingGroup } from "obsidian";

/**
 * A section group with a heading and an optional description line. `SettingGroup`
 * (@since Obsidian 1.11.0) is the pre-1.13 imperative analogue of the declarative
 * `type: "group"` definition — `addSetting`/`addExtraButton` build into its
 * `listEl`, and nesting is `new SettingGroup(parent.listEl)`.
 */
export function sectionGroup(
  containerEl: HTMLElement,
  name: string,
  desc?: string,
): SettingGroup {
  const group = new SettingGroup(containerEl);
  if (desc === undefined) return group.setHeading(name);

  const heading = document.createDocumentFragment();
  heading.append(name);
  const descEl = document.createElement("div");
  descEl.className = "setting-item-description";
  descEl.textContent = desc;
  heading.append(descEl);
  return group.setHeading(heading);
}
