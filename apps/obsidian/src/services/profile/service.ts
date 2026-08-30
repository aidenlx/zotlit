// Registry and file operations for Literature Note Profiles.
import { customAlphabet } from "nanoid";
import { join } from "node:path/posix";
import type { App, TFile } from "obsidian";
import pLimit from "p-limit";
import { parseDocument } from "yaml";

import { createNanoEvents } from "@zotlit/shared/nanoevents";
import {
  TemplateFacade,
  synthesizeLegacyLiteratureNoteTemplate,
} from "@zotlit/templates/facade";
import type { LiteratureNoteTemplateManifest } from "@zotlit/templates/facade";

import { FIELD_LITERATURE_NOTE_PROFILE } from "@/lib/constants";
import { ensureParentFolder } from "@/lib/ensure-folder";
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

export interface ProfileDiagnostic {
  readonly code: "invalid-profile-document" | "duplicate-profile-id";
  readonly path: string;
  readonly message: string;
  readonly paths?: readonly string[];
  readonly reason?: "invalid-profile-id";
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

  create(options: {
    label: string;
    source?: string;
    bindings?: ProfileBindings;
  }): Promise<LiteratureNoteProfile> {
    return this.#mutate(async () => {
      await this.ready;
      const label = options.label.trim();
      const slug = profileSlug(label);
      if (
        !slug ||
        slug === DEFAULT_PROFILE ||
        this.#profiles.some(
          (profile) =>
            profile.label.toLocaleLowerCase() === label.toLocaleLowerCase(),
        )
      ) {
        throw new Error(m.settings_profile_name_invalid());
      }
      const id = mintId() as ProfileId;
      const source = options.source ?? builtInDocument(id, label);
      new TemplateFacade().parseLiteratureNoteTemplate(source);
      const headerEnd = source.indexOf("\n---", source.indexOf("---") + 3);
      const header = parseDocument(source.slice(4, headerEnd));
      header.set("id", id);
      header.set("name", label);
      if (options.bindings !== undefined) {
        for (const key of [
          "folder",
          "citationStyle",
          "importFolder",
          "importColoredHighlights",
          "importAnnotationsAsTemplate",
        ] as const)
          header.delete(key);
        for (const [key, value] of Object.entries(options.bindings))
          header.set(key, value);
      }
      const content = `---\n${header.toString()}---${source.slice(headerEnd + 4)}`;
      // Validate the edited manifest before creating a vault file.
      new TemplateFacade().parseLiteratureNoteTemplate(content);
      const folder = this.#deps.settings.current!["template.folder"];
      let path = join(folder, `zotlit-profile.${slug}.md`);
      await ensureParentFolder(this.#deps.app, path);
      try {
        await this.#deps.app.vault.create(path, content);
      } catch (error) {
        if (!isFileExistsError(error)) throw error;
        path = join(folder, `zotlit-profile.${slug}-${id}.md`);
        await this.#deps.app.vault.create(path, content);
      }
      await this.#settle();
      const entry = this.#profiles.find((profile) => profile.id === id);
      if (!entry)
        throw new Error(`Profile document could not be registered: ${path}`);
      return entry;
    });
  }

  async duplicate(id: ProfileSelector): Promise<LiteratureNoteProfile> {
    await this.ready;
    const profile = this.resolveProfile(id);
    if (!profile) throw new Error(`Unknown Profile: ${id}`);
    const label = profile.label ?? m.settings_profile_default_name();
    let copyLabel = m.settings_profile_copy_name({ label });
    let number = 2;
    while (
      this.#profiles.some(
        (entry) =>
          entry.label.toLocaleLowerCase() === copyLabel.toLocaleLowerCase(),
      )
    )
      copyLabel = `${m.settings_profile_copy_name({ label })} ${number++}`;
    const file =
      profile.document &&
      this.#deps.app.vault.getFileByPath(
        join(this.#deps.settings.current!["template.folder"], profile.document),
      );
    return this.create({
      label: copyLabel,
      source: file
        ? await this.#deps.app.vault.cachedRead(file)
        : builtInDocument(id, label),
    });
  }

  async ejectDefault(): Promise<TFile> {
    await this.ready;
    const path = this.defaultDocumentPath;
    await ensureParentFolder(this.#deps.app, path);
    let file: TFile;
    try {
      file = await this.#deps.app.vault.create(
        path,
        builtInDocument(DEFAULT_PROFILE, m.settings_profile_default_name()),
      );
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

  async delete(id: ProfileId, target: ProfileSelector): Promise<void> {
    await this.ready;
    if (id === target)
      throw new Error("Select another Profile before deleting");
    const source = this.#profiles.find((profile) => profile.id === id);
    const destination = this.resolveProfile(target);
    if (!source || !destination)
      throw new Error("The source or destination Profile is unavailable");
    const { app } = this.#deps;
    await this.#deps.noteIndex.whenIndexed();
    const { literatureNotes, importedNotes } =
      this.#deps.noteIndex.getNotesByProfile(id);
    for (const file of [...literatureNotes, ...importedNotes]) {
      await app.fileManager.processFrontMatter(file, (frontmatter) => {
        if (destination.stamp === undefined)
          delete frontmatter[FIELD_LITERATURE_NOTE_PROFILE];
        else frontmatter[FIELD_LITERATURE_NOTE_PROFILE] = destination.stamp;
      });
    }
    const file = app.vault.getFileByPath(source.path);
    if (file) await app.fileManager.trashFile(file);
    await this.#settle();
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
    const lastUsed = this.#deps.settings.current!["note.last-used-profile"];
    if (
      lastUsed !== null &&
      lastUsed !== DEFAULT_PROFILE &&
      !this.#profiles.some(({ id }) => id === lastUsed)
    ) {
      this.#deps.settings.update({ "note.last-used-profile": null });
      logger.debug("Cleared unavailable last-used Profile {selector}", {
        selector: lastUsed,
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

function builtInDocument(id: ProfileSelector, label: string): string {
  return synthesizeLegacyLiteratureNoteTemplate(
    {
      note: { source: DEFAULT_TEMPLATES.note, language: "liquid" },
      content: { source: DEFAULT_TEMPLATES.content, language: "liquid" },
      filename: { source: DEFAULT_TEMPLATES.filename, language: "liquid" },
    },
    { id, name: label, frontmatter: DEFAULT_FRONTMATTER_FIELDS },
  );
}
