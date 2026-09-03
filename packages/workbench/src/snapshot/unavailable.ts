// Reports redacted Template-data fields as explicit unavailable values.

import type { SnapshotUnavailableValue } from "./types";

export function collectUnavailable(
  root: Record<string, unknown>,
): SnapshotUnavailableValue[] {
  const unavailable: SnapshotUnavailableValue[] = [];
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    if (typeof record.$inert === "string") {
      unavailable.push({ path, reason: record.$inert });
      return;
    }
    if (record.$helper === "fileLink" && record.value === null) {
      unavailable.push({
        path,
        reason: "The Attachment has no permitted vault-relative target.",
      });
      return;
    }
    for (const [key, entry] of Object.entries(record)) {
      const childPath = `${path}.${key}`;
      if (key === "filePath" && entry === null) {
        unavailable.push({
          path: childPath,
          reason: "Attachment paths are not included in Item Snapshots.",
        });
      } else {
        visit(entry, childPath);
      }
    }
  };
  visit(root, "zt");
  return unavailable;
}
