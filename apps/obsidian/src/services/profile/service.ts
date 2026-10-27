// Registry and file operations for Literature Note Profiles.
import {
  Cause,
  Context,
  Effect,
  Fiber,
  Layer,
  PubSub,
  Ref,
  Schema,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import { customAlphabet } from "nanoid";
import { join } from "node:path/posix";
import type { TFile } from "obsidian";
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
import { processLiveText, readLiveText } from "@/lib/effect-live-text";
import type { LiveTextRewriteFailed } from "@/lib/effect-live-text";
import { withLogCategory } from "@/lib/effect-log";
import { isScopeClosed } from "@/lib/effect-scope";
import { normalizeFolderPath } from "@/lib/ensure-folder";
import * as m from "@/lib/i18n/generated/messages";
import { parseFrontMatter, spliceFrontMatter } from "@/lib/live-text";
import { ObsidianApp } from "@/lib/obsidian-app";
import { FileManager } from "@/lib/obsidian-file-manager";
import { Vault } from "@/lib/obsidian-vault";
import { Workspace } from "@/lib/obsidian-workspace";
import { profileRevision } from "@/lib/profile-revision";
import {
  DEFAULT_PROFILE,
  isProfileId,
  PROFILE_ID_LENGTH,
  PROFILE_ID_RULE,
  readProfileStamp,
} from "@/lib/profile-stamp";
import type { ProfileId, ProfileSelector } from "@/lib/profile-stamp";
import type {
  VaultError,
  FileExists,
  VaultFolderBlockedError,
} from "@/lib/vault-errors";
import { ensureVaultParentFolder } from "@/lib/vault-folder";
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
import { Template } from "@/services/template/service";
import type {
  LiteratureNoteTemplateStatus,
  TemplateFailure,
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

export type ProfileReader = Pick<
  ProfileOperations,
  "loaded" | "profiles" | "resolveProfile" | "profileOf"
> & {
  readonly changed: Stream.Stream<void>;
};
const makeProfileEngine = Effect.fnUntraced(function* (
  changed: () => Effect.Effect<void>,
) {
  const app = yield* ObsidianApp;
  const vault = yield* Vault;
  const fileManager = yield* FileManager;
  const settings = yield* PluginSettings;
  const template = yield* Template;
  const noteIndex = yield* NoteIndex;
  const workspace = yield* Workspace;
  const semaphore = yield* Semaphore.make(1);
  const mutate = semaphore.withPermits(1);
  const readText = (file: TFile) =>
    readLiveText(file).pipe(
      Effect.provideService(Vault, vault),
      Effect.provideService(Workspace, workspace),
    );
  const rewrite = (file: TFile, fn: (text: string) => string) =>
    processLiveText(file, fn).pipe(
      Effect.provideService(Vault, vault),
      Effect.provideService(Workspace, workspace),
    );
  const ensureParent = (path: string) =>
    ensureVaultParentFolder(path).pipe(Effect.provideService(Vault, vault));
  const log = (message: string, fields: Record<string, unknown>) =>
    Effect.logDebug(message).pipe(
      Effect.annotateLogs(fields),
      withLogCategory("profile"),
    );
  const registry = yield* Ref.make({
    profiles: [] as LiteratureNoteProfile[],
    diagnostics: [] as ProfileDiagnostic[],
    defaultDocument: undefined as string | undefined,
    defaultExcluded: false,
    loaded: false,
    scannedTemplateStatus: undefined as TemplateStatus | undefined,
  });
  const defaultDocumentPath = Effect.fnUntraced(function* () {
    return yield* documentPathIn((yield* settings.current)["template.folder"]);
  });
  const documentPathIn = Effect.fnUntraced(function* (folder: string) {
    return join(
      folder,
      (yield* Ref.get(registry)).defaultDocument ?? DEFAULT_PROFILE_DOCUMENT,
    );
  });
  const resolveProfile = Effect.fn("Profile.resolveProfile")(function* (
    selector: ProfileSelector,
  ): Effect.fn.Return<ResolvedProfile | undefined, ProfileOperationError> {
    if (!(yield* Ref.get(registry)).loaded)
      return yield* operationError(new Error("ProfileService is not ready"));
    const saved = (yield* settings.current)!;
    if (selector === DEFAULT_PROFILE) {
      return (yield* Ref.get(registry)).defaultExcluded
        ? undefined
        : bindProfile(saved, {
            selector,
            document: (yield* Ref.get(registry)).defaultDocument,
          });
    }
    const entry = (yield* Ref.get(registry)).profiles.find(
      ({ id }) => id === selector,
    );
    return (
      entry && bindProfile(saved, { selector, document: entry.document, entry })
    );
  });
  const profileOf = Effect.fn("Profile.profileOf")(function* (
    file?: TFile,
  ): Effect.fn.Return<NoteProfile, ProfileOperationError> {
    const stamped = file && readProfileStamp(app.metadataCache, file);
    const profile =
      stamped === undefined
        ? yield* resolveProfile(DEFAULT_PROFILE)
        : stamped.id === undefined
          ? undefined
          : yield* resolveProfile(stamped.id);
    return profile
      ? { ok: true, profile }
      : {
          ok: false,
          stamped: stamped ?? { stamp: DEFAULT_PROFILE, id: undefined },
        };
  });
  const prepareCreate = Effect.fn("Profile.prepareCreate")(function* (
    options: ProfileCreateOptions,
  ): Effect.fn.Return<ProfileCreation, ProfileOperationError | VaultError> {
    const requestedLabel = options.label.trim();
    const label = requestedLabel || m.settings_profile_new_name();
    const base = yield* resolveProfile(DEFAULT_PROFILE);
    if (!base)
      return yield* operationError(new Error(m.notice_profile_action_failed()));
    const baseline = yield* getSource(DEFAULT_PROFILE);
    const source =
      options.source ??
      (options.look === undefined || options.look === DEFAULT_PROFILE
        ? baseline
        : yield* getSource(options.look));
    const facade = new TemplateFacade();
    const defaultLook = yield* attempt(() =>
      facade.parseLiteratureNoteTemplate(baseline),
    );
    const look =
      source === baseline
        ? defaultLook
        : yield* attempt(() => facade.parseLiteratureNoteTemplate(source));
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
    const constraint = yield* validateLabel(requestedLabel).pipe(
      Effect.catch((error) =>
        Effect.succeed({
          kind: "invalid-name" as const,
          message: error.message,
        }),
      ),
    );
    const id = mintId() as ProfileId;
    const content = yield* attempt(() =>
      profileSource(source, { id, label, bindings }),
    );
    const folder = (yield* settings.current)!["template.folder"];
    const plainDocument = `zotlit-profile.${profileSlug(label)}.md`;
    const document = (yield* vault.getAbstractFileByPath(
      join(folder, plainDocument),
    ))
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
    const profile = bindProfile((yield* settings.current)!, {
      selector: id,
      document: entry.document,
      entry,
    });
    yield* log("Prepared Profile creation", { id, label, inherited });
    return {
      profile,
      source: content,
      inherited,
      constraint,
      create: () =>
        mutate(
          Effect.gen(function* () {
            if (constraint)
              return yield* operationError(new Error(constraint.message));
            return yield* persist(label, id, content);
          }),
        ),
    };
  });
  const create = Effect.fn("Profile.create")(function* (
    options: ProfileCreateOptions,
  ): Effect.fn.Return<
    LiteratureNoteProfile,
    | ProfileOperationError
    | VaultError
    | FileExists
    | VaultFolderBlockedError
    | TemplateFailure
  > {
    return yield* (yield* prepareCreate(options)).create();
  });
  /** Read the effective look without ejecting the built-in Default document. */
  const getSource = Effect.fn("Profile.getSource")(function* (
    selector: ProfileSelector,
  ): Effect.fn.Return<string, ProfileOperationError | VaultError> {
    const profile = yield* resolveProfile(selector);
    if (!profile)
      return yield* operationError(
        new Error(m.settings_profile_source_unavailable({ profile: selector })),
      );
    if (profile.document) {
      const file = yield* vault.getFileByPath(yield* documentPath(profile));
      if (!file)
        return yield* operationError(
          new Error(
            m.settings_profile_source_missing({ document: profile.document }),
          ),
        );
      return yield* readText(file);
    }
    return yield* getBuiltInSource();
  });
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
  const saveSource = Effect.fn("Profile.saveSource")(function* (
    selector: ProfileSelector,
    source: string,
    expected: ProfileDocumentExpectation,
  ): Effect.fn.Return<
    ProfileDocumentWrite,
    | ProfileOperationError
    | VaultError
    | VaultFolderBlockedError
    | LiveTextRewriteFailed
    | TemplateFailure
  > {
    return yield* mutate(
      Effect.gen(function* () {
        yield* settle();
        const profile = yield* resolveProfile(selector);
        if (!profile)
          return yield* operationError(
            new Error(
              m.settings_profile_source_unavailable({ profile: selector }),
            ),
          );
        return yield* Effect.gen(function* () {
          const write = yield* writeDocument(
            yield* documentPath(profile),
            source,
            expected,
          );
          if (write.state === "saved") {
            yield* settle();
            yield* log("Saved a Profile document", { selector });
          }
          return write;
        }).pipe(Effect.uninterruptible);
      }),
    );
  });
  /** The vault path a Profile's document has, or would have once ejected. */
  const documentPath = Effect.fn("Profile.documentPath")(function* (
    profile: ResolvedProfile,
  ): Effect.fn.Return<string, never> {
    return profile.document
      ? join((yield* settings.current)!["template.folder"], profile.document)
      : yield* defaultDocumentPath();
  });
  /**
   * The compare-and-write itself. The comparison runs inside the vault's own
   * read-modify-write, so a document that changed between the two is refused
   * rather than replaced, and every refusal leaves the file untouched.
   */
  const writeDocument = Effect.fn("Profile.writeDocument")(function* (
    path: string,
    source: string,
    expected: ProfileDocumentExpectation,
  ): Effect.fn.Return<
    ProfileDocumentWrite,
    VaultError | VaultFolderBlockedError | LiveTextRewriteFailed
  > {
    const file = yield* vault.getFileByPath(path);
    if (!file) {
      // The document the caller edited is gone; only a Default that never had
      // one is created here.
      if (expected.state === "revision")
        return { state: "refused", reason: "revision-conflict" };
      yield* ensureParent(path);
      const created = yield* createDocument(path, source);
      if (!created) return yield* documentExists(path);
      return { state: "saved", revision: profileRevision(source) };
    }
    if (expected.state === "absent") return yield* documentExists(path);
    const conflict = yield* rewrite(file, (current) => {
      if (profileRevision(current) !== expected.revision)
        throw new ProfileDocumentConflict(current);
      return source;
    }).pipe(
      Effect.as(undefined as string | undefined),
      Effect.catchTag("LiveTextRewriteFailed", (error) =>
        error.cause instanceof ProfileDocumentConflict
          ? Effect.succeed(error.cause.current)
          : Effect.fail(error),
      ),
    );
    if (conflict !== undefined)
      return {
        state: "refused",
        reason: "revision-conflict",
        currentRevision: profileRevision(conflict),
      };
    return { state: "saved", revision: profileRevision(source) };
  });
  /** Create `path` with `data`; false when the vault already holds the path. */
  const createDocument = Effect.fn("Profile.createDocument")(function* (
    path: string,
    data: string,
  ): Effect.fn.Return<boolean, VaultError> {
    return yield* vault.create(path, data).pipe(
      Effect.as(true),
      Effect.catchTag("FileExists", () => Effect.succeed(false)),
    );
  });
  /** The refusal a document standing where the caller expected none earns. */
  const documentExists = Effect.fn("Profile.documentExists")(function* (
    path: string,
  ): Effect.fn.Return<ProfileDocumentWrite, VaultError> {
    const file = yield* vault.getFileByPath(path);
    return {
      state: "refused",
      reason: "document-exists",
      ...(file
        ? {
            currentRevision: profileRevision(
              yield* readText(file).pipe(Effect.interruptible),
            ),
          }
        : {}),
    };
  });
  const setMatch = Effect.fn("Profile.setMatch")(function* (
    id: ProfileId,
    match: MatchTree | undefined,
  ): Effect.fn.Return<
    void,
    ProfileOperationError | VaultError | TemplateFailure
  > {
    return yield* mutate(
      Effect.gen(function* () {
        yield* settle();
        const profile = (yield* Ref.get(registry)).profiles.find(
          (entry) => entry.id === id,
        );
        if (!profile)
          return yield* operationError(new Error(m.profile_import_changed()));
        const file = yield* vault.getFileByPath(profile.path);
        if (!file)
          return yield* operationError(new Error(m.profile_import_changed()));
        return yield* Effect.gen(function* () {
          yield* rewrite(file, (source) => {
            if (parseLiteratureNoteTemplate(source).manifest.id !== id)
              throw new Error(m.profile_import_changed());
            return updateLiteratureNoteTemplateMatch(source, match);
          }).pipe(
            Effect.catchTag("LiveTextRewriteFailed", (error) =>
              Effect.fail(operationError(error.cause)),
            ),
          );
          yield* settle();
          yield* log("Updated Profile match", {
            id,
            removed: match === undefined,
          });
        }).pipe(Effect.uninterruptible);
      }),
    );
  });
  /**
   * The built-in Default look as a Profile document: the embedded templates
   * with the Managed Frontmatter the settings tab configured, so an eject or a
   * duplicate carries the user's properties instead of the shipped defaults.
   */
  const getBuiltInSource = Effect.fn("Profile.getBuiltInSource")(
    function* (): Effect.fn.Return<string, ProfileOperationError> {
      const fields = (yield* settings.current)["note.frontmatter-fields"];
      return yield* attempt(() =>
        synthesizeLegacyLiteratureNoteTemplate(
          {
            note: { source: DEFAULT_TEMPLATES.note, language: "liquid" },
            content: { source: DEFAULT_TEMPLATES.content, language: "liquid" },
            filename: {
              source: DEFAULT_TEMPLATES.filename,
              language: "liquid",
            },
          },
          {
            id: DEFAULT_PROFILE,
            name: m.settings_profile_default_name(),
            managed: false,
            frontmatter: fields ?? DEFAULT_FRONTMATTER_FIELDS,
          },
        ),
      );
    },
  );
  /** Copy a Profile's document under `label`, or under "<source> copy". */
  const duplicate = Effect.fn("Profile.duplicate")(function* (
    selector: ProfileSelector,
    options: {
      label?: string;
    } = {},
  ): Effect.fn.Return<
    LiteratureNoteProfile,
    | ProfileOperationError
    | VaultError
    | FileExists
    | VaultFolderBlockedError
    | TemplateFailure
  > {
    return yield* mutate(
      Effect.gen(function* () {
        const profile = yield* resolveProfile(selector);
        if (!profile)
          return yield* operationError(
            new Error(`Unknown Profile: ${selector}`),
          );
        const label = profile.label ?? m.settings_profile_default_name();
        const base = options.label ?? m.settings_profile_copy_name({ label });
        let copyLabel = base;
        let number = 2;
        while (
          (yield* Ref.get(registry)).profiles.some(
            (entry) =>
              entry.label.toLocaleLowerCase() === copyLabel.toLocaleLowerCase(),
          )
        )
          copyLabel = `${base} ${number++}`;
        const id = mintId() as ProfileId;
        const source = yield* getSource(selector);
        return yield* persist(
          copyLabel,
          id,
          yield* attempt(() => profileSource(source, { id, label: copyLabel })),
        );
      }),
    );
  });
  /** Freeze one export identity, effective bindings and partials for a Share sheet. */
  const prepareShare = Effect.fn("Profile.prepareShare")(function* (
    selector: ProfileSelector,
  ): Effect.fn.Return<
    ProfileShare,
    ProfileOperationError | VaultError | TemplateFailure
  > {
    yield* settle();
    const profile = yield* resolveProfile(selector);
    if (!profile)
      return yield* operationError(
        new Error(m.settings_profile_source_unavailable({ profile: selector })),
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
    const effectiveSource = yield* getSource(selector);
    const source = yield* template.exportLiteratureNotePackSource(
      yield* attempt(() =>
        updateProfilePackMetadata(effectiveSource, {
          id,
          name: label,
          ...bindings,
        }),
      ),
      {
        includeFolders: true,
        onMissingPartial: (name) => missingPartials.add(name),
      },
    );
    const facade = new TemplateFacade();
    const { manifest } = yield* attempt(() =>
      facade.parseLiteratureNoteTemplate(source),
    );
    const bundled = manifest.partials ?? [];
    // The document's own copy of a name stands ahead of the vault's, the way
    // the export itself resolves the two.
    const entries = new Map(
      [...(yield* template.getPartialEntries), ...bundled].map(
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
    yield* log("Prepared Profile sharing", {
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
      render: (options) =>
        attempt(() => {
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
        }),
    };
  });
  const validateLabel = Effect.fnUntraced(function* (label: string) {
    const slug = profileSlug(label);
    if (
      !slug ||
      slug === DEFAULT_PROFILE ||
      (yield* Ref.get(registry)).profiles.some(
        (profile) =>
          profile.label.toLocaleLowerCase() === label.toLocaleLowerCase(),
      )
    )
      return yield* operationError(
        new Error(m.settings_profile_name_invalid()),
      );
  });
  const persist = Effect.fn("Profile.persist")(
    function* (
      label: string,
      id: ProfileId,
      content: string,
    ): Effect.fn.Return<
      LiteratureNoteProfile,
      | ProfileOperationError
      | VaultError
      | FileExists
      | VaultFolderBlockedError
      | TemplateFailure
    > {
      yield* validateLabel(label);
      const folder = (yield* settings.current)!["template.folder"];
      let path = join(folder, `zotlit-profile.${profileSlug(label)}.md`);
      yield* ensureParent(path);
      if (!(yield* createDocument(path, content))) {
        path = join(folder, `zotlit-profile.${profileSlug(label)}-${id}.md`);
        yield* vault.create(path, content);
      }
      yield* settle();
      const entry = (yield* Ref.get(registry)).profiles.find(
        (profile) => profile.id === id,
      );
      if (!entry)
        return yield* operationError(
          new Error(`Profile document could not be registered: ${path}`),
        );
      return entry;
    },
    (effect) => Effect.uninterruptible(effect),
  );
  const prepareImport = Effect.fn("Profile.prepareImport")(function* (
    source: string,
    options: ProfileImportOptions = {},
  ): Effect.fn.Return<
    ProfileImport,
    ProfileOperationError | VaultError | TemplateFailure
  > {
    yield* settle();
    const parsed = yield* Effect.try({
      try: () => new TemplateFacade().parseLiteratureNoteTemplate(source),
      catch: (cause) =>
        operationError(new Error(m.profile_import_invalid(), { cause })),
    });
    if (parsed.manifest.id === DEFAULT_PROFILE)
      return yield* operationError(new Error(m.profile_import_default()));
    if (!isProfileId(parsed.manifest.id))
      return yield* operationError(new Error(m.settings_profile_id_invalid()));
    const id = parsed.manifest.id;
    const held = yield* importTarget(id);
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
    const content = yield* attempt(() => render(includeMatch));
    const { manifest } = yield* attempt(() =>
      new TemplateFacade().parseLiteratureNoteTemplate(content),
    );
    const folder = (yield* settings.current)!["template.folder"];
    const slug = profileSlug(manifest.name);
    const plain = `zotlit-profile.${slug}.md`;
    const document =
      held?.document ??
      (!slug ||
      slug === DEFAULT_PROFILE ||
      (yield* vault.getAbstractFileByPath(join(folder, plain)))
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
    const heldSource = held ? yield* getSource(id) : undefined;
    let decision:
      | Pick<
          Extract<
            PreparedProfileImport,
            {
              kind: "replace";
            }
          >,
          "kind" | "held"
        >
      | {
          kind: "fresh";
        } = { kind: "fresh" };
    if (held) {
      yield* noteIndex.whenIndexed;
      const notes = yield* noteIndex.getNotesByProfile(id);
      const heldManifest = (yield* attempt(() =>
        new TemplateFacade().parseLiteratureNoteTemplate(heldSource!),
      )).manifest;
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
    const partials = yield* template.planPartialUnpack(manifest.partials ?? []);
    yield* log("Prepared Profile import", {
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
      profile: bindProfile((yield* settings.current)!, {
        selector: id,
        document,
        entry,
      }),
      previewSource: ({ replacePartials = [] } = {}) =>
        attempt(() => {
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
        }),
      import: ({
        includeMatch: approvedMatch = includeMatch,
        replacePartials,
      } = {}) =>
        mutate(
          Effect.gen(function* () {
            yield* settle();
            const current = yield* importTarget(id);
            if (current?.path !== held?.path)
              return yield* operationError(
                new Error(m.profile_import_changed()),
              );
            return yield* Effect.gen(function* () {
              const { dropped } = yield* template.unpackPartials(partials, {
                replace: replacePartials,
              });
              const importedContent = yield* attempt(() =>
                withoutBundledPartials(
                  approvedMatch === includeMatch
                    ? content
                    : render(approvedMatch),
                  dropped,
                ),
              );
              if (held) {
                const file = yield* vault.getFileByPath(path);
                if (!file)
                  return yield* operationError(
                    new Error(m.profile_import_changed()),
                  );
                yield* rewrite(file, (currentSource) => {
                  if (currentSource !== heldSource)
                    throw new Error(m.profile_import_changed());
                  return importedContent;
                }).pipe(
                  Effect.catchTag("LiveTextRewriteFailed", (error) =>
                    Effect.fail(operationError(error.cause)),
                  ),
                );
              } else {
                yield* ensureParent(path);
                yield* vault.create(path, importedContent).pipe(
                  Effect.catchTag("FileExists", (error) =>
                    Effect.fail(
                      new ProfileImportChanged({
                        message: m.profile_import_changed(),
                        cause: error,
                      }),
                    ),
                  ),
                );
              }
              yield* settle();
              const imported = (yield* Ref.get(registry)).profiles.find(
                (profile) => profile.id === id,
              );
              if (!imported)
                return yield* operationError(
                  new Error(m.profile_import_excluded()),
                );
              yield* log("Imported Profile document", {
                id,
                path,
                replaced: !!held,
              });
              return imported;
            }).pipe(Effect.uninterruptible);
          }),
        ),
    };
  });
  const importTarget = Effect.fn("Profile.importTarget")(function* (
    id: ProfileId,
  ): Effect.fn.Return<
    LiteratureNoteProfile | undefined,
    ProfileOperationError | TemplateFailure
  > {
    const matches = (yield* template.getLiteratureNoteTemplateStatuses).filter(
      (status) =>
        status.reference.startsWith("zotlit-profile.") &&
        documentId(status) === id,
    );
    const held = (yield* Ref.get(registry)).profiles.find(
      (profile) => profile.id === id,
    );
    if (matches.length > 1 || (matches.length && !held))
      return yield* operationError(new Error(m.profile_import_excluded()));
    return held;
  });
  const ejectDefault = Effect.fn("Profile.ejectDefault")(
    function* (): Effect.fn.Return<
      TFile,
      | ProfileOperationError
      | VaultError
      | FileExists
      | VaultFolderBlockedError
      | TemplateFailure
    > {
      return (yield* materializeDefault()).file;
    },
  );
  /** Atomically create Default or open the current document without changing it. */
  const materializeDefault = Effect.fn("Profile.materializeDefault")(
    function* (): Effect.fn.Return<
      {
        file: TFile;
        created: boolean;
      },
      | ProfileOperationError
      | VaultError
      | FileExists
      | VaultFolderBlockedError
      | TemplateFailure
    > {
      const path = yield* defaultDocumentPath();
      yield* ensureParent(path);
      const { file, created } = yield* vault
        .create(path, yield* getBuiltInSource())
        .pipe(
          Effect.map((file) => ({ file, created: true })),
          Effect.catchTag(
            "FileExists",
            Effect.fnUntraced(function* (error) {
              // A folder at the path is no document to open.
              const existing = yield* vault.getFileByPath(path);
              return existing
                ? { file: existing, created: false }
                : yield* error;
            }),
          ),
        );
      yield* settle();
      return { file, created };
    },
    (effect) => mutate(Effect.uninterruptible(effect)),
  );
  const restoreDefault = Effect.fn("Profile.restoreDefault")(
    function* (): Effect.fn.Return<
      void,
      ProfileOperationError | VaultError | TemplateFailure
    > {
      const path = yield* defaultDocumentPath();
      const file = yield* vault.getFileByPath(path);
      if (file) yield* fileManager.trashFile(file);
      yield* settle();
    },
    (effect) => mutate(Effect.uninterruptible(effect)),
  );
  const prepareDelete = Effect.fn("Profile.prepareDelete")(function* (
    id: ProfileId,
  ): Effect.fn.Return<ProfileDeletionPlan, ProfileOperationError> {
    const source = (yield* Ref.get(registry)).profiles.find(
      (profile) => profile.id === id,
    );
    if (!source)
      return yield* operationError(new Error("The Profile is unavailable"));
    yield* noteIndex.whenIndexed;
    const { literatureNotes, importedNotes } =
      yield* noteIndex.getNotesByProfile(id);
    const selectors: ProfileSelector[] = [
      DEFAULT_PROFILE,
      ...(yield* Ref.get(registry)).profiles
        .filter((profile) => profile.id !== id)
        .map(({ id }) => id),
    ];
    const current = yield* resolveProfile(id);
    const targets = yield* Effect.forEach(
      selectors,
      Effect.fnUntraced(function* (selector) {
        const profile = yield* resolveProfile(selector);
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
      }),
    ).pipe(Effect.map((entries) => entries.flat()));
    yield* log("Prepared Profile deletion", {
      id,
      literatureNotes: literatureNotes.length,
      importedNotes: importedNotes.length,
    });
    return { source, literatureNotes, importedNotes, targets };
  });
  const deleteProfile = Effect.fn("Profile.delete")(function* (
    id: ProfileId,
    target: ProfileSelector,
    options: {
      move?: boolean;
    } = {},
  ): Effect.fn.Return<
    ProfileDeletionResult,
    | ProfileOperationError
    | VaultError
    | FileExists
    | VaultFolderBlockedError
    | LiveTextRewriteFailed
    | TemplateFailure
  > {
    return yield* mutate(
      Effect.gen(function* () {
        const plan = yield* prepareDelete(id);
        const destination = plan.targets.find(
          ({ profile }) => profile.selector === target,
        );
        if (
          !destination &&
          (plan.literatureNotes.length || plan.importedNotes.length)
        )
          return yield* operationError(
            new Error("Select an available target Profile before deleting"),
          );
        return yield* Effect.gen(function* () {
          let movedFiles = 0;
          const stamp = destination?.profile.stamp;
          for (const { file, path } of destination?.files ?? []) {
            if (options.move && path !== file.path) {
              yield* ensureParent(path);
              yield* fileManager.renameFile(file, path);
              movedFiles++;
            }
            yield* rewrite(file, (text) => {
              const frontmatter = parseFrontMatter(text);
              if (stamp === undefined)
                delete frontmatter[FIELD_LITERATURE_NOTE_PROFILE];
              else frontmatter[FIELD_LITERATURE_NOTE_PROFILE] = stamp;
              return spliceFrontMatter(text, frontmatter);
            });
          }
          const file = yield* vault.getFileByPath(plan.source.path);
          if (file) yield* fileManager.trashFile(file);
          yield* settle();
          const result = {
            literatureNotes: plan.literatureNotes.length,
            importedNotes: plan.importedNotes.length,
            movedFiles,
          };
          yield* log("Deleted Profile after moving its notes", {
            id,
            target,
            ...result,
          });
          return result;
        }).pipe(Effect.uninterruptible);
      }),
    );
  });
  const settle = Effect.fn("Profile.settle")(function* (): Effect.fn.Return<
    void,
    ProfileOperationError | TemplateFailure
  > {
    if ((yield* template.waitUntilSettled(5000)) !== "settled")
      return yield* operationError(
        new Error("Profile documents did not finish scanning"),
      );
    yield* scan();
  });
  const scan = Effect.fn("Profile.scan")(function* (): Effect.fn.Return<
    void,
    TemplateFailure
  > {
    const templateStatus = yield* template.status;
    // Template publishes a new snapshot when its inputs change, including
    // template bodies and partials that the Profile manifest does not carry.
    if (templateStatus === (yield* Ref.get(registry)).scannedTemplateStatus)
      return;
    const profiles: LiteratureNoteProfile[] = [];
    const diagnostics: ProfileDiagnostic[] = [];
    let defaultDocument: string | undefined;
    let defaultExcluded = false;
    const statuses = (yield* template.getLiteratureNoteTemplateStatuses).filter(
      ({ reference }) => reference.startsWith("zotlit-profile."),
    );
    for (const status of statuses) {
      const validation = status.validation;
      const id = documentId(status);
      if (
        validation.state === "invalid" ||
        (id !== DEFAULT_PROFILE && !isProfileId(id!))
      ) {
        diagnostics.push({
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
        yield* log("Excluded invalid Profile document {path}", {
          path: status.path,
          id,
        });
        if (
          id === DEFAULT_PROFILE ||
          status.reference === DEFAULT_PROFILE_DOCUMENT
        ) {
          defaultExcluded = true;
          defaultDocument = status.reference;
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
        yield* log("Excluded duplicate Profile ID {id} in {paths}", {
          id,
          paths,
        });
        for (const { path } of group)
          diagnostics.push({
            code: "duplicate-profile-id",
            path,
            paths,
            message: `Profile ID '${id}' is shared by ${paths.join(", ")}.`,
          });
        if (id === DEFAULT_PROFILE) defaultExcluded = true;
        continue;
      }
      const status = group[0]!;
      if (status.validation.state !== "valid") continue;
      if (id === DEFAULT_PROFILE) {
        defaultDocument = status.reference;
        continue;
      }
      const entry = seedProfileEntry(status.validation.manifest, {
        document: status.reference,
        path: status.path,
      });
      if (entry.match.state === "unevaluable")
        yield* log("Profile match cannot be evaluated", {
          id: entry.id,
          problem: entry.match.problem,
        });
      profiles.push(entry);
    }
    yield* log(
      "Profile scan completed with {profiles} Profiles and {diagnostics} diagnostics",
      {
        profiles: profiles.length,
        diagnostics: diagnostics.length,
        defaultDocument: defaultDocument,
        defaultExcluded: defaultExcluded,
      },
    );
    yield* Ref.set(registry, {
      profiles,
      diagnostics,
      defaultDocument,
      defaultExcluded,
      loaded: true,
      scannedTemplateStatus: templateStatus,
    });
    yield* changed();
  });
  return {
    documentPathIn,
    resolveProfile,
    profileOf,
    prepareCreate,
    getSource,
    saveSource,
    setMatch,
    getBuiltInSource,
    duplicate,
    prepareShare,
    prepareImport,
    ejectDefault,
    materializeDefault,
    restoreDefault,
    prepareDelete,
    delete: deleteProfile,
    scan,
    create,
    defaultDocumentPath,
    loaded: Ref.get(registry).pipe(Effect.map((value) => value.loaded)),
    profiles: Ref.get(registry).pipe(Effect.map((value) => value.profiles)),
    diagnostics: Ref.get(registry).pipe(
      Effect.map((value) => value.diagnostics),
    ),
  };
});
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

/** The Profile values and Promise surface for callers outside Effect. */
export interface ProfileOperations {
  readonly loaded: boolean;
  readonly profiles: readonly LiteratureNoteProfile[];
  readonly diagnostics: readonly ProfileDiagnostic[];
  readonly defaultDocumentPath: string;
  resolveProfile(selector: ProfileSelector): ResolvedProfile | undefined;
  profileOf(file?: TFile): NoteProfile;
  prepareCreate(
    options: ProfileCreateOptions,
  ): Promise<PreparedProfileCreation>;
  create(options: ProfileCreateOptions): Promise<LiteratureNoteProfile>;
  getSource(selector: ProfileSelector): Promise<string>;
  saveSource(
    selector: ProfileSelector,
    source: string,
    expected: ProfileDocumentExpectation,
  ): Promise<ProfileDocumentWrite>;
  setMatch(id: ProfileId, match: MatchTree | undefined): Promise<void>;
  getBuiltInSource(): string;
  duplicate(
    selector: ProfileSelector,
    options?: {
      label?: string;
    },
  ): Promise<LiteratureNoteProfile>;
  prepareShare(selector: ProfileSelector): Promise<PreparedProfileShare>;
  prepareImport(
    source: string,
    options?: ProfileImportOptions,
  ): Promise<PreparedProfileImport>;
  ejectDefault(): Promise<TFile>;
  materializeDefault(): Promise<{
    file: TFile;
    created: boolean;
  }>;
  restoreDefault(): Promise<void>;
  prepareDelete(id: ProfileId): Promise<ProfileDeletionPlan>;
  delete(
    id: ProfileId,
    target: ProfileSelector,
    options?: {
      move?: boolean;
    },
  ): Promise<ProfileDeletionResult>;
}
/**
 * The import target changed after the plan was made: another file took its
 * path. `message` is the notice text; `cause` holds the vault's refusal.
 */
export class ProfileImportChanged extends Schema.TaggedError<
  ProfileImportChanged,
  { readonly brand: unique symbol }
>()("ProfileImportChanged", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export class ProfileOperationError extends Schema.TaggedError<
  ProfileOperationError,
  { readonly brand: unique symbol }
>()("ProfileOperationError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export interface ProfileState {
  readonly loaded: boolean;
  readonly profiles: readonly LiteratureNoteProfile[];
  readonly diagnostics: readonly ProfileDiagnostic[];
  readonly defaultDocumentPath: string;
  readonly templateStatus: import("@/services/template/service").TemplateStatus;
  readonly failure?: Cause.Cause<TemplateFailure>;
}
type ProfileOperationErrors = {
  resolveProfile: ProfileOperationError;
  profileOf: ProfileOperationError;
  getBuiltInSource: ProfileOperationError;
  create:
    | ProfileOperationError
    | VaultError
    | FileExists
    | VaultFolderBlockedError
    | TemplateFailure;
  getSource: ProfileOperationError | VaultError | TemplateFailure;
  saveSource:
    | ProfileOperationError
    | VaultError
    | VaultFolderBlockedError
    | LiveTextRewriteFailed
    | TemplateFailure;
  setMatch: ProfileOperationError | VaultError | TemplateFailure;
  duplicate:
    | ProfileOperationError
    | VaultError
    | FileExists
    | VaultFolderBlockedError
    | TemplateFailure;
  ejectDefault:
    | ProfileOperationError
    | VaultError
    | FileExists
    | VaultFolderBlockedError
    | TemplateFailure;
  materializeDefault:
    | ProfileOperationError
    | VaultError
    | FileExists
    | VaultFolderBlockedError
    | TemplateFailure;
  restoreDefault: ProfileOperationError | VaultError | TemplateFailure;
  prepareDelete: ProfileOperationError | TemplateFailure;
  delete:
    | ProfileOperationError
    | VaultError
    | FileExists
    | VaultFolderBlockedError
    | LiveTextRewriteFailed
    | TemplateFailure;
};
type EffectOperations = {
  [K in keyof ProfileOperations]: ProfileOperations[K] extends (
    ...args: infer P
  ) => infer A
    ? (
        ...args: P
      ) => Effect.Effect<
        Awaited<A>,
        ProfileOperationErrors[K & keyof ProfileOperationErrors]
      >
    : Effect.Effect<ProfileOperations[K]>;
};
export type ProfileCreation = Omit<PreparedProfileCreation, "create"> & {
  create(): Effect.Effect<
    LiteratureNoteProfile,
    | ProfileOperationError
    | VaultError
    | FileExists
    | VaultFolderBlockedError
    | TemplateFailure
  >;
};
export type ProfileImport = PreparedProfileImport extends infer P
  ? P extends PreparedProfileImport
    ? Omit<P, "import" | "previewSource"> & {
        import(
          options?: Parameters<P["import"]>[0],
        ): Effect.Effect<
          LiteratureNoteProfile,
          | ProfileOperationError
          | ProfileImportChanged
          | VaultError
          | VaultFolderBlockedError
          | TemplateFailure
        >;
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
  Omit<EffectOperations, "prepareCreate" | "prepareImport" | "prepareShare"> & {
    readonly state: Effect.Effect<ProfileState>;
    readonly changes: Stream.Stream<ProfileState>;
    prepareCreate(
      options: ProfileCreateOptions,
    ): Effect.Effect<
      ProfileCreation,
      ProfileOperationError | VaultError | TemplateFailure
    >;
    prepareImport(
      source: string,
      options?: ProfileImportOptions,
    ): Effect.Effect<
      ProfileImport,
      ProfileOperationError | VaultError | TemplateFailure
    >;
    prepareShare(
      selector: ProfileSelector,
    ): Effect.Effect<
      ProfileShare,
      ProfileOperationError | VaultError | TemplateFailure
    >;
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
export const layerProfile = Layer.effect(
  Profile,
  Effect.gen(function* () {
    const settings = yield* PluginSettings;
    const template = yield* Template;
    const scope = yield* Scope.Scope;
    const engine = yield* makeProfileEngine((): Effect.Effect<void> =>
      publish(),
    );
    const snapshot = Effect.fnUntraced(function* (
      failure?: ProfileState["failure"],
    ): Effect.fn.Return<ProfileState> {
      return {
        loaded: yield* engine.loaded,
        profiles: yield* engine.profiles,
        diagnostics: yield* engine.diagnostics,
        defaultDocumentPath: yield* engine.defaultDocumentPath(),
        templateStatus: yield* template.status,
        ...(failure ? { failure } : {}),
      } satisfies ProfileState;
    });
    const state = yield* SubscriptionRef.make(yield* snapshot());
    const publish = Effect.fnUntraced(function* (): Effect.fn.Return<void> {
      yield* SubscriptionRef.set(state, yield* snapshot());
    });
    const scan = engine.scan().pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.gen(function* () {
              yield* SubscriptionRef.set(state, yield* snapshot(cause));
              yield* Effect.logWarning("Profile scan failed", cause);
            }),
      ),
    );
    yield* scan;
    const startupFailure = (yield* SubscriptionRef.get(state)).failure;
    yield* Stream.runForEach(template.changes, () => scan).pipe(
      Effect.forkScoped({ startImmediately: true }),
    );
    yield* Stream.runForEach(
      settings.changes,
      Effect.fnUntraced(function* (saved) {
        const path = yield* engine.documentPathIn(saved["template.folder"]);
        yield* SubscriptionRef.update(state, (previous) => ({
          ...previous,
          defaultDocumentPath: path,
        }));
      }),
    ).pipe(Effect.forkScoped({ startImmediately: true }));
    yield* Effect.addFinalizer(() => PubSub.shutdown(state.pubsub));
    const owned = <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.suspend((): Effect.Effect<A, E | TemplateFailure> =>
        startupFailure
          ? Effect.failCause(startupFailure)
          : isScopeClosed(scope)
            ? Effect.interrupt
            : Effect.forkIn(effect, scope, { startImmediately: true }).pipe(
                Effect.flatMap((fiber) => Fiber.join(fiber)),
              ),
      );
    return Profile.of({
      state: SubscriptionRef.get(state),
      changes: SubscriptionRef.changes(state),
      loaded: engine.loaded,
      profiles: engine.profiles,
      diagnostics: engine.diagnostics,
      defaultDocumentPath: engine.defaultDocumentPath(),
      resolveProfile: engine.resolveProfile,
      profileOf: engine.profileOf,
      getBuiltInSource: engine.getBuiltInSource,
      create: Effect.fn("Profile.create")(
        (...args: Parameters<ProfileOperations["create"]>) =>
          owned(engine.create(...args)),
      ),
      getSource: Effect.fn("Profile.getSource")(
        (...args: Parameters<ProfileOperations["getSource"]>) =>
          owned(engine.getSource(...args)),
      ),
      saveSource: Effect.fn("Profile.saveSource")(
        (...args: Parameters<ProfileOperations["saveSource"]>) =>
          owned(engine.saveSource(...args)),
      ),
      setMatch: Effect.fn("Profile.setMatch")(
        (...args: Parameters<ProfileOperations["setMatch"]>) =>
          owned(engine.setMatch(...args)),
      ),
      duplicate: Effect.fn("Profile.duplicate")(
        (...args: Parameters<ProfileOperations["duplicate"]>) =>
          owned(engine.duplicate(...args)),
      ),
      ejectDefault: Effect.fn("Profile.ejectDefault")(() =>
        owned(engine.ejectDefault()),
      ),
      materializeDefault: Effect.fn("Profile.materializeDefault")(() =>
        owned(engine.materializeDefault()),
      ),
      restoreDefault: Effect.fn("Profile.restoreDefault")(() =>
        owned(engine.restoreDefault()),
      ),
      prepareDelete: Effect.fn("Profile.prepareDelete")(
        (...args: Parameters<ProfileOperations["prepareDelete"]>) =>
          owned(engine.prepareDelete(...args)),
      ),
      delete: Effect.fn("Profile.delete")(
        (...args: Parameters<ProfileOperations["delete"]>) =>
          owned(engine.delete(...args)),
      ),
      prepareCreate: Effect.fn("Profile.prepareCreate")(function* (options) {
        const plan = yield* owned(engine.prepareCreate(options));
        return { ...plan, create: () => owned(plan.create()) };
      }),
      prepareImport: Effect.fn("Profile.prepareImport")(
        function* (source, options) {
          const plan = yield* owned(engine.prepareImport(source, options));
          return { ...plan, import: (options) => owned(plan.import(options)) };
        },
      ),
      prepareShare: Effect.fn("Profile.prepareShare")((selector) =>
        owned(engine.prepareShare(selector)),
      ),
    });
  }).pipe(withLogCategory("profile")),
);
