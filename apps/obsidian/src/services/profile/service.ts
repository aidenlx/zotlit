// Registry and file operations for Literature Note Profiles.
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  PubSub,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import { customAlphabet } from "nanoid";
import { join } from "node:path/posix";
import type { App, TFile } from "obsidian";
import PQueue from "p-queue";
import { parseDocument } from "yaml";

import {
  TemplateFacade,
  parseLiteratureNoteTemplate,
  synthesizeLegacyLiteratureNoteTemplate,
  updateLiteratureNoteTemplateMatch,
} from "@zotlit/templates/facade";
import type {
  LiteratureNoteTemplateManifest,
  MatchTree,
} from "@zotlit/templates/facade";
import {
  LiteratureNotePackError,
  updateLiteratureNotePackMetadata,
} from "@zotlit/templates/literature-note-pack";
import type { LiteratureNotePartialUnpack } from "@zotlit/templates/literature-note-pack";

import { FIELD_LITERATURE_NOTE_PROFILE } from "@/lib/constants";
import { withLogCategory } from "@/lib/effect-log";
import { ensureParentFolder, normalizeFolderPath } from "@/lib/ensure-folder";
import * as m from "@/lib/i18n/generated/messages";
import {
  processLiveFrontMatter,
  processLiveText,
  readLiveText,
} from "@/lib/live-text";
import { ObsidianApp } from "@/lib/obsidian-app";
import { FileManager } from "@/lib/obsidian-file-manager";
import { Vault } from "@/lib/obsidian-vault";
import { profileRevision } from "@/lib/profile-revision";
import {
  DEFAULT_PROFILE,
  isProfileId,
  PROFILE_ID_LENGTH,
  PROFILE_ID_RULE,
  readProfileStamp,
} from "@/lib/profile-stamp";
import type { ProfileId, ProfileSelector } from "@/lib/profile-stamp";
import { NoteIndex } from "@/services/note-index/service";
import { compileProfileMatch } from "@/services/profile-selection";
import type { ProfileMatch } from "@/services/profile-selection";
import { bindProfile } from "@/services/profile/bindings";
import type {
  NoteProfile,
  ResolvedProfile,
  ResolvedLiteratureNoteProfileBindings,
} from "@/services/profile/bindings";
import { relocatedNotePath } from "@/services/profile/relocation";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import {
  DEFAULT_FRONTMATTER_FIELDS,
  DEFAULT_TEMPLATES,
  RESERVED_PARTIAL_NAMES,
} from "@/services/template/defaults";
import { plainTemplateError } from "@/services/template/errors";
import { Template } from "@/services/template/service";
import type {
  LiteratureNoteTemplateStatus,
  TemplateOperations,
  TemplateStatus,
} from "@/services/template/service";

const mintId = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  PROFILE_ID_LENGTH,
);

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
  readonly match: ProfileMatch;
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
  constraint?: { kind: "invalid-name"; message: string };
  create(): Promise<LiteratureNoteProfile>;
}

export interface ProfileImportOptions {
  inheritCitationStyle?: boolean;
  folder?: string | null;
  citationStyle?: string | null;
  stripFolders?: boolean;
  includeMatch?: boolean;
}

export interface ProfileShareOptions {
  version: string;
  author: string;
  description: string;
  includeFolders?: boolean;
  includeMatch?: boolean;
  /** The partials the reader checked; the bundle carries exactly these. */
  partials?: readonly string[];
}

export interface PreparedProfileShare {
  readonly manifest: LiteratureNoteTemplateManifest;
  /** Every partial the bundle can carry, sorted by name. */
  readonly partials: readonly string[];
  /**
   * The partials the textual dependency scan reaches from this Profile, which
   * the checklist opens with. The scan reads a quoted name wherever it stands,
   * a prose mention included, so it recommends and the reader decides.
   */
  readonly reachable: readonly string[];
  /**
   * Names the Profile calls that no document in the vault answers, so the
   * sheet says which calls travel unresolved rather than refusing to open.
   */
  readonly missing: readonly string[];
  readonly filename: string;
  render(options: ProfileShareOptions): string;
}

