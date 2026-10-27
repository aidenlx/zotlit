// The Literature Notes the Query View reads: the note of an Item the Table's
// "Literature note" column links, or "Create" where it has none, and the
// vault properties, `vault.<name>`, each the value of one frontmatter key of
// that note. "Create" is the usual Literature Note creation, which asks for a
// Profile when more than one fits. A view that a Literature Note holds reads
// that note for its own Item, whichever note the Note Index ranks first.
//
// @see apps/obsidian/docs/adr/0070-vault-properties-are-answered-outside-zotlit-query.md
import { Effect, Option } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { Keymap, parseLinktext } from "obsidian";
import type { App, TFile } from "obsidian";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

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
import { Workspace } from "@/lib/obsidian-workspace";
import type { ViewRegistryHandle } from "@/lib/view-atoms";
import { createNoteInteractively } from "@/services/note-feature/creation-view";
import type { InteractiveCreationPorts } from "@/services/note-feature/creation-view";
import { noteIndexSnapshotAtom } from "@/services/note-index/atoms";
import { profileRevisionAtom } from "@/services/profile/atoms";
import { templateRevisionAtom } from "@/services/template/atoms";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { makeQueryOperations } from "./atoms";
import { replacedKeysAtom } from "./note-atoms";
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

export interface LiteratureNotesDeps {
  registry: ViewRegistryHandle;
  app: App & LiveTextApp;
  creation: InteractiveCreationPorts;
}

/**
 * What the vault properties read across many notes, kept until a note is
 * added, changed or removed, or a Profile or a template changes.
 */
interface VaultMemo {
  names?: readonly string[];
  /** The type each name's first value infers. */
  inferred?: ReadonlyMap<string, VaultPropertyType>;
}

const freshMemo = (): VaultMemo => ({});

interface VaultEvents {
  changed: () => void;
  "frontmatter-changed": () => void;
}

