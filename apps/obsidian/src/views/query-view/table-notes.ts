// The Literature Notes the Query View reads: the note of an Item the Table's
// "Literature note" column links, or "Create" where it has none, and the
// vault properties, `vault.<name>`, each the value of one frontmatter key of
// that note. "Create" is the usual Literature Note creation, which asks for a
// Profile when more than one fits. A view that a Literature Note holds reads
// that note for its own Item, whichever note the Note Index ranks first.
//
// @see apps/obsidian/docs/adr/0070-vault-properties-are-answered-outside-zotlit-query.md
import { Keymap } from "obsidian";
import type { App, TFile } from "obsidian";

import { Effect } from "@/lib/effect";
import { processLiveFrontMatter } from "@/lib/live-text";
import type { LiveTextApp } from "@/lib/live-text";
import {
  assignedWidget,
  onTypesChanged,
} from "@/lib/obsidian-private/metadata-type-manager";
import { createNoteInteractively } from "@/services/note-feature/creation-view";
import type { InteractiveCreationDeps } from "@/services/note-feature/creation-view";
import type { NoteIndex } from "@/services/note-index/service";
import type { ProfileService } from "@/services/profile/service";
import type { TemplateService } from "@/services/template/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

import { LITERATURE_NOTE } from "./view-properties";

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
  | "datetime";