export type PreparedProfileImport = {
  manifest: LiteratureNoteTemplateManifest;
  profile: ResolvedProfile;
  source: string;
  path: string;
  /**
   * What every partial the manifest carries does to the template folder: a new
   * file, identical text left alone, or a document holding other text, which
   * the reader answers by naming it in `import`'s `replacePartials`.
   */
  partials: readonly LiteratureNotePartialUnpack[];
  /** Render the Profile with the same partial choice the import will apply. */
  previewSource(options?: {
    /** The conflicting partials the reader chose to replace. */
    replacePartials?: readonly string[];
  }): string;
  /** The match choice can change while the target snapshot stays fixed. */
  import(options?: {
    includeMatch?: ProfileImportOptions["includeMatch"];
    /** The conflicting partials the reader chose to replace. */
    replacePartials?: readonly string[];
  }): Promise<LiteratureNoteProfile>;
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

/** The document a write expects to find: none at all, or one exact revision. */
export type ProfileDocumentExpectation =
  | { readonly state: "absent" }
  | { readonly state: "revision"; readonly revision: string };

/** What a write did: the new revision, or the reason the file was left alone. */
export type ProfileDocumentWrite =
  | { readonly state: "saved"; readonly revision: string }
  | {
      readonly state: "refused";
      readonly reason: "revision-conflict" | "document-exists";
      /** The revision the vault holds now; absent when it holds no document. */
      readonly currentRevision?: string;
    };

/** Carries the source a write found where it expected the one it loaded. */
class ProfileDocumentConflict extends Error {
  readonly current: string;

  constructor(current: string) {
    super("The Profile document changed since it was read.");
    this.name = "ProfileDocumentConflict";
    this.current = current;
  }
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
}

export interface ProfileDeletionResult {
  literatureNotes: number;
  importedNotes: number;
  movedFiles: number;
}

interface ProfileEngineDeps {
  readText(file: TFile): Promise<string>;
  /** Creates each Profile document; a taken path fails as `FileExists`. */
  vault: Pick<Vault["Service"], "create">;
  /** Moves a note on Profile delete; a taken path fails as `FileExists`. */
  fileManager: Pick<FileManager["Service"], "renameFile">;
  /** Runs an Effect on the layer's context; a failure rejects with its error. */
  runPromise<A, E>(effect: Effect.Effect<A, E>): Promise<A>;
  changed(): void;
  log(message: string, fields: Record<string, unknown>): void;
  app: App;
  settings: { readonly current: Readonly<Settings> };
  template: Pick<
    TemplateOperations,
    | "exportLiteratureNotePackSource"
    | "getPartialEntries"
    | "planPartialUnpack"
    | "unpackPartials"
    | "getLiteratureNoteTemplateStatuses"
    | "waitUntilSettled"
  > & { readonly status: TemplateStatus };
  noteIndex: {
    whenIndexed(): Promise<void>;
    getNotesByProfile(selector: ProfileSelector): {
      literatureNotes: TFile[];
      importedNotes: TFile[];
    };
  };
}

export type ProfileReader = Pick<
  ProfileOperations,
  "loaded" | "profiles" | "resolveProfile" | "profileOf"
> & { readonly changed: Stream.Stream<void> };

class ProfileEngine {
  readonly #mutate = new PQueue({ concurrency: 1 });
  readonly #deps: ProfileEngineDeps;
  #profiles: LiteratureNoteProfile[] = [];
  #diagnostics: ProfileDiagnostic[] = [];
  #defaultDocument: string | undefined;
  #defaultExcluded = false;
  #loaded = false;
  #scannedTemplateStatus: TemplateStatus | undefined;

  constructor(deps: ProfileEngineDeps) {
    this.#deps = deps;
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
    return this.documentPathIn(
      this.#deps.settings.current?.["template.folder"] ?? "templates",
    );
  }
  documentPathIn(folder: string): string {
    return join(folder, this.#defaultDocument ?? DEFAULT_PROFILE_DOCUMENT);
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
    let constraint: PreparedProfileCreation["constraint"];
    try {
      this.#validateLabel(requestedLabel);
    } catch (error) {
      constraint = {
        kind: "invalid-name",
        message: Error.isError(error)
          ? error.message
          : m.settings_profile_name_invalid(),
      };
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
      match: compileProfileMatch(look.manifest.match),
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
    this.#deps.log("Prepared Profile creation", { id, label, inherited });
    return {
      profile,
      source: content,
      inherited,
      constraint,
      create: () =>
        this.#mutate.add(() => {
          if (constraint) throw new Error(constraint.message);
          return this.#persist(label, id, content);
        }),
    };
  }

  async create(options: ProfileCreateOptions): Promise<LiteratureNoteProfile> {
    return (await this.prepareCreate(options)).create();
  }

  /** Read the effective look without ejecting the built-in Default document. */
  async getSource(selector: ProfileSelector): Promise<string> {
    const profile = this.resolveProfile(selector);
    if (!profile)
      throw new Error(
        m.settings_profile_source_unavailable({ profile: selector }),
      );
    if (profile.document) {
      const file = this.#deps.app.vault.getFileByPath(
        this.#documentPath(profile),
      );
      if (!file)
        throw new Error(
          m.settings_profile_source_missing({ document: profile.document }),
        );
      return this.#deps.readText(file);
    }
    return this.getBuiltInSource();
  }

  /**
   * Write `source` as this Profile's document, byte for byte, when its live
   * text still has the revision the caller read. A built-in Default whose
   * document is still absent is created here — the eject — and the scan that
   * follows the write is awaited, so a caller that gets `saved` sees the
   * registry that carries it. The one exception is an editor of the document
   * whose own save is in progress: it writes `source` right after that save,
   * and the registry follows once that write is scanned.
   *
   * @param expected The document the caller edited: `absent` for a Default that
   *   had none, otherwise the revision it loaded.
   */
  async saveSource(
    selector: ProfileSelector,
    source: string,
    expected: ProfileDocumentExpectation,
  ): Promise<ProfileDocumentWrite> {
    return this.#mutate.add(async () => {
      await this.#settle();
      const profile = this.resolveProfile(selector);
      if (!profile)
        throw new Error(
          m.settings_profile_source_unavailable({ profile: selector }),
        );
      const write = await this.#writeDocument(
        this.#documentPath(profile),
        source,
        expected,
      );
      if (write.state === "saved") {
        await this.#settle();
        this.#deps.log("Saved a Profile document", { selector });
      }
      return write;
    });
  }

  /** The vault path a Profile's document has, or would have once ejected. */
  #documentPath(profile: ResolvedProfile): string {
    return profile.document
      ? join(this.#deps.settings.current!["template.folder"], profile.document)
      : this.defaultDocumentPath;
  }

  /**
   * The compare-and-write itself. The comparison runs inside the vault's own
   * read-modify-write, so a document that changed between the two is refused
   * rather than replaced, and every refusal leaves the file untouched.
   */
  async #writeDocument(
    path: string,
    source: string,
    expected: ProfileDocumentExpectation,
  ): Promise<ProfileDocumentWrite> {
    const file = this.#deps.app.vault.getFileByPath(path);
    if (!file) {
      // The document the caller edited is gone; only a Default that never had
      // one is created here.
      if (expected.state === "revision")
        return { state: "refused", reason: "revision-conflict" };
      await ensureParentFolder(this.#deps.app, path);
      const created = await this.#create(path, source);
      if (!created) return await this.#documentExists(path);
      return { state: "saved", revision: profileRevision(source) };
    }
    if (expected.state === "absent") return await this.#documentExists(path);
    try {
      await processLiveText(this.#deps.app, file, (current) => {
        if (profileRevision(current) !== expected.revision)
          throw new ProfileDocumentConflict(current);
        return source;
      });
    } catch (error) {
      if (!(error instanceof ProfileDocumentConflict)) throw error;
      return {
        state: "refused",
        reason: "revision-conflict",
        currentRevision: profileRevision(error.current),
      };
    }
    return { state: "saved", revision: profileRevision(source) };
  }

  /** Create `path` with `data`; false when the vault already holds the path. */
  async #create(path: string, data: string): Promise<boolean> {
    return await this.#deps.runPromise(
      this.#deps.vault.create(path, data).pipe(
        Effect.as(true),
        Effect.catchTag("FileExists", () => Effect.succeed(false)),
      ),
    );
  }

  /** The refusal a document standing where the caller expected none earns. */
  async #documentExists(path: string): Promise<ProfileDocumentWrite> {
    const file = this.#deps.app.vault.getFileByPath(path);
    return {
      state: "refused",
      reason: "document-exists",
      ...(file
        ? {
            currentRevision: profileRevision(await this.#deps.readText(file)),
          }
        : {}),
    };
  }

  async setMatch(id: ProfileId, match: MatchTree | undefined): Promise<void> {
    return this.#mutate.add(async () => {
      await this.#settle();
      const profile = this.#profiles.find((entry) => entry.id === id);
      if (!profile) throw new Error(m.profile_import_changed());
      const file = this.#deps.app.vault.getFileByPath(profile.path);
      if (!file) throw new Error(m.profile_import_changed());
      await processLiveText(this.#deps.app, file, (source) => {
        if (parseLiteratureNoteTemplate(source).manifest.id !== id)
          throw new Error(m.profile_import_changed());
        return updateLiteratureNoteTemplateMatch(source, match);
      });
      await this.#settle();
      this.#deps.log("Updated Profile match", {
        id,
        removed: match === undefined,
      });
    });
  }

  /**
   * The built-in Default look as a Profile document: the embedded templates
   * with the Managed Frontmatter the settings tab configured, so an eject or a
   * duplicate carries the user's properties instead of the shipped defaults.
   */
  getBuiltInSource(): string {
    return synthesizeLegacyLiteratureNoteTemplate(
      {
        note: { source: DEFAULT_TEMPLATES.note, language: "liquid" },
        content: { source: DEFAULT_TEMPLATES.content, language: "liquid" },
        filename: { source: DEFAULT_TEMPLATES.filename, language: "liquid" },
      },
      {
        id: DEFAULT_PROFILE,
        name: m.settings_profile_default_name(),
        managed: false,
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
    return this.#mutate.add(async () => {
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
    // A call the vault answers with no document is what story 43 leaves behind
    // after a rename, and what a quoted name in prose looks like. Neither can
    // block the sheet: the name simply is not among the ones offered.
    const missingPartials = new Set<string>();
    const source = await this.#deps.template.exportLiteratureNotePackSource(
      updateProfilePackMetadata(await this.getSource(selector), {
        id,
        name: label,
        ...bindings,
      }),
      {
        includeFolders: true,
        onMissingPartial: (name) => missingPartials.add(name),
      },
    );
    const facade = new TemplateFacade();
    const { manifest } = facade.parseLiteratureNoteTemplate(source);
    const bundled = manifest.partials ?? [];
    // The document's own copy of a name stands ahead of the vault's, the way
    // the export itself resolves the two.
    const entries = new Map(
      [...this.#deps.template.getPartialEntries(), ...bundled].map(
        (partial) => [partial.name, partial] as const,
      ),
    );
    // A reserved name travels for a host that has no template folder to read:
    // the web Workbench renders an annotation's citation through the bundled
    // `citation` (ADR 0055). It belongs to that document rather than to the
    // partials the reader picks among, and an import drops it again — the
    // recipient's own Citation Template answers that name.
    const offered = (names: Iterable<string>) =>
      [...names]
        .filter((name) => !RESERVED_PARTIAL_NAMES.has(name))
        .sort((left, right) => left.localeCompare(right));
    const partials = offered(entries.keys());
    const reachable = offered(bundled.map(({ name }) => name));
    const carried = bundled.filter(({ name }) =>
      RESERVED_PARTIAL_NAMES.has(name),
    );
    const missing = offered(missingPartials);
    this.#deps.log("Prepared Profile sharing", {
      selector,
      id,
      partials,
      reachable,
      missing,
    });
    return {
      manifest,
      partials,
      reachable,
      missing,
      filename: `zotlit-profile.${profileSlug(label)}${selector === DEFAULT_PROFILE ? `-${id}` : ""}.md`,
      render: (options) => {
        const version = options.version.trim();
        if (!version) throw new Error(m.profile_share_version_required());
        const checked = [
          ...carried,
          ...(options.partials ?? reachable).flatMap((name) => {
            const entry = entries.get(name);
            return entry ? [entry] : [];
          }),
        ].sort((left, right) => left.name.localeCompare(right.name));
        return updateProfilePackMetadata(
          source,
          {
            version,
            author: options.author.trim() || undefined,
            description: options.description.trim() || undefined,
            ...(!options.includeFolders
              ? { folder: undefined, importFolder: undefined }
              : {}),
            partials: checked.length > 0 ? checked : undefined,
          },
          { includeMatch: options.includeMatch },
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
    if (!(await this.#create(path, content))) {
      path = join(folder, `zotlit-profile.${profileSlug(label)}-${id}.md`);
      await this.#deps.runPromise(this.#deps.vault.create(path, content));
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
    const includeMatch = options.includeMatch !== false;
    const metadata = {
      ...(options.stripFolders
        ? { folder: undefined, importFolder: undefined }
        : {}),
      ...(options.folder !== undefined
        ? { folder: options.folder ?? undefined }
        : {}),
      ...(options.inheritCitationStyle
        ? { citationStyle: undefined }
        : options.citationStyle !== undefined
          ? { citationStyle: options.citationStyle }
          : {}),
    };
    const render = (include: boolean) =>
      updateProfilePackMetadata(source, metadata, { includeMatch: include });
    const content = render(includeMatch);
    const { manifest } = new TemplateFacade().parseLiteratureNoteTemplate(
      content,
    );
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
      match: compileProfileMatch(manifest.match),
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
    // The manifest's partials are a transport: import unpacks each into the
    // Shared Partial file it belongs in, then drops the entry it came from.
    const partials = this.#deps.template.planPartialUnpack(
      manifest.partials ?? [],
    );
    this.#deps.log("Prepared Profile import", {
      id,
      path,
      kind: decision.kind,
      partials: partials.map(({ name, verdict }) => `${name}:${verdict}`),
    });
    return {
      ...decision,
      manifest,
      source: content,
      path,
      partials,
      profile: bindProfile(this.#deps.settings.current!, {
        selector: id,
        document,
        entry,
      }),
      previewSource: ({ replacePartials = [] } = {}) => {
        const replace = new Set(replacePartials);
        return withoutBundledPartials(
          content,
          partials.flatMap(({ name, verdict }) =>
            verdict === "unchanged" ||
            (verdict === "conflict" && !replace.has(name))
              ? [name]
              : [],
          ),
        );
      },
      import: ({
        includeMatch: approvedMatch = includeMatch,
        replacePartials,
      } = {}) =>
        this.#mutate.add(async () => {
          await this.#settle();
          const current = this.#importTarget(id);
          if (current?.path !== held?.path)
            throw new Error(m.profile_import_changed());
          const { dropped } = await this.#deps.template.unpackPartials(
            partials,
            { replace: replacePartials },
          );
          const importedContent = withoutBundledPartials(
            approvedMatch === includeMatch ? content : render(approvedMatch),
            dropped,
          );
          if (held) {
            const file = this.#deps.app.vault.getFileByPath(path);
            if (!file) throw new Error(m.profile_import_changed());
            await processLiveText(this.#deps.app, file, (currentSource) => {
              if (currentSource !== heldSource)
                throw new Error(m.profile_import_changed());
              return importedContent;
            });
          } else {
            await ensureParentFolder(this.#deps.app, path);
            await this.#deps.runPromise(
              this.#deps.vault
                .create(path, importedContent)
                .pipe(
                  Effect.catchTag("FileExists", (error) =>
                    Effect.fail(
                      new Error(m.profile_import_changed(), { cause: error }),
                    ),
                  ),
                ),
            );
          }
          await this.#settle();
          const imported = this.#profiles.find((profile) => profile.id === id);
          if (!imported) throw new Error(m.profile_import_excluded());
          this.#deps.log("Imported Profile document", {
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
    return (await this.materializeDefault()).file;
  }

  /** Atomically create Default or open the current document without changing it. */
  async materializeDefault(): Promise<{ file: TFile; created: boolean }> {
    const path = this.defaultDocumentPath;
    await ensureParentFolder(this.#deps.app, path);
    const { file, created } = await this.#deps.runPromise(
      this.#deps.vault.create(path, this.getBuiltInSource()).pipe(
        Effect.map((file) => ({ file, created: true })),
        Effect.catchTag("FileExists", (error) => {
          // A folder at the path is no document to open.
          const existing = this.#deps.app.vault.getFileByPath(path);
          return existing
            ? Effect.succeed({ file: existing, created: false })
            : Effect.fail(error);
        }),
      ),
    );
    await this.#settle();
    return { file, created };
  }

  async restoreDefault(): Promise<void> {
    const path = this.defaultDocumentPath;
    const file = this.#deps.app.vault.getFileByPath(path);
    if (file) await this.#deps.app.fileManager.trashFile(file);
    await this.#settle();
  }

  async prepareDelete(id: ProfileId): Promise<ProfileDeletionPlan> {
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
    const current = this.resolveProfile(id);
    const targets = selectors.flatMap((selector) => {
      const profile = this.resolveProfile(selector);
      if (!profile) return [];
      const files = [
        ...literatureNotes.map((file) => ({
          file,
          path: relocatedNotePath(file, {
            from: current,
            to: profile,
            imported: false,
          }),
        })),
        ...importedNotes.map((file) => ({
          file,
          path: relocatedNotePath(file, {
            from: current,
            to: profile,
            imported: true,
          }),
        })),
      ];
      return [{ profile, files }];
    });
    this.#deps.log("Prepared Profile deletion", {
      id,
      literatureNotes: literatureNotes.length,
      importedNotes: importedNotes.length,
    });
    return { source, literatureNotes, importedNotes, targets };
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
        await this.#deps.runPromise(
          this.#deps.fileManager.renameFile(file, path),
        );
        movedFiles++;
      }
      await processLiveFrontMatter(app, file, (frontmatter) => {
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
    this.#deps.log("Deleted Profile after moving its notes", {
      id,
      target,
      ...result,
    });
    return result;
  }

  async #settle(): Promise<void> {
    if ((await this.#deps.template.waitUntilSettled(5000)) !== "settled")
      throw new Error("Profile documents did not finish scanning");
    this.scan();
  }

  scan(): void {
    const templateStatus = this.#deps.template.status;
    // Template publishes a new snapshot when its inputs change, including
    // template bodies and partials that the Profile manifest does not carry.
    if (templateStatus === this.#scannedTemplateStatus) return;
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
              : PROFILE_ID_RULE,
        });
        this.#deps.log("Excluded invalid Profile document {path}", {
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
        this.#deps.log("Excluded duplicate Profile ID {id} in {paths}", {
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
      this.#profiles.push(
        seedProfileEntry(status.validation.manifest, {
          document: status.reference,
          path: status.path,
        }),
      );
    }
    this.#deps.log(
      "Profile scan completed with {profiles} Profiles and {diagnostics} diagnostics",
      {
        profiles: this.#profiles.length,
        diagnostics: this.#diagnostics.length,
        defaultDocument: this.#defaultDocument,
        defaultExcluded: this.#defaultExcluded,
      },
    );
    this.#loaded = true;
    this.#scannedTemplateStatus = templateStatus;
    this.#deps.changed();
  }
}

