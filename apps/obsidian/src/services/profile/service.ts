// Registry and file operations for Literature Note Profiles.
import { customAlphabet } from "nanoid";
import { join } from "node:path/posix";
import type { App, TFile } from "obsidian";
import pLimit from "p-limit";
import { parseDocument, stringify as stringifyYaml } from "yaml";

import { createNanoEvents } from "@zotlit/shared/nanoevents";
import {
  TemplateFacade,
  synthesizeLegacyLiteratureNoteTemplate,
} from "@zotlit/templates/facade";
import type { LiteratureNoteTemplateManifest } from "@zotlit/templates/facade";
import { exportLiteratureNotePack } from "@zotlit/templates/literature-note-pack";

import { FIELD_LITERATURE_NOTE_PROFILE } from "@/lib/constants";
import {
  ensureParentFolder,
  joinFolderPath,
  normalizeFolderPath,
} from "@/lib/ensure-folder";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import {
  DEFAULT_PROFILE,
  isProfileId,
  readProfileStamp,
} from "@/lib/profile-stamp";
import type { ProfileId, ProfileSelector } from "@/lib/profile-stamp";
import { isFileExistsError } from "@/lib/vault-errors";
import type { NoteIndex } from "@/services/note-index/service";
import type { ProfileSelectionRule } from "@/services/profile-selection/schema";
import { bindProfile } from "@/services/profile/bindings";
import type {
  NoteProfile,
  ResolvedProfile,
  ResolvedLiteratureNoteProfileBindings,
} from "@/services/profile/bindings";
import { Service } from "@/services/service-base";
import type { SettingsService } from "@/services/settings/service";
import {
  DEFAULT_FRONTMATTER_FIELDS,
  DEFAULT_TEMPLATES,
} from "@/services/template/defaults";
import type {
  LiteratureNoteTemplateStatus,
  TemplateService,
} from "@/services/template/service";

const mintId = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  12,
);
const logger = getLogger(["profile"]);

export type ProfileBindings = Pick<
  LiteratureNoteTemplateManifest,
  | "folder"
  | "citationStyle"
  | "importFolder"
  | "importColoredHighlights"
  | "importAnnotationsAsTemplate"
>;

export const DEFAULT_PROFILE_DOCUMENT = "zotlit-profile.default.md";

export interface LiteratureNoteProfile {
  readonly id: ProfileId;
  readonly label: string;
  readonly document: string;
  readonly path: string;
  readonly bindings: Partial<ResolvedLiteratureNoteProfileBindings>;
}

export interface ProfileCreateOptions {
  label: string;
  look?: ProfileSelector;
  source?: string;
  bindings?: ProfileBindings;
}

export interface PreparedProfileCreation {
  profile: ResolvedProfile;
  source: string;
  inherited: ("folder" | "citationStyle" | "look")[];
  reason?: string;
  create(): Promise<LiteratureNoteProfile>;
}

export interface ProfileImportOptions {
  inheritCitationStyle?: boolean;
  folder?: string | null;
  citationStyle?: string | null;
  stripFolders?: boolean;
}

export interface ProfileShareOptions {
  version: string;
  author: string;
  description: string;
  includeFolders?: boolean;
}

export interface PreparedProfileShare {
  readonly manifest: LiteratureNoteTemplateManifest;
  readonly partials: readonly string[];
  readonly filename: string;
  render(options: ProfileShareOptions): string;
}

export type PreparedProfileImport = {
  manifest: LiteratureNoteTemplateManifest;
  profile: ResolvedProfile;
  source: string;
  path: string;
  import(): Promise<LiteratureNoteProfile>;
} & (
  | { kind: "fresh" }
  | {
      kind: "replace";
      held: {
        label: string;
        version: string;
        literatureNotes: number;
        importedNotes: number;
      };
    }
);

export interface ProfileDiagnostic {
  readonly code: "invalid-profile-document" | "duplicate-profile-id";
  readonly path: string;
  readonly message: string;
  readonly paths?: readonly string[];
  readonly reason?: "invalid-profile-id";
}

export interface ProfileDeletionTarget {
  profile: ResolvedProfile;
  files: { file: TFile; path: string }[];
}

