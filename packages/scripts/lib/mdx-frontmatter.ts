// Validation and transformations for documentation availability frontmatter.

import { regex } from "arkregex";
import { gt, prerelease, valid } from "semver";

const AVAILABILITY_FIELD = regex(
  '^(?<field>introduced|updated): "(?<value>[^"]+)"$',
);
const DESCRIPTION_LINE = /^description: ".*"$/;
const TITLE_LINE = /^title: ".*"$/;

interface AvailabilityField {
  lineIndex: number;
  value: string;
}

interface AvailabilityFrontmatter {
  lines: string[];
  closingLineIndex: number;
  introduced?: AvailabilityField;
  updated?: AvailabilityField;
}

export function stripAvailabilityLines(content: string): string {
  const lines = content.split("\n");
  const closingLineIndex = lines.indexOf("---", 1);
  if (lines[0] !== "---" || closingLineIndex < 0) return content;
  return lines
    .filter(
      (line, index) =>
        index >= closingLineIndex || !AVAILABILITY_FIELD.test(line),
    )
    .join("\n");
}

export function hasAvailabilityDeclaration(content: string): boolean {
  const lines = content.split("\n");
  const closingLineIndex = lines.indexOf("---", 1);
  if (lines[0] !== "---" || closingLineIndex < 0) return false;
  return lines
    .slice(1, closingLineIndex)
    .some((line) => availabilityFieldName(line) !== null);
}

export function isReviewedForTarget(
  content: string,
  targetVersion: string,
): boolean {
  try {
    const { introduced, updated } = inspectAvailability(content);
    if (introduced === undefined || updated === undefined) return false;
    return !gt(targetVersion, updated.value);
  } catch {
    return false;
  }
}

export function hasTargetNewPageAvailability(
  content: string,
  targetVersion: string,
): boolean {
  try {
    const { introduced, updated } = inspectAvailability(content);
    return (
      introduced?.value === targetVersion && updated?.value === targetVersion
    );
  } catch {
    return false;
  }
}

export function insertNewPageAvailability(
  content: string,
  version: string,
): string {
  const frontmatter = inspectAvailability(content);
  if (
    frontmatter.introduced !== undefined ||
    frontmatter.updated !== undefined
  ) {
    throw new Error("a new page already has availability fields");
  }
  const frontmatterLines = frontmatter.lines.slice(
    0,
    frontmatter.closingLineIndex,
  );
  const descriptionIndex = frontmatterLines.findIndex((line) =>
    DESCRIPTION_LINE.test(line),
  );
  const anchorIndex =
    descriptionIndex >= 0
      ? descriptionIndex
      : frontmatterLines.findIndex((line) => TITLE_LINE.test(line));
  if (anchorIndex < 0) {
    return content;
  }
  const lines = [...frontmatter.lines];
  lines.splice(
    anchorIndex + 1,
    0,
    `introduced: "${version}"`,
    `updated: "${version}"`,
  );
  const transformed = lines.join("\n");
  assertAvailability(transformed, version, version);
  return transformed;
}

export function setUpdatedRelease(content: string, version: string): string {
  const frontmatter = inspectAvailability(content);
  const introduced = frontmatter.introduced;
  if (introduced === undefined) {
    throw new Error("missing required introduced field");
  }
  if (gt(introduced.value, version)) {
    throw new Error("Updated Release is before the Introduced Release");
  }
  const lines = [...frontmatter.lines];
  if (frontmatter.updated === undefined) {
    lines.splice(introduced.lineIndex + 1, 0, `updated: "${version}"`);
  } else {
    lines[frontmatter.updated.lineIndex] = `updated: "${version}"`;
  }
  const transformed = lines.join("\n");
  assertAvailability(transformed, introduced.value, version);
  return transformed;
}

export function removeAvailability(content: string): string {
  const frontmatter = inspectAvailability(content);
  const removedIndexes = new Set(
    [frontmatter.introduced, frontmatter.updated]
      .filter((field) => field !== undefined)
      .map(({ lineIndex }) => lineIndex),
  );
  return frontmatter.lines
    .filter((_, index) => !removedIndexes.has(index))
    .join("\n");
}

function inspectAvailability(content: string): AvailabilityFrontmatter {
  const lines = content.split("\n");
  const closingLineIndex = lines.indexOf("---", 1);
  if (lines[0] !== "---" || closingLineIndex < 0) {
    throw new Error("missing or malformed frontmatter fence");
  }

  const fields: Partial<Record<"introduced" | "updated", AvailabilityField>> =
    {};
  for (let lineIndex = 1; lineIndex < closingLineIndex; lineIndex += 1) {
    const line = lines[lineIndex]!;
    const fieldName = availabilityFieldName(line);
    if (fieldName === null) continue;
    const match = AVAILABILITY_FIELD.exec(line);
    if (match === null) throw new Error(`malformed ${fieldName} field`);
    if (fields[fieldName] !== undefined) {
      throw new Error(`duplicate ${fieldName} field`);
    }
    const normalized = valid(match.groups.value);
    if (normalized === null || prerelease(normalized) !== null) {
      throw new Error(`malformed ${fieldName} version: ${match.groups.value}`);
    }
    fields[fieldName] = { lineIndex, value: normalized };
  }

  if (
    fields.introduced !== undefined &&
    fields.updated !== undefined &&
    gt(fields.introduced.value, fields.updated.value)
  ) {
    throw new Error("Updated Release is before the Introduced Release");
  }

  return { lines, closingLineIndex, ...fields };
}

function availabilityFieldName(line: string): "introduced" | "updated" | null {
  const trimmed = line.trimStart();
  if (
    trimmed === "introduced" ||
    trimmed.startsWith("introduced:") ||
    trimmed.startsWith("introduced ")
  ) {
    return "introduced";
  }
  if (
    trimmed === "updated" ||
    trimmed.startsWith("updated:") ||
    trimmed.startsWith("updated ")
  ) {
    return "updated";
  }
  return null;
}

function assertAvailability(
  content: string,
  introduced: string,
  updated: string,
): void {
  const actual = inspectAvailability(content);
  if (
    actual.introduced?.value !== introduced ||
    actual.updated?.value !== updated
  ) {
    throw new Error("planned transformation produced unexpected field values");
  }
}