/**
 * Resolve a draft from its manifest and current Default settings, without
 * installing it. `selector` is the draft's identity after it passed the Profile
 * ID rule, so a caller that refuses an invalid identity states the rule itself.
 * The seeded entry carries that same identity, so the Profile a draft is bound
 * as and the Profile it resolves against are one value.
 */
export function bindDraftProfile(
  settings: Readonly<Settings>,
  selector: ProfileSelector,
  manifest: LiteratureNoteTemplateManifest,
): ResolvedProfile {
  return selector === DEFAULT_PROFILE
    ? bindProfile(settings, { selector: DEFAULT_PROFILE })
    : bindProfile(settings, {
        selector,
        entry: {
          ...seedProfileEntry(manifest, { document: "", path: "" }),
          id: selector,
        },
      });
}

/**
 * Bind a draft on the identity its manifest carries, whatever that text is. The
 * Note Preview reads a Profile document the author is still editing, where an
 * identity that fails the Profile ID rule is diagnosed in place and blocks
 * nothing, so the preview still renders with the draft's own bindings.
 *
 * @see docs/adr/0058-the-workbench-check-refuses-an-invalid-document-identity.md
 */
export function bindUnvalidatedDraftProfile(
  settings: Readonly<Settings>,
  manifest: LiteratureNoteTemplateManifest,
): ResolvedProfile {
  return bindDraftProfile(settings, manifest.id as ProfileSelector, manifest);
}

