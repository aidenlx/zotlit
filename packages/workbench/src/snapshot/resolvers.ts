// Redacting Zotero resolvers and validation for permitted vault targets.

import type { Attachment, Item, NoteResolvers, TemplateLink } from "@zotlit/db";

import { markInertPlaceholder } from "@/explorer/index";

import type { SnapshotProvenance, SnapshotVaultTargets } from "./types";
import { SnapshotSelectionError } from "./types";
import { formatWikiLink } from "./wiki-link";

export function normalizeTargets(
  targets: SnapshotVaultTargets | undefined,
): SnapshotVaultTargets {
  if (!targets) return {};
  for (const entries of [
    targets.notes,
    targets.attachments,
    targets.annotationImages,
  ]) {
    for (const path of Object.values(entries ?? {})) assertVaultPath(path);
  }
  return targets;
}

export function validateProvenance(
  provenance: SnapshotProvenance,
): SnapshotProvenance {
  const label =
    provenance.kind === "sample" ? provenance.source : provenance.vault;
  if (label !== undefined) assertNotAbsolutePath(label, "Snapshot provenance");
  return provenance;
}

export function snapshotResolvers(
  targets: SnapshotVaultTargets,
): NoteResolvers {
  const targetLink = (
    target: string | undefined,
    defaultAlias: string,
    defaultSubpath?: string,
  ): TemplateLink | null => {
    if (!target) return null;
    return (alias, subpath) =>
      formatWikiLink(target, {
        alias: alias ?? defaultAlias,
        subpath: subpath ?? defaultSubpath,
      });
  };
  const unavailableLink = (reason: string) =>
    markInertPlaceholder(() => "", reason);

  return {
    item: {
      authorsShort,
      notePath: (item) => targets.notes?.[item.indexedKey] ?? null,
      noteLink: (item, alias, subpath) =>
        targetLink(
          targets.notes?.[item.indexedKey],
          item.title ?? item.citationKey ?? item.key,
        )?.(alias, subpath) ?? null,
    },
    annotation: {
      authorsShort,
      filePath: () => null,
      fileLink: (attachment, page) =>
        targetLink(
          targets.attachments?.[attachment.indexedKey],
          attachmentAlias(attachment),
          page == null ? undefined : `page=${page}`,
        ) ?? (() => null),
      annotationImageLink: (annotation) => {
        if (annotation.type !== 3 && annotation.type !== 4) return null;
        return (
          targetLink(
            targets.annotationImages?.[annotation.indexedKey],
            `${annotation.key}.png`,
          ) ??
          unavailableLink(
            "The Annotation image has no permitted vault-relative target.",
          )
        );
      },
      commentToMarkdown,
    },
    resolveChildNote: (note) => ({
      key: note.key,
      indexedKey: note.indexedKey,
      title: note.title,
      noteLink:
        targetLink(targets.notes?.[note.indexedKey], note.title ?? note.key) ??
        unavailableLink(
          "The Child Note has no permitted vault-relative target.",
        ),
    }),
  };
}

export function authorsShort(item: Item): string {
  const primary = item.creators.filter(
    ({ creatorType }) => creatorType === item.primaryCreatorType,
  );
  const creators = primary.length > 0 ? primary : item.creators;
  const first = creators[0]?.lastName ?? "";
  if (creators.length < 2) return first;
  if (creators.length === 2) {
    return [first, creators[1]?.lastName].filter(Boolean).join(" & ");
  }
  return first ? `${first} et al.` : "";
}

function assertVaultPath(path: string): void {
  const normalized = path.replaceAll("\\", "/");
  assertNotAbsolutePath(normalized, "Vault target");
  if (normalized === "" || normalized.split("/").includes("..")) {
    throw new SnapshotSelectionError(
      `Vault target '${path}' must be vault-relative.`,
    );
  }
}

function assertNotAbsolutePath(value: string, label: string): void {
  const normalized = value.replaceAll("\\", "/");
  const hasDrive = normalized.length > 2 && normalized[1] === ":";
  if (normalized.startsWith("/") || hasDrive) {
    throw new SnapshotSelectionError(
      `${label} must not contain an absolute path.`,
    );
  }
}

function attachmentAlias(attachment: Attachment): string {
  const path = attachment.path?.replaceAll("\\", "/");
  return path?.slice(path.lastIndexOf("/") + 1) || attachment.key;
}

function commentToMarkdown(html: string): string {
  return html
    .replaceAll("<i>", "*")
    .replaceAll("</i>", "*")
    .replaceAll("<b>", "**")
    .replaceAll("</b>", "**")
    .replaceAll("\n", "  \n")
    .trim();
}
