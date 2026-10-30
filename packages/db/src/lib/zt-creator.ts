import { logLibrary } from "@zotlit/shared/logging";

const CREATOR_FIELD_MODE = {
  0: "fullName",
  1: "nameOnly",
} as const;

export type CreatorFieldMode = keyof typeof CREATOR_FIELD_MODE;
export type CreatorFieldModeName =
  (typeof CREATOR_FIELD_MODE)[CreatorFieldMode];

export function creatorFieldModeToName(
  fieldMode: CreatorFieldMode,
): CreatorFieldModeName | "unknown" {
  const name = CREATOR_FIELD_MODE[fieldMode];
  if (name) return name;

  logLibrary({
    level: "warn",
    category: ["zotlit", "db", "items"],
    message: "Unknown creator field mode {fieldMode}",
    properties: { fieldMode },
  });
  return "unknown";
}