/**
 * The entry derives only from the manifest, so the same manifest always yields
 * the same entry — whether it comes from a saved Profile document or from a
 * draft the user is still editing.
 *
 * @see docs/adr/0031-a-literature-note-profile-is-its-document.md
 */
export function seedProfileEntry(
  manifest: LiteratureNoteTemplateManifest,
  options: {
    document: string;
    path: string;
  },
): LiteratureNoteProfile {
  const match = compileProfileMatch(manifest.match);
  if (match.state === "unevaluable")
    Effect.runSync(
      Effect.logDebug("Profile match cannot be evaluated").pipe(
        Effect.annotateLogs({ id: manifest.id, problem: match.problem }),
        withLogCategory("profile"),
      ),
    );
  return {
    id: manifest.id as ProfileId,
    label: manifest.name,
    match,
    document: options.document,
    path: options.path,
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
            "note.import-colored-highlights": manifest.importColoredHighlights,
          }),
      ...(manifest.importAnnotationsAsTemplate === undefined
        ? {}
        : {
            "note.import-annotations-as-template":
              manifest.importAnnotationsAsTemplate,
          }),
    },
  };
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

/**
 * The document without the transport entries `dropped` names: each of those
 * partials answers from a document of its own now — the one unpacked from the
 * bundle, or the reader's own that the unpack left standing — so the manifest
 * copy has no reader left. An entry no Shared Partial file can carry stays,
 * and the Template Workbench reports it as a bundled partial.
 */