export interface ProfileDeletionPlan {
  source: LiteratureNoteProfile;
  literatureNotes: TFile[];
  importedNotes: TFile[];
  targets: ProfileDeletionTarget[];
  /**
   * Profile Selection Rules whose target is the Profile. Deletion leaves them
   * as they are — the user repairs or removes each one in the rule editor.
   */
  rules: readonly ProfileSelectionRule[];
}

export interface ProfileDeletionResult {
  literatureNotes: number;
  importedNotes: number;
  movedFiles: number;
}

interface ProfileServiceDeps {
  app: App;
  settings: SettingsService;
  template: TemplateService;
  noteIndex: Pick<NoteIndex, "whenIndexed" | "getNotesByProfile">;
}

export type ProfileReader = Pick<
  ProfileService,
  "ready" | "loaded" | "profiles" | "resolveProfile" | "profileOf" | "on"
>;

export class ProfileService extends Service {
  readonly #mutate = pLimit(1);
  readonly #deps: ProfileServiceDeps;
  readonly #events = createNanoEvents<{ changed: () => void }>();
  #profiles: LiteratureNoteProfile[] = [];
  #diagnostics: ProfileDiagnostic[] = [];
  #defaultDocument: string | undefined;
  #defaultExcluded = false;
  #loaded = false;
  ready: Promise<void>;

  constructor(deps: ProfileServiceDeps) {
    super();
    this.#deps = deps;
    this.ready = this.#load();
  }

  get loaded(): boolean {
    return this.#loaded;
  }
  get profiles(): readonly LiteratureNoteProfile[] {
    return this.#profiles;
  }
  get diagnostics(): readonly ProfileDiagnostic[] {
    return this.#diagnostics;
  }
  get defaultDocumentPath(): string {
    return join(
      this.#deps.settings.current?.["template.folder"] ?? "templates",
      this.#defaultDocument ?? DEFAULT_PROFILE_DOCUMENT,
    );
  }
  on(event: "changed", callback: () => void): () => void {
    return this.#events.on(event, callback);
  }

  resolveProfile(selector: ProfileSelector): ResolvedProfile | undefined {
    if (!this.#loaded) throw new Error("ProfileService is not ready");
    const settings = this.#deps.settings.current!;
    if (selector === DEFAULT_PROFILE) {
      return this.#defaultExcluded
        ? undefined
        : bindProfile(settings, { selector, document: this.#defaultDocument });
    }
    const entry = this.#profiles.find(({ id }) => id === selector);
    return (
      entry &&
      bindProfile(settings, { selector, document: entry.document, entry })
    );
  }

  profileOf(file?: TFile): NoteProfile {
    const stamped =
      file && readProfileStamp(this.#deps.app.metadataCache, file);
    const profile =
      stamped === undefined
        ? this.resolveProfile(DEFAULT_PROFILE)
        : stamped.id === undefined
          ? undefined
          : this.resolveProfile(stamped.id);
    return profile
      ? { ok: true, profile }
      : {
          ok: false,
          stamped: stamped ?? { stamp: DEFAULT_PROFILE, id: undefined },
        };
  }

  async prepareCreate(
    options: ProfileCreateOptions,
  ): Promise<PreparedProfileCreation> {
    await this.ready;
    const requestedLabel = options.label.trim();
    const label = requestedLabel || m.settings_profile_new_name();
    const base = this.resolveProfile(DEFAULT_PROFILE);
    if (!base) throw new Error(m.notice_profile_action_failed());
    const baseline = await this.getSource(DEFAULT_PROFILE);
    const source =
      options.source ??
      (options.look === undefined || options.look === DEFAULT_PROFILE
        ? baseline
        : await this.getSource(options.look));
    const facade = new TemplateFacade();
    const defaultLook = facade.parseLiteratureNoteTemplate(baseline);
    const look =
      source === baseline
        ? defaultLook
        : facade.parseLiteratureNoteTemplate(source);
    const differs =
      look.body !== defaultLook.body ||
      look.annotationSection.source !== defaultLook.annotationSection.source ||
      (["filename", "language", "frontmatter", "partials"] as const).some(
        (key) =>
          JSON.stringify(look.manifest[key]) !==
          JSON.stringify(defaultLook.manifest[key]),
      );
    const bindings = { ...options.bindings };
    for (const [key, binding] of Object.entries(PROFILE_BINDING_KEYS)) {
      const name = key as keyof ProfileBindings;
      const value = bindings[name];
      const inherited = base.bindings[binding];
      if (
        value === undefined ||
        value === inherited ||
        ((name === "folder" || name === "importFolder") &&
          typeof value === "string" &&
          normalizeFolderPath(value) ===
            normalizeFolderPath(inherited as string))
      )
        delete bindings[name];
    }
    let reason =
      !differs && Object.keys(bindings).length === 0
        ? m.settings_profile_create_no_difference()
        : undefined;
    try {
      this.#validateLabel(requestedLabel);
    } catch (error) {
      if (requestedLabel || !reason)
        reason = Error.isError(error)
          ? error.message
          : m.settings_profile_name_invalid();
    }
    const id = mintId() as ProfileId;
    const content = profileSource(source, { id, label, bindings });
    const folder = this.#deps.settings.current!["template.folder"];
    const plainDocument = `zotlit-profile.${profileSlug(label)}.md`;
    const document = this.#deps.app.vault.getAbstractFileByPath(
      join(folder, plainDocument),
    )
      ? `zotlit-profile.${profileSlug(label)}-${id}.md`
      : plainDocument;
    const entry: LiteratureNoteProfile = {
      id,
      label,
      document,
      path: join(folder, document),
      bindings: Object.fromEntries(
        Object.entries(bindings).map(([key, value]) => [
          PROFILE_BINDING_KEYS[key as keyof ProfileBindings],
          value,
        ]),
      ),
    };
    const inherited: PreparedProfileCreation["inherited"] = [];
    if (bindings.folder === undefined) inherited.push("folder");
    if (bindings.citationStyle === undefined) inherited.push("citationStyle");
    if (!differs) inherited.push("look");
    const profile = bindProfile(this.#deps.settings.current!, {
      selector: id,
      document: entry.document,
      entry,
    });
    logger.debug("Prepared Profile creation", { id, label, inherited });
    return {
      profile,
      source: content,
      inherited,
      reason,
      create: () =>
        this.#mutate(() => {
          if (reason) throw new Error(reason);
          return this.#persist(label, id, content);
        }),
    };
  }