/** The column's Literature Notes, from the Note Index and the usual creation. */
export function literatureNotes(deps: LiteratureNotesDeps): LiteratureNotes {
  const { registry } = deps;
  const operations = makeQueryOperations(registry);
  const memoAtom = Atom.map(noteIndexSnapshotAtom, () => freshMemo());
  const events = createNanoEvents<VaultEvents>();
  let listeners = 0;
  let offSources: (() => void) | null = null;
  const replacedSubscriptions = new Map<
    TFile,
    { path: string; release: () => void }
  >();
  const listen = () => {
    if (listeners++ === 0) {
      const releases = [
        registry.mount(noteIndexSnapshotAtom),
        registry.subscribe(noteIndexSnapshotAtom, (snapshot) => {
          events.emit(
            snapshot.change?.type === "frontmatter-changed"
              ? "frontmatter-changed"
              : "changed",
          );
        }),
      ];
      for (const atom of [profileRevisionAtom, templateRevisionAtom]) {
        releases.push(registry.mount(atom));
        releases.push(
          registry.subscribe(atom, () => events.emit("frontmatter-changed")),
        );
      }
      offSources = () => {
        for (const release of releases) release();
        for (const { release } of replacedSubscriptions.values()) release();
        replacedSubscriptions.clear();
      };
    }
    return () => {
      if (--listeners === 0) {
        offSources?.();
        offSources = null;
      }
    };
  };
  const replacedOf = (file: TFile) => {
    const atom = replacedKeysAtom(file.path);
    const result = registry.get(atom);
    const subscribed = replacedSubscriptions.get(file);
    if (listeners > 0 && subscribed?.path !== file.path) {
      subscribed?.release();
      replacedSubscriptions.set(file, {
        path: file.path,
        release: registry.subscribe(atom, (result) => {
          if (!result.waiting) events.emit("frontmatter-changed");
        }),
      });
    }
    return result;
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
    const memo = registry.get(memoAtom);
    if (memo.inferred) return memo.inferred;
    const inferred = new Map<string, VaultPropertyType>();
    for (const itemKey of registry.get(noteIndexSnapshotAtom).keys) {
      const note = firstNote(itemKey);
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
  // Body edits change the ranking through the live file stats without an index event.
  const firstNote = (itemKey: string) =>
    registry
      .get(noteIndexSnapshotAtom)
      .notes.get(itemKey)
      ?.toSorted(
        (a, b) => b.stat.mtime - a.stat.mtime || a.path.localeCompare(b.path),
      )[0];
  /** The path of the note an Item's vault properties are of. */
  const pathOf = (itemKey: string, host: VaultHost | null) =>
    host?.itemKey === itemKey ? host.path : firstNote(itemKey)?.path;
  const fileOf = (itemKey: string, host: VaultHost | null) => {
    const path = pathOf(itemKey, host);
    return path === undefined ? null : deps.app.vault.getFileByPath(path);
  };
  const createNote = Effect.fn("QueryView.createNote")(function* (
    itemKey: string,
  ) {
    const { reads } = yield* ZoteroReads;
    const item = (yield* reads.ItemsByIndexedKeys({
      indexedKeys: [itemKey],
    })).get(itemKey);
    return item ? yield* createNoteInteractively(deps.creation, item) : null;
  });
  return {
    find: (itemKey) => firstNote(itemKey) ?? null,
    on: (event, listener) => {
      const off = events.on(event, listener);
      const offSource = listen();
      if (event !== "frontmatter-changed")
        return () => {
          off();
          offSource();
        };
      // A change of an assigned type shows as a change of the frontmatter.
      const offTypes = listenTypes();
      return () => {
        off();
        offSource();
        offTypes();
      };
    },
    propertyNames: () =>
      (registry.get(memoAtom).names ??= registry
        .get(noteIndexSnapshotAtom)
        .names.filter((name) => `vault.${name}` !== LITERATURE_NOTE)),
    itemKeys: () => registry.get(noteIndexSnapshotAtom).keys,
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
      return (
        !keys.waiting &&
        Option.getOrElse(AsyncResult.value(keys), () => new Set<string>()).has(
          name,
        )
      );
    },
    write: (edit) =>
      operations.run(
        Effect.gen(function* () {
          const { itemKey, name, value, host } = edit;
          const found = fileOf(itemKey, host);
          const file = found ?? (yield* createNote(itemKey));
          if (file === null) return "cancelled" as const;
          const keys = yield* AtomRegistry.getResult(
            registry,
            replacedKeysAtom(file.path),
            { suspendOnWaiting: true },
          );
          if (keys.has(name)) return "managed" as const;
          yield* Effect.tryPromise(() =>
            processLiveFrontMatter(deps.app, file, (frontmatter) => {
              frontmatter[name] = value;
            }),
          );
          return found === null ? ("created" as const) : ("written" as const);
        }),
        "cancelled",
      ),
    suggestions: (name, type) =>
      type === "tags" ? vaultTags(deps.app) : propertyValues(deps.app, name),
    resolves: ({ target, itemKey, host }) =>
      deps.app.metadataCache.getFirstLinkpathDest(
        parseLinktext(target).path,
        pathOf(itemKey, host) ?? "",
      ) !== null,
    openLink: ({ target, itemKey, host }, event) => {
      void operations.run(
        Effect.flatMap(Workspace, (workspace) =>
          workspace.openLinkText(target, pathOf(itemKey, host) ?? "", {
            newLeaf: Keymap.isModEvent(event),
          }),
        ),
        undefined,
      );
    },
    open: (note, event) => {
      void operations.run(
        Effect.flatMap(Workspace, (workspace) =>
          workspace.openLinkText(note.path, "", {
            newLeaf: Keymap.isModEvent(event),
          }),
        ),
        undefined,
      );
    },
    create: (itemKey) =>
      operations.run(Effect.asVoid(createNote(itemKey)), undefined),
  };
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
