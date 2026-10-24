// The Literature Notes the Query View reads: the note of an Item the Table's
// "Literature note" column links, or "Create" where it has none, and the
// vault properties, `vault.<name>`, each the value of one frontmatter key of
// that note. "Create" is the usual Literature Note creation, which asks for a
// Profile when more than one fits. A view that a Literature Note holds reads
// that note for its own Item, whichever note the Note Index ranks first.
//
// @see apps/obsidian/docs/adr/0070-vault-properties-are-answered-outside-zotlit-query.md
import { Keymap, parseLinktext } from "obsidian";
import type { App, TFile } from "obsidian";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { Effect } from "@/lib/effect";
import type { SubscriptionRuntime } from "@/lib/effect-stream";
import { subscribe } from "@/lib/effect-stream";
import { processLiveFrontMatter } from "@/lib/live-text";
import type { LiveTextApp } from "@/lib/live-text";
import {
  assignedWidget,
  onTypesChanged,
} from "@/lib/obsidian-private/metadata-type-manager";
import {
  propertyValues,
  vaultTags,
} from "@/lib/obsidian-private/property-values";
import { createNoteInteractively } from "@/services/note-feature/creation-view";
import type { InteractiveCreationDeps } from "@/services/note-feature/creation-view";
import type { NoteFeature } from "@/services/note-feature/operations";
import type { PlainNoteIndex } from "@/services/note-index/plain";
import type { PlainProfile } from "@/services/profile/plain";
import type { PlainTemplate } from "@/services/template/plain";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";

import { LITERATURE_NOTE } from "./query-file";

/** A Literature Note as the column links it. */
export type LiteratureNoteLink = Pick<TFile, "path" | "basename">;

/**
 * The type of a vault property, by the id of the Obsidian property widget
 * that shows it: the one Obsidian assigns the property, else one inferred
 * from a value it holds, else text.
 */
export type VaultPropertyType =
  | "text"
  | "multitext"
  | "number"
  | "checkbox"
  | "date"
  | "datetime"
  | "tags"
  | "aliases";

/** The types whose value is a list of strings, shown as pills. */
export const LIST_TYPES: ReadonlySet<VaultPropertyType> = new Set([
  "multitext",
  "tags",
  "aliases",
]);

/** The assigned widgets a vault property takes as its type; others infer. */
const ASSIGNABLE: ReadonlySet<string> = new Set<VaultPropertyType>([
  "text",
  "multitext",
  "number",
  "checkbox",
  "date",
  "datetime",
  "tags",
  "aliases",
]);

/**
 * The note that holds a Query View, and the Item its `zotero-key` names: a
 * row of that Item reads the vault properties of this note.
 */
export interface VaultHost {
  readonly path: string;
  readonly itemKey: string;
}

/**
 * A vault property of one Item: no Literature Note to read it from, or the
 * value of the note's key, `null` where the note lacks the key or holds null.
 */
export type VaultValue =
  | { readonly note: false }
  | { readonly note: true; readonly value: unknown };

/**
 * What a write of a vault property did: `written` to the note, `created`
 * where the Item had no Literature Note, so the usual creation made one and
 * the key was written to it, `cancelled` where no note came of that
 * creation, the Profile prompt cancelled, and nothing was written, or
 * `managed` where the note's Profile replaces the key on each update, so
 * nothing was written, though the note may have just been created.
 */
export type VaultWrite = "written" | "created" | "cancelled" | "managed";

/** An edit of the vault property `name` of the Item `itemKey` to `value`. */
export interface VaultEdit {
  readonly itemKey: string;
  readonly name: string;
  readonly value: unknown;
  /** The note that holds the view, where a note holds it. */
  readonly host: VaultHost | null;
}

/**
 * The link text `target`, held in a vault property of the Item `itemKey`,
 * which resolves from the note {@link LiteratureNotes.read} reads.
 */
export interface VaultLinkRef {
  readonly target: string;
  readonly itemKey: string;
  readonly host: VaultHost | null;
}