function withoutBundledPartials(
  source: string,
  dropped: readonly string[],
): string {
  if (dropped.length === 0) return source;
  const { manifest } = new TemplateFacade().parseLiteratureNoteTemplate(source);
  const kept = (manifest.partials ?? []).filter(
    ({ name }) => !dropped.includes(name),
  );
  return updateProfilePackMetadata(source, {
    partials: kept.length > 0 ? kept : undefined,
  });
}

function updateProfilePackMetadata(
  source: string,
  changes: Parameters<typeof updateLiteratureNotePackMetadata>[1],
  options: Parameters<typeof updateLiteratureNotePackMetadata>[2] = {},
): string {
  try {
    return updateLiteratureNotePackMetadata(source, changes, options);
  } catch (error) {
    if (
      error instanceof LiteratureNotePackError &&
      error.code === "match-changed"
    )
      throw new Error(m.profile_match_metadata_changed(), { cause: error });
    throw error;
  }
}

/** The original values and Promise surface, implemented by the plain adapter. */
export type ProfileOperations = Pick<
  ProfileEngine,
  | "loaded"
  | "profiles"
  | "diagnostics"
  | "defaultDocumentPath"
  | "resolveProfile"
  | "profileOf"
  | "getBuiltInSource"
  | "prepareCreate"
  | "create"
  | "getSource"
  | "saveSource"
  | "setMatch"
  | "duplicate"
  | "prepareShare"
  | "prepareImport"
  | "ejectDefault"
  | "materializeDefault"
  | "restoreDefault"
  | "prepareDelete"
  | "delete"