  async create(options: ProfileCreateOptions): Promise<LiteratureNoteProfile> {
    return (await this.prepareCreate(options)).create();
  }

  /** Read the effective look without ejecting the built-in Default document. */
  async getSource(selector: ProfileSelector): Promise<string> {
    await this.ready;
    const profile = this.resolveProfile(selector);
    if (!profile)
      throw new Error(
        m.settings_profile_source_unavailable({ profile: selector }),
      );
    if (profile.document) {
      const file = this.#deps.app.vault.getFileByPath(
        join(this.#deps.settings.current!["template.folder"], profile.document),
      );
      if (!file)
        throw new Error(
          m.settings_profile_source_missing({ document: profile.document }),
        );
      return this.#deps.app.vault.cachedRead(file);
    }
    return this.#builtInDocument();
  }

  /**
   * The built-in Default look as a Profile document: the embedded templates
   * with the Managed Frontmatter the settings tab configured, so an eject or a
   * duplicate carries the user's properties instead of the shipped defaults.
   */
  #builtInDocument(): string {
    return synthesizeLegacyLiteratureNoteTemplate(
      {
        note: { source: DEFAULT_TEMPLATES.note, language: "liquid" },
        content: { source: DEFAULT_TEMPLATES.content, language: "liquid" },
        filename: { source: DEFAULT_TEMPLATES.filename, language: "liquid" },
      },
      {
        id: DEFAULT_PROFILE,
        name: m.settings_profile_default_name(),
        frontmatter:
          this.#deps.settings.current?.["note.frontmatter-fields"] ??
          DEFAULT_FRONTMATTER_FIELDS,
      },
    );
  }

  /** Copy a Profile's document under `label`, or under "<source> copy". */
  async duplicate(
    selector: ProfileSelector,
    options: { label?: string } = {},
  ): Promise<LiteratureNoteProfile> {
    await this.ready;
    return this.#mutate(async () => {
      const profile = this.resolveProfile(selector);
      if (!profile) throw new Error(`Unknown Profile: ${selector}`);
      const label = profile.label ?? m.settings_profile_default_name();
      const base = options.label ?? m.settings_profile_copy_name({ label });
      let copyLabel = base;
      let number = 2;
      while (
        this.#profiles.some(
          (entry) =>
            entry.label.toLocaleLowerCase() === copyLabel.toLocaleLowerCase(),
        )
      )
        copyLabel = `${base} ${number++}`;
      const id = mintId() as ProfileId;
      return this.#persist(
        copyLabel,
        id,
        profileSource(await this.getSource(selector), { id, label: copyLabel }),
      );
    });
  }

  /** Freeze one export identity, effective bindings and partials for a Share sheet. */
  async prepareShare(selector: ProfileSelector): Promise<PreparedProfileShare> {
    await this.ready;
    await this.#settle();
    const profile = this.resolveProfile(selector);
    if (!profile)
      throw new Error(
        m.settings_profile_source_unavailable({ profile: selector }),
      );
    const id =
      selector === DEFAULT_PROFILE ? (mintId() as ProfileId) : selector;
    const label = profile.label ?? m.settings_profile_default_name();
    const bindings = Object.fromEntries(
      Object.entries(PROFILE_BINDING_KEYS).map(([key, binding]) => [
        key,
        profile.bindings[binding],
      ]),
    ) as ProfileBindings;
    const source = await this.#deps.template.exportLiteratureNotePackSource(
      profileSource(await this.getSource(selector), { id, label, bindings }),
      { includeFolders: true },
    );
    const facade = new TemplateFacade();
    const { manifest } = facade.parseLiteratureNoteTemplate(source);
    const partials = manifest.partials?.map(({ name }) => name) ?? [];
    logger.debug("Prepared Profile sharing", { selector, id, partials });
    return {
      manifest,
      partials,
      filename: `zotlit-profile.${profileSlug(label)}${selector === DEFAULT_PROFILE ? `-${id}` : ""}.md`,
      render: (options) => {
        const version = options.version.trim();
        if (!version) throw new Error(m.profile_share_version_required());
        const headerEnd = source.indexOf("\n---", source.indexOf("---") + 3);
        const header = parseDocument(source.slice(4, headerEnd));
        header.set("version", version);
        for (const key of ["author", "description"] as const) {
          const value = options[key].trim();
          if (value) header.set(key, value);
          else header.delete(key);
        }
        return exportLiteratureNotePack(
          `---\n${header.toString()}---${source.slice(headerEnd + 4)}`,
          [],
          { includeFolders: options.includeFolders },
        );
      },
    };
  }

  #validateLabel(label: string): void {
    const slug = profileSlug(label);
    if (
      !slug ||
      slug === DEFAULT_PROFILE ||
      this.#profiles.some(
        (profile) =>
          profile.label.toLocaleLowerCase() === label.toLocaleLowerCase(),
      )
    )
      throw new Error(m.settings_profile_name_invalid());
  }

  async #persist(
    label: string,
    id: ProfileId,
    content: string,
  ): Promise<LiteratureNoteProfile> {
    this.#validateLabel(label);
    const folder = this.#deps.settings.current!["template.folder"];
    let path = join(folder, `zotlit-profile.${profileSlug(label)}.md`);
    await ensureParentFolder(this.#deps.app, path);
    try {
      await this.#deps.app.vault.create(path, content);
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      path = join(folder, `zotlit-profile.${profileSlug(label)}-${id}.md`);
      await this.#deps.app.vault.create(path, content);
    }
    await this.#settle();
    const entry = this.#profiles.find((profile) => profile.id === id);
    if (!entry)
      throw new Error(`Profile document could not be registered: ${path}`);
    return entry;
  }

  async prepareImport(
    source: string,
    options: ProfileImportOptions = {},
  ): Promise<PreparedProfileImport> {
    await this.ready;
    await this.#settle();
    let parsed;
    try {
      parsed = new TemplateFacade().parseLiteratureNoteTemplate(source);
    } catch (error) {
      throw new Error(m.profile_import_invalid(), { cause: error });
    }
    if (parsed.manifest.id === DEFAULT_PROFILE)
      throw new Error(m.profile_import_default());
    if (!isProfileId(parsed.manifest.id))
      throw new Error(m.settings_profile_id_invalid());
    const id = parsed.manifest.id;
    const held = this.#importTarget(id);
    const manifest = { ...parsed.manifest };
    if (options.stripFolders) {
      delete manifest.folder;
      delete manifest.importFolder;
    }
    if (options.folder === null) delete manifest.folder;
    else if (options.folder !== undefined) manifest.folder = options.folder;
    if (options.inheritCitationStyle) delete manifest.citationStyle;
    else if (options.citationStyle !== undefined)
      manifest.citationStyle = options.citationStyle;
    const content = `---\n${stringifyYaml(manifest, { lineWidth: 0 })}---\n${source.slice(parsed.bodyStart)}`;
    const folder = this.#deps.settings.current!["template.folder"];
    const slug = profileSlug(manifest.name);
    const plain = `zotlit-profile.${slug}.md`;
    const document =
      held?.document ??
      (!slug ||
      slug === DEFAULT_PROFILE ||
      this.#deps.app.vault.getAbstractFileByPath(join(folder, plain))
        ? `zotlit-profile.${slug || "profile"}-${id}.md`
        : plain);
    const path = held?.path ?? join(folder, document);
    const entry: LiteratureNoteProfile = {
      id,
      label: manifest.name,
      document,
      path,
      bindings: Object.fromEntries(
        Object.entries(PROFILE_BINDING_KEYS).flatMap(([key, value]) =>
          manifest[key as keyof ProfileBindings] === undefined
            ? []
            : [[value, manifest[key as keyof ProfileBindings]]],
        ),
      ),
    };
    const heldSource = held ? await this.getSource(id) : undefined;
    let decision:
      | Pick<
          Extract<PreparedProfileImport, { kind: "replace" }>,
          "kind" | "held"
        >
      | { kind: "fresh" } = { kind: "fresh" };
    if (held) {
      await this.#deps.noteIndex.whenIndexed();
      const notes = this.#deps.noteIndex.getNotesByProfile(id);
      const heldManifest = new TemplateFacade().parseLiteratureNoteTemplate(
        heldSource!,
      ).manifest;
      decision = {
        kind: "replace",
        held: {
          label: held.label,
          version: heldManifest.version,
          literatureNotes: notes.literatureNotes.length,
          importedNotes: notes.importedNotes.length,
        },
      };
    }
    logger.debug("Prepared Profile import", { id, path, kind: decision.kind });
    return {
      ...decision,
      manifest,
      source: content,
      path,
      profile: bindProfile(this.#deps.settings.current!, {
        selector: id,
        document,
        entry,
      }),
      import: () =>
        this.#mutate(async () => {
          await this.#settle();
          const current = this.#importTarget(id);
          if (current?.path !== held?.path)
            throw new Error(m.profile_import_changed());
          if (held) {
            const file = this.#deps.app.vault.getFileByPath(path);
            if (!file) throw new Error(m.profile_import_changed());
            await this.#deps.app.vault.process(file, (currentSource) => {
              if (currentSource !== heldSource)
                throw new Error(m.profile_import_changed());
              return content;
            });
          } else {
            await ensureParentFolder(this.#deps.app, path);
            try {
              await this.#deps.app.vault.create(path, content);
            } catch (error) {
              if (isFileExistsError(error))
                throw new Error(m.profile_import_changed(), { cause: error });
              throw error;
            }
          }
          await this.#settle();
          const imported = this.#profiles.find((profile) => profile.id === id);
          if (!imported) throw new Error(m.profile_import_excluded());
          logger.debug("Imported Profile document", {
            id,
            path,
            replaced: !!held,
          });
          return imported;
        }),
    };
  }

  #importTarget(id: ProfileId): LiteratureNoteProfile | undefined {
    const matches = this.#deps.template
      .getLiteratureNoteTemplateStatuses()
      .filter(
        (status) =>
          status.reference.startsWith("zotlit-profile.") &&
          documentId(status) === id,
      );
    const held = this.#profiles.find((profile) => profile.id === id);
    if (matches.length > 1 || (matches.length && !held))
      throw new Error(m.profile_import_excluded());
    return held;
  }

  async ejectDefault(): Promise<TFile> {
    await this.ready;
    const path = this.defaultDocumentPath;
    await ensureParentFolder(this.#deps.app, path);
    let file: TFile;
    try {
      file = await this.#deps.app.vault.create(path, this.#builtInDocument());
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      const existing = this.#deps.app.vault.getFileByPath(path);
      if (!existing) throw error;
      file = existing;
    }
    await this.#settle();
    return file;
  }

  async restoreDefault(): Promise<void> {
    await this.ready;
    const path = this.defaultDocumentPath;
    const file = this.#deps.app.vault.getFileByPath(path);
    if (file) await this.#deps.app.fileManager.trashFile(file);
    await this.#settle();
  }

  async prepareDelete(id: ProfileId): Promise<ProfileDeletionPlan> {
    await this.ready;
    const source = this.#profiles.find((profile) => profile.id === id);
    if (!source) throw new Error("The Profile is unavailable");
    await this.#deps.noteIndex.whenIndexed();
    const { literatureNotes, importedNotes } =
      this.#deps.noteIndex.getNotesByProfile(id);
    const selectors: ProfileSelector[] = [
      DEFAULT_PROFILE,
      ...this.#profiles
        .filter((profile) => profile.id !== id)
        .map(({ id }) => id),
    ];
    const targets = selectors.flatMap((selector) => {
      const profile = this.resolveProfile(selector);
      if (!profile) return [];
      const files = [
        ...literatureNotes.map((file) => ({
          file,
          path: joinFolderPath(
            normalizeFolderPath(profile.bindings["note.literature-folder"]),
            file.name,
          ),
        })),
        ...importedNotes.map((file) => ({
          file,
          path: joinFolderPath(
            normalizeFolderPath(profile.bindings["note.import-folder"]),
            file.name,
          ),
        })),
      ];
      return [{ profile, files }];
    });
    const rules = (
      this.#deps.settings.current?.["profile.selection-rules"] ?? []
    ).filter((rule) => rule.profile === id);
    logger.debug("Prepared Profile deletion", {
      id,
      literatureNotes: literatureNotes.length,
      importedNotes: importedNotes.length,
      rules: rules.length,
    });
    return { source, literatureNotes, importedNotes, targets, rules };
  }

  async delete(
    id: ProfileId,
    target: ProfileSelector,
    options: { move?: boolean } = {},
  ): Promise<ProfileDeletionResult> {
    const plan = await this.prepareDelete(id);
    const destination = plan.targets.find(
      ({ profile }) => profile.selector === target,
    );
    if (
      !destination &&
      (plan.literatureNotes.length || plan.importedNotes.length)
    )
      throw new Error("Select an available target Profile before deleting");
    const { app } = this.#deps;
    let movedFiles = 0;
    const stamp = destination?.profile.stamp;
    for (const { file, path } of destination?.files ?? []) {
      if (options.move && path !== file.path) {
        await ensureParentFolder(app, path);
        await app.fileManager.renameFile(file, path);
        movedFiles++;
      }
      await app.fileManager.processFrontMatter(file, (frontmatter) => {
        if (stamp === undefined)
          delete frontmatter[FIELD_LITERATURE_NOTE_PROFILE];
        else frontmatter[FIELD_LITERATURE_NOTE_PROFILE] = stamp;
      });
    }
    const file = app.vault.getFileByPath(plan.source.path);
    if (file) await app.fileManager.trashFile(file);
    await this.#settle();
    const result = {
      literatureNotes: plan.literatureNotes.length,
      importedNotes: plan.importedNotes.length,
      movedFiles,
    };
    logger.debug("Deleted Profile after moving its notes", {
      id,
      target,
      ...result,
    });
    return result;
  }

  async #settle(): Promise<void> {
    if ((await this.#deps.template.waitUntilSettled(5000)) !== "settled")
      throw new Error("Profile documents did not finish scanning");
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    await this.#deps.template.ready;
    stack.defer(
      this.#deps.template.on("compile-status-changed", () => this.#scan()),
    );
    stack.defer(
      this.#deps.settings.subscribe(() => this.#events.emit("changed")),
    );
    this.#scan();
    this.#loaded = true;
    this.#events.emit("changed");
    this.commit(stack.move());
  }

  #scan(): void {
    this.#profiles = [];
    this.#diagnostics = [];
    this.#defaultDocument = undefined;
    this.#defaultExcluded = false;
    const statuses = this.#deps.template
      .getLiteratureNoteTemplateStatuses()
      .filter(({ reference }) => reference.startsWith("zotlit-profile."));
    for (const status of statuses) {
      const validation = status.validation;
      const id = documentId(status);
      if (
        validation.state === "invalid" ||
        (id !== DEFAULT_PROFILE && !isProfileId(id!))
      ) {
        this.#diagnostics.push({
          code: "invalid-profile-document",
          path: status.path,
          ...(validation.state === "valid"
            ? { reason: "invalid-profile-id" as const }
            : {}),
          message:
            validation.state === "invalid"
              ? validation.error.message
              : "The Profile ID must contain twelve letters or digits.",
        });
        logger.debug("Excluded invalid Profile document {path}", {
          path: status.path,
          id,
        });
        if (
          id === DEFAULT_PROFILE ||
          status.reference === DEFAULT_PROFILE_DOCUMENT
        ) {
          this.#defaultExcluded = true;
          this.#defaultDocument = status.reference;
        }
      }
    }
    const groups = Map.groupBy(
      statuses.filter((status) => {
        const id = documentId(status);
        return id === DEFAULT_PROFILE || (id !== undefined && isProfileId(id));
      }),
      documentId,
    );
    for (const [id, group] of groups) {
      if (group.length > 1) {
        const paths = group.map(({ path }) => path);
        logger.debug("Excluded duplicate Profile ID {id} in {paths}", {
          id,
          paths,
        });
        for (const { path } of group)
          this.#diagnostics.push({
            code: "duplicate-profile-id",
            path,
            paths,
            message: `Profile ID '${id}' is shared by ${paths.join(", ")}.`,
          });
        if (id === DEFAULT_PROFILE) this.#defaultExcluded = true;
        continue;
      }
      const status = group[0]!;
      if (status.validation.state !== "valid") continue;
      if (id === DEFAULT_PROFILE) {
        this.#defaultDocument = status.reference;
        continue;
      }
      const manifest = status.validation.manifest;
      this.#profiles.push({
        id: id as ProfileId,
        label: manifest.name,
        document: status.reference,
        path: status.path,
        bindings: {
          ...(manifest.folder === undefined
            ? {}
            : { "note.literature-folder": manifest.folder }),
          ...(manifest.citationStyle === undefined
            ? {}
            : { "citation.references-style": manifest.citationStyle }),
          ...(manifest.importFolder === undefined
            ? {}
            : { "note.import-folder": manifest.importFolder }),
          ...(manifest.importColoredHighlights === undefined
            ? {}
            : {
                "note.import-colored-highlights":
                  manifest.importColoredHighlights,
              }),
          ...(manifest.importAnnotationsAsTemplate === undefined
            ? {}
            : {
                "note.import-annotations-as-template":
                  manifest.importAnnotationsAsTemplate,
              }),
        },
      });
    }
    logger.debug(
      "Profile scan completed with {profiles} Profiles and {diagnostics} diagnostics",
      {
        profiles: this.#profiles.length,
        diagnostics: this.#diagnostics.length,
        defaultDocument: this.#defaultDocument,
        defaultExcluded: this.#defaultExcluded,
      },
    );
    if (this.#loaded) this.#events.emit("changed");
  }
}

