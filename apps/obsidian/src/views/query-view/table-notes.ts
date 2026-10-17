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
 * that shows it: one inferred from a value it holds, else text.
 */
export type VaultPropertyType =
  | "text"
  | "multitext"
  | "number"
  | "checkbox"
  | "date";

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
   * `frontmatter-changed`: the frontmatter of a Literature Note changed.
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

/** The column's Literature Notes, from the Note Index and the usual creation. */
export function literatureNotes(deps: LiteratureNotesDeps): LiteratureNotes {
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
    on: (event, listener) => deps.noteIndex.on(event, () => listener()),
    propertyNames: () =>
      deps.noteIndex
        .getPropertyNames()
        .filter((name) => `vault.${name}` !== LITERATURE_NOTE),
    propertyType: (name) => {
      for (const itemKey of deps.noteIndex.getIndexedItemKeys()) {
        const note = deps.noteIndex.getNotesByItemKey(itemKey)[0];
        const value = note && frontmatterOf(note.path)[name];
        if (value !== undefined && value !== null) return inferType(value);
      }
      return "text";
    },
    read: (itemKey, name, host) => {
      const path = pathOf(itemKey, host);
      if (path === undefined) return { note: false };
      return { note: true, value: frontmatterOf(path)[name] ?? null };
    },
    managed: (itemKey, name, host) => {
      const file = fileOf(itemKey, host);
      return file !== null && replacedKeys(deps, file).includes(name);
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
 * type for: a list, a number, a checkbox, a date, else text.
 */
export function inferType(value: unknown): VaultPropertyType {
  if (Array.isArray(value)) return "multitext";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "string" && /^\d{4}-[01]\d-[0-3]\d$/.test(value))
    return "date";
  return "text";
}