>;

export class ProfileOperationError extends Schema.TaggedError<ProfileOperationError>()(
  "ProfileOperationError",
  { message: Schema.String, cause: Schema.Defect() },
) {}

export interface ProfileState {
  readonly loaded: boolean;
  readonly profiles: readonly LiteratureNoteProfile[];
  readonly diagnostics: readonly ProfileDiagnostic[];
  readonly defaultDocumentPath: string;
  readonly templateStatus: import("@/services/template/service").TemplateStatus;
  readonly failure?: Cause.Cause<ProfileOperationError>;
}

type EffectOperations<T> = {
  [K in keyof T]: T[K] extends (...args: infer P) => infer A
    ? (...args: P) => Effect.Effect<Awaited<A>, ProfileOperationError>
    : Effect.Effect<T[K]>;
};

export type ProfileCreation = Omit<PreparedProfileCreation, "create"> & {
  create(): Effect.Effect<LiteratureNoteProfile, ProfileOperationError>;
};
export type ProfileImport = PreparedProfileImport extends infer P
  ? P extends PreparedProfileImport
    ? Omit<P, "import" | "previewSource"> & {
        import(
          options?: Parameters<P["import"]>[0],
        ): Effect.Effect<LiteratureNoteProfile, ProfileOperationError>;
        previewSource(
          options?: Parameters<P["previewSource"]>[0],
        ): Effect.Effect<string, ProfileOperationError>;
      }
    : never
  : never;
export type ProfileShare = Omit<PreparedProfileShare, "render"> & {
  render(
    options: ProfileShareOptions,
  ): Effect.Effect<string, ProfileOperationError>;
};

export class Profile extends Context.Service<
  Profile,
  Omit<
    EffectOperations<ProfileOperations>,
    "prepareCreate" | "prepareImport" | "prepareShare"
  > & {
    readonly state: Effect.Effect<ProfileState>;
    readonly changes: Stream.Stream<ProfileState>;
    prepareCreate(
      options: ProfileCreateOptions,
    ): Effect.Effect<ProfileCreation, ProfileOperationError>;
    prepareImport(
      source: string,
      options?: ProfileImportOptions,
    ): Effect.Effect<ProfileImport, ProfileOperationError>;
    prepareShare(
      selector: ProfileSelector,
    ): Effect.Effect<ProfileShare, ProfileOperationError>;
  }
>()("zotlit/profile/Profile") {}

const operationError = (cause: unknown) =>
  cause instanceof ProfileOperationError
    ? cause
    : new ProfileOperationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      });
const attempt = <A>(read: () => A) =>
  Effect.try({ try: read, catch: operationError });
const attemptPromise = <A>(read: () => Promise<A>) =>
  Effect.tryPromise({ try: read, catch: operationError });