function documentId(status: LiteratureNoteTemplateStatus): string | undefined {
  return status.validation.state === "valid"
    ? status.validation.manifest.id
    : status.validation.manifestId;
}

function profileSlug(label: string): string {
  return label
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "-")
    .replaceAll(/^-|-$/g, "");
}

const PROFILE_BINDING_KEYS = {
  folder: "note.literature-folder",
  citationStyle: "citation.references-style",
  importFolder: "note.import-folder",
  importColoredHighlights: "note.import-colored-highlights",
  importAnnotationsAsTemplate: "note.import-annotations-as-template",
} as const;

function profileSource(
  source: string,
  options: { id: ProfileId; label: string; bindings?: ProfileBindings },
): string {
  const facade = new TemplateFacade();
  facade.parseLiteratureNoteTemplate(source);
  const headerEnd = source.indexOf("\n---", source.indexOf("---") + 3);
  const header = parseDocument(source.slice(4, headerEnd));
  header.set("id", options.id);
  header.set("name", options.label);
  if (options.bindings !== undefined) {
    for (const key of Object.keys(PROFILE_BINDING_KEYS)) header.delete(key);
    for (const [key, value] of Object.entries(options.bindings))
      header.set(key, value);
  }
  const content = `---\n${header.toString()}---${source.slice(headerEnd + 4)}`;
  facade.parseLiteratureNoteTemplate(content);
  return content;
}