/** What the "Literature note" column and the vault properties read and do. */
export interface LiteratureNotes {
  /** The Literature Note of an Item, by its Indexed Key; `null` where it has none. */
  find(itemKey: string): LiteratureNoteLink | null;
  /**
   * `changed`: a Literature Note was added, changed or removed.
   * `frontmatter-changed`: the frontmatter of a Literature Note, the type
   * Obsidian assigns a property, or the keys a note's Profile replaces
   * changed.
   */
  on(
    event: "changed" | "frontmatter-changed",
    listener: () => void,
  ): () => void;
  /**
   * The names the vault properties take: the frontmatter keys of the
   * Literature Notes, less the reserved and system keys.
   */
  propertyNames(): readonly string[];
  /** The Indexed Keys of the Items that have a Literature Note. */
  itemKeys(): readonly string[];
  /**
   * The type of the vault property `name`: the one Obsidian assigns it, else
   * the one `value`, a cell's value, infers, else the one the property's
   * first value infers, else text.
   */
  propertyType(name: string, value?: unknown): VaultPropertyType;
  /**
   * The vault property `name` of an Item, by its Indexed Key: of `host`
   * where the Item is the one it names, else of the Item's first Literature
   * Note.
   */
  read(itemKey: string, name: string, host: VaultHost | null): VaultValue;
  /**
   * Whether the Profile of the note {@link read} reads manages `name` with
   * the replace strategy, so that the next update of the note overwrites it.
   * Until the note's Profile has been read it answers `false`, and tells
   * `frontmatter-changed` once it has.
   */
  managed(itemKey: string, name: string, host: VaultHost | null): boolean;
  /**
   * Set the vault property `name` of an Item to `value` on the note
   * {@link read} reads, through the note's editor where one has it open.
   * Only that key changes; `null` keeps the key with no value. Where the
   * Item has no note, the usual creation makes one first, asking for a
   * Profile when more than one fits. A key the note's Profile replaces, as
   * {@link managed} tells, is not written.
   */
  write(edit: VaultEdit): Promise<VaultWrite>;
  /**
   * The values the vault holds for the property `name`, each once, which an
   * edit of it suggests: the vault's tags for a property of tags.
   */
  suggestions(name: string, type: VaultPropertyType): readonly string[];
  /** Whether a link in a vault property reaches a note. */
  resolves(link: VaultLinkRef): boolean;
  /** Open a link in a vault property; a Cmd/Ctrl press opens a new tab. */
  openLink(link: VaultLinkRef, event: MouseEvent): void;
  /** Open the note; a Cmd/Ctrl press opens it in a new tab. */
  open(note: LiteratureNoteLink, event: MouseEvent): void;
  /** Create the Item's Literature Note, as the usual creation does. */
  create(itemKey: string): Promise<void>;
}

export interface LiteratureNotesDeps extends InteractiveCreationDeps {
  runtime: SubscriptionRuntime;
  app: App & LiveTextApp;
  noteIndex: Pick<
    PlainNoteIndex,
    | "getNotesByItemKey"
    | "getIndexedItemKeys"
    | "getPropertyNames"
    | "changed"
    | "indexed"
    | "frontmatter-changed"
  >;
  noteFeature: InteractiveCreationDeps["noteFeature"] &
    Pick<NoteFeature, "replacedKeys">;
  profile: Pick<PlainProfile, "changed">;
  template: Pick<PlainTemplate, "compile-status-changed">;
  zoteroReads: Pick<PlainZoteroReads, "reads">;
}

/** The keys a note's Profile replaces, or the read of them under way. */
type Replaced = ReadonlySet<string> | Promise<ReadonlySet<string>>;

/**
 * What the vault properties read across many notes, kept until a note is
 * added, changed or removed, or a Profile or a template changes.
 */