/** The assigned widgets a vault property takes as its type; others infer. */
const ASSIGNABLE: ReadonlySet<string> = new Set<VaultPropertyType>([
  "text",
  "multitext",
  "number",
  "checkbox",
  "date",
  "datetime",
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
 * What a write of a vault property did: `written` to the note, or nothing
 * where the Item has no Literature Note to write to.
 */
export type VaultWrite = "written" | "no-note";

/** An edit of the vault property `name` of the Item `itemKey` to `value`. */
export interface VaultEdit {
  readonly itemKey: string;
  readonly name: string;
  readonly value: unknown;
  /** The note that holds the view, where a note holds it. */
  readonly host: VaultHost | null;
}

/** What the "Literature note" column and the vault properties read and do. */
export interface LiteratureNotes {
  /** The Literature Note of an Item, by its Indexed Key; `null` where it has none. */
  find(itemKey: string): LiteratureNoteLink | null;
  /**
   * `changed`: a Literature Note was added, changed or removed.
   * `frontmatter-changed`: the frontmatter of a Literature Note, or the
   * type Obsidian assigns a property, changed.
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
  /** The type of the vault property `name`. */
  propertyType(name: string): VaultPropertyType;
  /**
   * The vault property `name` of an Item, by its Indexed Key: of `host`
   * where the Item is the one it names, else of the Item's first Literature
   * Note.
   */
  read(itemKey: string, name: string, host: VaultHost | null): VaultValue;
  /**
   * Whether the Profile of the note {@link read} reads manages `name` with
   * the replace strategy, so that the next update of the note overwrites it.
   */
  managed(itemKey: string, name: string, host: VaultHost | null): boolean;
  /**
   * Set the vault property `name` of an Item to `value` on the note
   * {@link read} reads, through the note's editor where one has it open.
   * Only that key changes; `null` keeps the key with no value.
   */
  write(edit: VaultEdit): Promise<VaultWrite>;
  /** Open the note; a Cmd/Ctrl press opens it in a new tab. */
  open(note: LiteratureNoteLink, event: MouseEvent): void;
  /** Create the Item's Literature Note, as the usual creation does. */
  create(itemKey: string): Promise<void>;
}

export interface LiteratureNotesDeps extends InteractiveCreationDeps {
  app: App & LiveTextApp;
  noteIndex: Pick<
    NoteIndex,
    "getNotesByItemKey" | "getIndexedItemKeys" | "getPropertyNames" | "on"
  >;
  profile: Pick<ProfileService, "profileOf">;
  template: Pick<
    TemplateService,
    "getLiteratureNoteTemplate" | "frontmatterFields"
  >;
  zoteroReads: Pick<ZoteroReadsService, "ready">;
}

/**
 * What the vault properties read across many notes, kept while a listener
 * watches for the changes that make it stale.
 */
interface VaultMemo {
  names?: readonly string[];
  /** The type each name's first value infers. */
  inferred?: ReadonlyMap<string, VaultPropertyType>;
  types: Map<string, VaultPropertyType>;
  /** The keys each note's Profile replaces, by path. */
  replaced: Map<string, readonly string[]>;
}

const freshMemo = (): VaultMemo => ({ types: new Map(), replaced: new Map() });

/** The column's Literature Notes, from the Note Index and the usual creation. */
export function literatureNotes(deps: LiteratureNotesDeps): LiteratureNotes {
  // Kept only while a listener watches, as only then does a change of the
  // notes or of an assigned type clear it.
  let memo: VaultMemo | null = null;
  let watchers = 0;
  let unwatch = () => {};
  const invalidate = () => {
    if (memo) memo = freshMemo();
  };
  const watch = () => {
    if (watchers++ === 0) {
      memo = freshMemo();
      const offs = [
        deps.noteIndex.on("changed", invalidate),
        deps.noteIndex.on("frontmatter-changed", invalidate),
        onTypesChanged(deps.app, invalidate),
      ];
      unwatch = () => offs.forEach((off) => off());
    }
    let watching = true;
    return () => {
      if (!watching) return;
      watching = false;
      if (--watchers === 0) {
        unwatch();
        memo = null;
      }
    };
  };
  const remember = <K, V>(
    pick: (memo: VaultMemo) => Map<K, V>,
    key: K,
    read: () => V,
  ): V => {
    const map = memo && pick(memo);
    if (map?.has(key)) return map.get(key)!;
    const value = read();
    map?.set(key, value);
    return value;
  };
  const inferredTypes = (): ReadonlyMap<string, VaultPropertyType> => {
    if (memo?.inferred) return memo.inferred;
    const inferred = new Map<string, VaultPropertyType>();
    for (const itemKey of deps.noteIndex.getIndexedItemKeys()) {
      const note = deps.noteIndex.getNotesByItemKey(itemKey)[0];
      if (!note) continue;
      for (const [name, value] of Object.entries(frontmatterOf(note.path)))
        if (!inferred.has(name) && value !== undefined && value !== null)
          inferred.set(name, inferType(value));
    }
    if (memo) memo.inferred = inferred;
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
      const stop = watch();
      // Each clears what it made stale before the listener reads again.
      const offs = [
        deps.noteIndex.on(event, () => {
          invalidate();
          listener();
        }),
      ];
      if (event === "frontmatter-changed")
        offs.push(
          onTypesChanged(deps.app, () => {
            invalidate();
            listener();
          }),
        );
      return () => {
        offs.forEach((off) => off());
        stop();
      };
    },
    propertyNames: () => {
      if (memo?.names) return memo.names;
      const names = deps.noteIndex
        .getPropertyNames()
        .filter((name) => `vault.${name}` !== LITERATURE_NOTE);
      if (memo) memo.names = names;
      return names;
    },
    propertyType: (name) =>
      remember(
        (memo) => memo.types,
        name,
        (): VaultPropertyType => {
          const assigned = assignedWidget(deps.app, name);
          if (assigned !== null && ASSIGNABLE.has(assigned))
            return assigned as VaultPropertyType;
          return inferredTypes().get(name) ?? "text";
        },
      ),
    read: (itemKey, name, host) => {
      const path = pathOf(itemKey, host);
      if (path === undefined) return { note: false };
      return { note: true, value: frontmatterOf(path)[name] ?? null };
    },
    managed: (itemKey, name, host) => {
      const file = fileOf(itemKey, host);
      if (file === null) return false;
      return remember(
        (memo) => memo.replaced,
        file.path,
        () => replacedKeys(deps, file),
      ).includes(name);
    },
    write: async ({ itemKey, name, value, host }) => {
      const file = fileOf(itemKey, host);
      if (file === null) return "no-note";
      await processLiveFrontMatter(deps.app, file, (frontmatter) => {
        frontmatter[name] = value;
      });
      return "written";
    },
    open: (note, event) =>
      void deps.app.workspace.openLinkText(
        note.path,
        "",
        Keymap.isModEvent(event),
      ),
    create: async (itemKey) => {
      const { reads } = await deps.zoteroReads.ready;
      const item = (
        await Effect.runPromise(
          reads.ItemsByIndexedKeys({ indexedKeys: [itemKey] }),
        )
      ).get(itemKey);
      if (item) await createNoteInteractively(deps, item);
    },
  };
}

/**
 * The keys the Profile of `file` manages with the replace strategy, by the
 * static keys of its Managed Frontmatter; none where its Profile or template
 * cannot be read now, so that a cell stays editable rather than locked on a
 * passing fault. A Spread Entry names no key until it runs, so it names none
 * here.
 */
function replacedKeys(
  deps: Pick<LiteratureNotesDeps, "profile" | "template">,
  file: TFile,
): readonly string[] {
  try {
    const resolved = deps.profile.profileOf(file);
    if (!resolved.ok) return [];
    const { document } = resolved.profile;
    const entries =
      document === undefined
        ? deps.template.frontmatterFields
        : (deps.template.getLiteratureNoteTemplate(document)?.frontmatter
            ?.compiled ?? []);
    return entries.flatMap(({ key, merge }) =>
      key !== undefined && merge === "replace" ? [key] : [],
    );
  } catch {
    return [];
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
