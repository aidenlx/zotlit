import { regex } from "arkregex";
import type { CachedMetadata, Pos, SectionCache } from "obsidian";

const ITEM_KEY_SOURCE = String.raw`[23456789A-NP-Z]{8}`;
const ITEM_KEY_GROUP_ID_PATTERN = new RegExp(`^${ITEM_KEY_SOURCE}(?:g\\d+)?$`);
const ANNOT_KEY_PAGE_SOURCE = `${ITEM_KEY_SOURCE}a${ITEM_KEY_SOURCE}(?:g\\d+)?(?:p\\d+)?`;
const ANNOT_KEY_PAGE_PATTERN = regex(
  `^(?<itemKey>${ITEM_KEY_SOURCE})a${ITEM_KEY_SOURCE}(?:g(?<groupID>\\d+))?(?:p\\d+)?$`,
);
const MULTIPLE_ANNOT_KEY_PAGE_PATTERN = new RegExp(
  `^(?:${ANNOT_KEY_PAGE_SOURCE}n?)+$`,
);

export interface FileContributions {
  itemKey: string | null;
  citekey: string | null;
  blocks: Map<string, Pos[]>;
}

export interface ContribDiff {
  empty: boolean;
  itemKey: { remove: string | null; add: string | null };
  citekey: { remove: string | null; add: string | null };
  blocks: {
    remove: string[];
    add: string[];
  };
}

export const EMPTY_CONTRIBUTIONS: FileContributions = {
  itemKey: null,
  citekey: null,
  blocks: new Map(),
};

export function fileContributions(cache: CachedMetadata): FileContributions {
  const blocks = new Map<string, Pos[]>();
  for (const section of cache.sections ?? []) {
    addSectionBlocks(blocks, section);
  }

  return {
    itemKey: itemKeyFromFrontmatter(cache),
    citekey: citekeyFromFrontmatter(cache),
    blocks,
  };
}

export function itemKeyFromFrontmatter(
  cache: CachedMetadata | null | undefined,
): string | null {
  const value = cache?.frontmatter?.["zotero-key"];
  if (typeof value !== "string") return null;
  return ITEM_KEY_GROUP_ID_PATTERN.test(value) ? value : null;
}

export function diffContributions(
  prev: FileContributions,
  next: FileContributions,
): ContribDiff {
  const itemKeyChanged = prev.itemKey !== next.itemKey;
  const citekeyChanged = prev.citekey !== next.citekey;
  const blocks = diffBlocks(prev.blocks, next.blocks);

  return {
    empty:
      !itemKeyChanged &&
      !citekeyChanged &&
      blocks.remove.length === 0 &&
      blocks.add.length === 0,
    itemKey: {
      remove: itemKeyChanged ? prev.itemKey : null,
      add: itemKeyChanged ? next.itemKey : null,
    },
    citekey: {
      remove: citekeyChanged ? prev.citekey : null,
      add: citekeyChanged ? next.citekey : null,
    },
    blocks,
  };
}

function citekeyFromFrontmatter(cache: CachedMetadata): string | null {
  const value = cache.frontmatter?.citekey;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function addSectionBlocks(
  blocks: Map<string, Pos[]>,
  section: SectionCache,
): void {
  const id = section.id;
  if (!id || !MULTIPLE_ANNOT_KEY_PAGE_PATTERN.test(id)) return;

  for (const fragment of id.split("n")) {
    if (fragment === "") continue;
    const key = parseAnnotBlockKey(fragment);
    const positions = blocks.get(key);
    if (positions) {
      positions.push(section.position);
    } else {
      blocks.set(key, [section.position]);
    }
  }
}

function parseAnnotBlockKey(fragment: string): string {
  const { itemKey, groupID } = ANNOT_KEY_PAGE_PATTERN.exec(fragment)!.groups;
  return groupID ? `${itemKey}g${groupID}` : itemKey;
}

function diffBlocks(
  prev: Map<string, Pos[]>,
  next: Map<string, Pos[]>,
): ContribDiff["blocks"] {
  const remove: string[] = [];
  const add: string[] = [];
  const keys = new Set([...prev.keys(), ...next.keys()]);

  for (const key of keys) {
    const prevPositions = prev.get(key) ?? [];
    const nextPositions = next.get(key) ?? [];
    if (positionsEqual(prevPositions, nextPositions)) continue;

    if (prev.has(key)) remove.push(key);
    if (next.has(key)) add.push(key);
  }

  return { remove, add };
}

function positionsEqual(left: Pos[], right: Pos[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((pos, index) => posEqual(pos, right[index]!));
}

function posEqual(left: Pos, right: Pos): boolean {
  return locEqual(left.start, right.start) && locEqual(left.end, right.end);
}

function locEqual(left: Pos["start"], right: Pos["start"]): boolean {
  return (
    left.line === right.line &&
    left.col === right.col &&
    left.offset === right.offset
  );
}
