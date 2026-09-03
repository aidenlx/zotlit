// Atomic Fixture Profile persistence and bounded browser dependency export.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gte } from "semver";

import { CONTRACT_VERSION } from "@zotlit/db";
import { TemplateFacade } from "@zotlit/templates/facade";
import {
  exportLiteratureNotePack,
  LiteratureNotePackError,
} from "@zotlit/templates/literature-note-pack";
import type { LiteratureNoteTemplatePartial } from "@zotlit/templates/literature-note-pack";
import type {
  SaveSelectedProfileRequest,
  SaveSelectedProfileResponse,
  SelectedProfileResponse,
  TemplateDependenciesResponse,
} from "@zotlit/workbench/bridge";
import { DEFAULT_PROFILE_SOURCE } from "@zotlit/workbench/render";

import type { FixtureLayout } from "./layout.ts";
import { LITERATURE_NOTE_PROFILES } from "./spec.ts";

const FIXTURE_PLUGIN_VERSION = "2.1.1";
const BUILT_IN_CITE_SOURCE = readFileSync(
  fileURLToPath(import.meta.resolve("@zotlit/templates/defaults/cite.liquid")),
  "utf8",
);

export type SelectedFixtureProfile = "books" | "default";

type ReadFixtureProfile =
  | SelectedProfileResponse
  | {
      readonly profile: SelectedProfileResponse["profile"];
      readonly source: "";
      readonly document: {
        readonly state: "missing";
        readonly reference: string;
      };
    };

type FixtureProfileSaveResult =
  | SaveSelectedProfileResponse
  | { readonly state: "reference-refused" };

interface SelectedProfileDescriptor {
  readonly id: string;
  readonly name: string;
  readonly filename: string;
  readonly builtInSource?: string;
}

export class FixtureProfileStore {
  readonly #layout: FixtureLayout;
  #saveQueue: Promise<void> = Promise.resolve();
  #conflictOnNextSave = false;

  constructor(layout: FixtureLayout) {
    this.#layout = layout;
  }

  conflictNextSave(): void {
    this.#conflictOnNextSave = true;
  }