interface VaultMemo {
  names?: readonly string[];
  /** The type each name's first value infers. */
  inferred?: ReadonlyMap<string, VaultPropertyType>;
  /** The keys each note's Profile replaces, by path. */
  replaced: Map<string, Replaced>;
}

const freshMemo = (): VaultMemo => ({ replaced: new Map() });

interface VaultEvents {
  changed: () => void;
  "frontmatter-changed": () => void;
}

/** The column's Literature Notes, from the Note Index and the usual creation. */
export function literatureNotes(deps: LiteratureNotesDeps): LiteratureNotes {
  // Every source of a change clears what it makes stale, then tells the
  // listeners, so a listener reads after the clear. The type Obsidian
  // assigns is read live, so only what the notes give is kept. The Note
  // Index, the Profiles and the templates live as long as these notes, so
  // their subscriptions need no end.
  let memo = freshMemo();
  const events = createNanoEvents<VaultEvents>();
  subscribe(deps.runtime, deps.noteIndex["changed"], () => {
    memo = freshMemo();
    events.emit("changed");
  });
  // The Full Scan reports no `changed` for each note it finds.
  subscribe(deps.runtime, deps.noteIndex["indexed"], () => {
    memo = freshMemo();
    events.emit("changed");
  });
  subscribe(deps.runtime, deps.noteIndex["frontmatter-changed"], (file) => {
    // A note's own frontmatter, its Profile stamp among it, decides what its
    // Profile replaces; the other notes keep theirs.
    memo = {
      replaced: new Map(
        [...memo.replaced].filter(([path]) => path !== file?.path),
      ),
    };
    if (file === undefined) memo.replaced.clear();
    events.emit("frontmatter-changed");
  });
  const profilesChanged = () => {
    memo = { ...memo, replaced: new Map() };
    events.emit("frontmatter-changed");
  };
  subscribe(deps.runtime, deps.profile["changed"], profilesChanged);
  subscribe(
    deps.runtime,
    deps.template["compile-status-changed"],
    profilesChanged,
  );
  // A read of what a note's Profile replaces settles after the cell asked;
  // the cells read again once for all that settle together.
  let telling = false;
  const tellReplaced = () => {
    if (telling) return;
    telling = true;
    queueMicrotask(() => {
      telling = false;
      events.emit("frontmatter-changed");
    });
  };
  /** The keys the Profile of `file` replaces, read once until it changes. */
  const replacedOf = (file: TFile): Replaced => {
    const known = memo.replaced.get(file.path);
    if (known !== undefined) return known;
    const at = memo;
    const reading = deps.noteFeature.replacedKeys(file).then((keys) => {
      if (at.replaced.get(file.path) === reading) {
        at.replaced.set(file.path, keys);
        if (memo === at) tellReplaced();
      }
      return keys;
    });
    at.replaced.set(file.path, reading);
    return reading;
  };
  // An assigned type is read live: listened to while any listener listens.
  let typeListeners = 0;
  let offTypes = () => {};
  const listenTypes = () => {
    if (typeListeners++ === 0)
      offTypes = onTypesChanged(deps.app, () =>
        events.emit("frontmatter-changed"),
      );
    return () => {
      if (--typeListeners === 0) offTypes();
    };
  };
  const inferredTypes = (): ReadonlyMap<string, VaultPropertyType> => {
    if (memo.inferred) return memo.inferred;
    const inferred = new Map<string, VaultPropertyType>();
    for (const itemKey of deps.noteIndex.getIndexedItemKeys()) {
      const note = deps.noteIndex.getNotesByItemKey(itemKey)[0];
      if (!note) continue;
      for (const [name, value] of Object.entries(frontmatterOf(note.path)))
        if (!inferred.has(name) && value !== undefined && value !== null)
          inferred.set(name, inferType(value));
    }
    memo.inferred = inferred;
    return inferred;
  };
  const frontmatterOf = (path: string): Readonly<Record<string, unknown>> =>
    deps.app.metadataCache.getCache(path)?.frontmatter ?? {};
  /** The path of the note an Item's vault properties are of. */
  const pathOf = (itemKey: string, host: VaultHost | null) =>
    host?.itemKey === itemKey
      ? host.path
      : deps.noteIndex.getNotesByItemKey(itemKey)[0]?.path;
  const fileOf = (itemKey: string, host: VaultHost | null) => {
    const path = pathOf(itemKey, host);
    return path === undefined ? null : deps.app.vault.getFileByPath(path);
  };
  return {
    find: (itemKey) => deps.noteIndex.getNotesByItemKey(itemKey)[0] ?? null,
    on: (event, listener) => {
      const off = events.on(event, listener);
      if (event !== "frontmatter-changed") return off;
      // A change of an assigned type shows as a change of the frontmatter.
      const offTypes = listenTypes();
      return () => {
        off();
        offTypes();
      };
    },
    propertyNames: () =>
      (memo.names ??= deps.noteIndex
        .getPropertyNames()
        .filter((name) => `vault.${name}` !== LITERATURE_NOTE)),
    itemKeys: () => deps.noteIndex.getIndexedItemKeys(),
    propertyType: (name, value) => {
      const assigned = assignedWidget(deps.app, name);
      if (assigned !== null && ASSIGNABLE.has(assigned))
        return assigned as VaultPropertyType;
      if (value !== undefined && value !== null) return inferType(value);
      return inferredTypes().get(name) ?? "text";
    },
    read: (itemKey, name, host) => {
      const path = pathOf(itemKey, host);
      if (path === undefined) return { note: false };
      return { note: true, value: frontmatterOf(path)[name] ?? null };
    },
    managed: (itemKey, name, host) => {
      const file = fileOf(itemKey, host);
      if (file === null) return false;
      const keys = replacedOf(file);
      return !(keys instanceof Promise) && keys.has(name);
    },
    write: async ({ itemKey, name, value, host }) => {
      const found = fileOf(itemKey, host);
      const file = found ?? (await createNote(itemKey));
      if (file === null) return "cancelled";
      // The Profile of a note just created is read as the note's own.
      if ((await replacedOf(file)).has(name)) return "managed";
      await processLiveFrontMatter(deps.app, file, (frontmatter) => {
        frontmatter[name] = value;
      });
      return found === null ? "created" : "written";
    },
    suggestions: (name, type) =>
      type === "tags" ? vaultTags(deps.app) : propertyValues(deps.app, name),
    resolves: ({ target, itemKey, host }) =>
      deps.app.metadataCache.getFirstLinkpathDest(
        parseLinktext(target).path,
        pathOf(itemKey, host) ?? "",
      ) !== null,
    openLink: ({ target, itemKey, host }, event) =>
      void deps.app.workspace.openLinkText(
        target,
        pathOf(itemKey, host) ?? "",
        Keymap.isModEvent(event),
      ),
    open: (note, event) =>
      void deps.app.workspace.openLinkText(
        note.path,
        "",
        Keymap.isModEvent(event),
      ),
    create: async (itemKey) => {
      await createNote(itemKey);
    },
  };
  /** The usual creation of an Item's note; `null` where none came of it. */
  async function createNote(itemKey: string): Promise<TFile | null> {
    const { reads } = deps.zoteroReads;
    const item = (
      await Effect.runPromise(
        reads.ItemsByIndexedKeys({ indexedKeys: [itemKey] }),
      )
    ).get(itemKey);
    return item ? createNoteInteractively(deps, item) : null;
  }
}

/**
 * The type a value shows as, as Obsidian infers one for a property it has no
 * type for: a list, a number, a checkbox, a date, a date and time to the
 * minute, else text.
 */
export function inferType(value: unknown): VaultPropertyType {
  if (Array.isArray(value)) return "multitext";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "string" && /^\d{4}-[01]\d-[0-3]\d$/.test(value))
    return "date";
  if (
    typeof value === "string" &&
    /^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d$/.test(value)
  )
    return "datetime";
  return "text";
}