export const layerProfile = Layer.effect(
  Profile,
  Effect.gen(function* () {
    const app = yield* ObsidianApp;
    const vault = yield* Vault;
    const fileManager = yield* FileManager;
    const settings = yield* PluginSettings;
    const template = yield* Template;
    const noteIndex = yield* NoteIndex;
    const context = yield* Effect.context<never>();
    const runSync = Effect.runSyncWith(context);
    const read = <A, E>(effect: Effect.Effect<A, E>): A => {
      const exit = runSync(Effect.exit(effect));
      if (Exit.isFailure(exit))
        throw plainTemplateError(Cause.squash(exit.cause));
      return exit.value;
    };
    const runPromiseExit = Effect.runPromiseExitWith(context);
    const runPromise = async <A, E>(
      effect: Effect.Effect<A, E>,
    ): Promise<A> => {
      const exit = await runPromiseExit(effect);
      if (Exit.isFailure(exit))
        throw plainTemplateError(Cause.squash(exit.cause));
      return exit.value;
    };
    const stopped = yield* Deferred.make<void>();
    let released = false;
    // Reads before a mutation can wait on another layer or the host. Cancel
    // those waits on close so they cannot hold a protected write open forever.
    // Calls after release keep the legacy service's callable read surface.
    const preflight = <A, E>(effect: Effect.Effect<A, E>) =>
      runPromise(
        released
          ? effect
          : Effect.raceFirst(
              effect,
              Deferred.await(stopped).pipe(
                Effect.andThen(
                  Effect.fail(
                    operationError(
                      new Error("Profile service has been released"),
                    ),
                  ),
                ),
              ),
            ),
      );
    const engine = new ProfileEngine({
      app,
      vault,
      fileManager,
      runPromise: Effect.runPromiseWith(context),
      readText: (file) =>
        preflight(attemptPromise(() => readLiveText(app, file))),
      changed: () =>
        runSync(SubscriptionRef.set(state, snapshot(runSync(template.status)))),
      settings: {
        get current() {
          return runSync(settings.current);
        },
      },
      template: {
        get status() {
          return runSync(template.status);
        },
        exportLiteratureNotePackSource: (...args) =>
          runPromise(template.exportLiteratureNotePackSource(...args)),
        getPartialEntries: () => read(template.getPartialEntries()),
        planPartialUnpack: (...args) =>
          read(template.planPartialUnpack(...args)),
        unpackPartials: (...args) =>
          runPromise(template.unpackPartials(...args)),
        getLiteratureNoteTemplateStatuses: () =>
          read(template.getLiteratureNoteTemplateStatuses()),
        waitUntilSettled: (...args) =>
          runPromise(template.waitUntilSettled(...args)),
      },
      noteIndex: {
        whenIndexed: () => preflight(noteIndex.whenIndexed()),
        getNotesByProfile: (selector) =>
          runSync(noteIndex.getNotesByProfile(selector)),
      },
      log: (message, fields) =>
        runSync(
          Effect.logDebug(message).pipe(
            Effect.annotateLogs(fields),
            withLogCategory("profile"),
          ),
        ),
    });
    const snapshot = (
      templateStatus: ProfileState["templateStatus"],
      failure?: ProfileState["failure"],
    ): ProfileState => ({
      loaded: engine.loaded,
      profiles: engine.profiles,
      diagnostics: engine.diagnostics,
      defaultDocumentPath: engine.defaultDocumentPath,
      templateStatus,
      ...(failure ? { failure } : {}),
    });
    const state = yield* SubscriptionRef.make(snapshot(yield* template.status));
    const scan = Effect.fn("Profile.scan")(
      function* () {
        yield* attempt(() => engine.scan());
      },
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.gen(function* () {
              yield* SubscriptionRef.set(
                state,
                snapshot(yield* template.status, cause),
              );
              yield* Effect.logWarning("Profile scan failed", cause);
            }),
      ),
    );
    // Legacy ready covered this registry scan only. Template's own layer owns
    // its first read; NoteIndex's layout-ready indexing is not part of this barrier.
    yield* scan();
    // Legacy ready kept its initial failure for the service's whole lifetime.
    const startupFailure = (yield* SubscriptionRef.get(state)).failure;
    yield* Stream.runForEach(template.changes, () => scan()).pipe(
      Effect.forkScoped({ startImmediately: true }),
    );
    yield* Stream.runForEach(settings.changes, (saved) =>
      SubscriptionRef.update(state, (previous) => ({
        ...previous,
        defaultDocumentPath: engine.documentPathIn(saved["template.folder"]),
      })),
    ).pipe(Effect.forkScoped({ startImmediately: true }));
    // Operations close before dependency subscriptions. A write already started
    // completes its vault work and registry scan before the layer releases them.
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        released = true;
      }),
    );
    const operations = yield* Scope.fork(yield* Scope.Scope);
    let closed = false;
    const owned = <A>(
      effect: Effect.Effect<A, ProfileOperationError>,
      write = false,
    ) =>
      startupFailure
        ? Effect.failCause(startupFailure)
        : closed
          ? effect
          : Effect.forkIn(effect, operations, {
              startImmediately: true,
              uninterruptible: write,
            }).pipe(Effect.flatMap(Fiber.join));
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        closed = true;
        yield* Deferred.succeed(stopped, undefined);
        yield* PubSub.shutdown(state.pubsub);
      }),
    );
    return Profile.of({
      state: SubscriptionRef.get(state),
      changes: SubscriptionRef.changes(state),
      loaded: Effect.sync(() => engine.loaded),
      profiles: Effect.sync(() => engine.profiles),
      diagnostics: Effect.sync(() => engine.diagnostics),
      defaultDocumentPath: Effect.sync(() => engine.defaultDocumentPath),
      resolveProfile: Effect.fn("Profile.resolveProfile")(function* (
        ...args: Parameters<ProfileOperations["resolveProfile"]>
      ) {
        return yield* attempt(() => engine.resolveProfile(...args));
      }),
      profileOf: Effect.fn("Profile.profileOf")(function* (
        ...args: Parameters<ProfileOperations["profileOf"]>
      ) {
        return yield* attempt(() => engine.profileOf(...args));
      }),
      getBuiltInSource: Effect.fn("Profile.getBuiltInSource")(function* (
        ...args: Parameters<ProfileOperations["getBuiltInSource"]>
      ) {
        return yield* attempt(() => engine.getBuiltInSource(...args));
      }),
      create: Effect.fn("Profile.create")(function* (
        ...args: Parameters<ProfileOperations["create"]>
      ) {
        return yield* owned(
          attemptPromise(() => engine.create(...args)),
          true,
        );
      }),
      getSource: Effect.fn("Profile.getSource")(function* (
        ...args: Parameters<ProfileOperations["getSource"]>
      ) {
        return yield* owned(
          attemptPromise(() => engine.getSource(...args)),
          false,
        );
      }),
      saveSource: Effect.fn("Profile.saveSource")(function* (
        ...args: Parameters<ProfileOperations["saveSource"]>
      ) {
        return yield* owned(
          attemptPromise(() => engine.saveSource(...args)),
          true,
        );
      }),
      setMatch: Effect.fn("Profile.setMatch")(function* (
        ...args: Parameters<ProfileOperations["setMatch"]>
      ) {
        return yield* owned(
          attemptPromise(() => engine.setMatch(...args)),
          true,
        );
      }),
      duplicate: Effect.fn("Profile.duplicate")(function* (
        ...args: Parameters<ProfileOperations["duplicate"]>
      ) {
        return yield* owned(
          attemptPromise(() => engine.duplicate(...args)),
          true,
        );
      }),
      ejectDefault: Effect.fn("Profile.ejectDefault")(function* (
        ...args: Parameters<ProfileOperations["ejectDefault"]>
      ) {
        return yield* owned(
          attemptPromise(() => engine.ejectDefault(...args)),
          true,
        );
      }),
      materializeDefault: Effect.fn("Profile.materializeDefault")(function* (
        ...args: Parameters<ProfileOperations["materializeDefault"]>
      ) {
        return yield* owned(
          attemptPromise(() => engine.materializeDefault(...args)),
          true,
        );
      }),
      restoreDefault: Effect.fn("Profile.restoreDefault")(function* (
        ...args: Parameters<ProfileOperations["restoreDefault"]>
      ) {
        return yield* owned(
          attemptPromise(() => engine.restoreDefault(...args)),
          true,
        );
      }),
      prepareDelete: Effect.fn("Profile.prepareDelete")(function* (
        ...args: Parameters<ProfileOperations["prepareDelete"]>
      ) {
        return yield* owned(
          attemptPromise(() => engine.prepareDelete(...args)),
          false,
        );
      }),
      delete: Effect.fn("Profile.delete")(function* (
        ...args: Parameters<ProfileOperations["delete"]>
      ) {
        return yield* owned(
          attemptPromise(() => engine.delete(...args)),
          true,
        );
      }),

      prepareCreate: Effect.fn("Profile.prepareCreate")(function* (options) {
        const plan = yield* owned(
          attemptPromise(() => engine.prepareCreate(options)),
        );
        return {
          ...plan,
          create: Effect.fn("Profile.createPrepared")(function* () {
            return yield* owned(
              attemptPromise(() => plan.create()),
              true,
            );
          }),
        };
      }),
      prepareShare: Effect.fn("Profile.prepareShare")(function* (selector) {
        const plan = yield* owned(
          attemptPromise(() => engine.prepareShare(selector)),
        );
        return {
          ...plan,
          render: Effect.fn("Profile.renderShare")(function* (options) {
            return yield* attempt(() => plan.render(options));
          }),
        };
      }),
      prepareImport: Effect.fn("Profile.prepareImport")(
        function* (source, options) {
          const plan = yield* owned(
            attemptPromise(() => engine.prepareImport(source, options)),
          );
          return {
            ...plan,
            previewSource: Effect.fn("Profile.previewImport")(
              function* (options) {
                return yield* attempt(() => plan.previewSource(options));
              },
            ),
            import: Effect.fn("Profile.importPrepared")(function* (options) {
              return yield* owned(
                attemptPromise(() => plan.import(options)),
                true,
              );
            }),
          };
        },
      ),
    });
  }).pipe(withLogCategory("profile")),
);