  read(selectedProfile: SelectedFixtureProfile): Promise<ReadFixtureProfile> {
    return readFixtureProfile(this.#layout, selectedProfile);
  }

  save(
    selectedProfile: SelectedFixtureProfile,
    request: SaveSelectedProfileRequest,
  ): Promise<FixtureProfileSaveResult> {
    const save = this.#saveQueue.then(() =>
      this.#saveSelectedProfile(selectedProfile, request),
    );
    this.#saveQueue = save.then(
      () => undefined,
      () => undefined,
    );
    return save;
  }

  async readDependencies(
    selectedProfile: SelectedFixtureProfile,
  ): Promise<TemplateDependenciesResponse | undefined> {
    const selected = await this.read(selectedProfile);
    if (selected.document.state === "missing") return undefined;
    return dependencyBundle(selected.source);
  }

  async #saveSelectedProfile(
    selectedProfile: SelectedFixtureProfile,
    request: SaveSelectedProfileRequest,
  ): Promise<FixtureProfileSaveResult> {
    const current = await this.read(selectedProfile);
    if (request.reference !== current.document.reference) {
      return { state: "reference-refused" };
    }

    if (this.#conflictOnNextSave && current.document.state === "present") {
      this.#conflictOnNextSave = false;
      const externalSource = `${current.source}\nExternal Fixture edit`;
      await writeFile(
        profilePath(this.#layout, selectedProfile),
        externalSource,
      );
      return {
        state: "refused",
        reason: "revision-conflict",
        currentRevision: revisionOf(externalSource),
      };
    }

    const conflict = expectedRevisionConflict(current, request);
    if (conflict !== undefined) return conflict;
    const invalid = validateProfileSource(request.source, current.profile.id);
    if (invalid !== undefined) return invalid;

    const path = profilePath(this.#layout, selectedProfile);
    if (request.expected.state === "absent") {
      try {
        await writeFile(path, request.source, { encoding: "utf8", flag: "wx" });
      } catch (error) {
        if (!isErrno(error, "EEXIST")) throw error;
        const source = await readFile(path, "utf8");
        return {
          state: "refused",
          reason: "document-exists",
          currentRevision: revisionOf(source),
        };
      }
    } else {
      await writeFile(path, request.source, "utf8");
    }
    return { state: "saved", revision: revisionOf(request.source) };
  }
}

export function fixtureProfileIdentity(
  selectedProfile: SelectedFixtureProfile,
): SelectedProfileResponse["profile"] {
  const descriptor = profileDescriptor(selectedProfile);
  return { id: descriptor.id, name: descriptor.name };
}

async function readFixtureProfile(
  layout: FixtureLayout,
  selectedProfile: SelectedFixtureProfile,
): Promise<ReadFixtureProfile> {
  const descriptor = profileDescriptor(selectedProfile);
  const profile = fixtureProfileIdentity(selectedProfile);
  const reference = `profile:${profile.id}`;
  const source = await readOptionalFile(profilePath(layout, selectedProfile));
  if (source === undefined && descriptor.builtInSource !== undefined) {
    return {
      profile,
      source: descriptor.builtInSource,
      document: { state: "built-in-absent", reference },
    };
  }
  if (source === undefined) {
    return { profile, source: "", document: { state: "missing", reference } };
  }
  return {
    profile,
    source,
    document: { state: "present", reference, revision: revisionOf(source) },
  };
}

function expectedRevisionConflict(
  current: ReadFixtureProfile,
  request: SaveSelectedProfileRequest,
): SaveSelectedProfileResponse | undefined {
  if (
    request.expected.state === "absent" &&
    current.document.state === "present"
  ) {
    return {
      state: "refused",
      reason: "document-exists",
      currentRevision: current.document.revision,
    };
  }
  if (
    request.expected.state === "revision" &&
    (current.document.state !== "present" ||
      request.expected.revision !== current.document.revision)
  ) {
    return {
      state: "refused",
      reason: "revision-conflict",
      ...(current.document.state === "present"
        ? { currentRevision: current.document.revision }
        : {}),
    };
  }
}

function dependencyBundle(source: string): TemplateDependenciesResponse {
  const cite: LiteratureNoteTemplatePartial = {
    name: "cite",
    language: "liquid",
    source: BUILT_IN_CITE_SOURCE,
  };
  try {
    const bundledSource = exportLiteratureNotePack(source, [cite]);
    const document = new TemplateFacade().parseLiteratureNoteTemplate(
      bundledSource,
    );
    const bundled = document.manifest.partials ?? [];
    const unsupported = bundled.filter(({ language }) => language !== "liquid");
    return {
      templates: bundled.filter(({ language }) => language === "liquid"),
      diagnostics: unsupported.map(({ name }) => ({
        code: "unsupported-dependency",
        message: `Template dependency '${name}' uses an unsupported language.`,
      })),
    };
  } catch (error) {
    if (error instanceof LiteratureNotePackError) {
      return {
        templates: [],
        diagnostics: [{ code: "missing-dependency", message: error.message }],
      };
    }
    throw error;
  }
}

function validateProfileSource(
  source: string,
  selectedProfileId: string,
): SaveSelectedProfileResponse | undefined {
  try {
    const document = new TemplateFacade().parseLiteratureNoteTemplate(source);
    if (document.manifest.id !== selectedProfileId) {
      return { state: "refused", reason: "invalid-source" };
    }
    const usesJavaScript = document.manifest.frontmatter?.some(
      (entry) => "js" in entry,
    );
    const usesEtaDependency = document.manifest.partials?.some(
      (partial) => partial.language === "eta",
    );
    const needsNewerPlugin =
      document.manifest.minAppVersion !== undefined &&
      !gte(FIXTURE_PLUGIN_VERSION, document.manifest.minAppVersion);
    if (
      document.manifest.contract !== CONTRACT_VERSION ||
      document.manifest.language !== "liquid" ||
      usesJavaScript ||
      usesEtaDependency ||
      needsNewerPlugin
    ) {
      return { state: "refused", reason: "unsupported-profile" };
    }
  } catch {
    return { state: "refused", reason: "invalid-source" };
  }
}

function profilePath(
  layout: FixtureLayout,
  selectedProfile: SelectedFixtureProfile,
): string {
  return join(
    layout.vaultDir,
    "templates",
    profileDescriptor(selectedProfile).filename,
  );
}

function profileDescriptor(
  selectedProfile: SelectedFixtureProfile,
): SelectedProfileDescriptor {
  if (selectedProfile === "default") {
    return {
      id: "default",
      name: "Default",
      filename: "zotlit-profile.default.md",
      builtInSource: DEFAULT_PROFILE_SOURCE,
    };
  }
  const profile = LITERATURE_NOTE_PROFILES[0]!;
  return { id: profile.id, name: profile.label, filename: profile.document };
}

function revisionOf(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) return undefined;
    throw error;
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
