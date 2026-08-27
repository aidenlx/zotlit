import { join } from "node:path/posix";

import {
  createLiteratureNotePackInstallRecord,
  diffLiteratureNotePack,
  parseLiteratureNotePack,
  planLiteratureNotePackRevert,
} from "@zotlit/templates/literature-note-pack";
import type {
  LiteratureNotePackCurrentFile,
  LiteratureNotePackDiffRow,
  LiteratureNotePackFile,
  LiteratureNotePackInstallRecord,
} from "@zotlit/templates/literature-note-pack";

import { Service } from "@/services/service-base";
import type { Settings } from "@/services/settings/schema";
import { DEFAULT_TEMPLATES, templatePath } from "@/services/template/defaults";

interface PackVaultFile {
  readonly path: string;
}

interface LiteratureNotePackApp {
  vault: {
    getFileByPath(path: string): PackVaultFile | null;
    cachedRead(file: PackVaultFile): Promise<string>;
    create(path: string, source: string): Promise<PackVaultFile>;
    modify(file: PackVaultFile, source: string): Promise<void>;
  };
  fileManager: {
    trashFile(file: PackVaultFile): Promise<void>;
  };
}

interface LiteratureNotePackSettings {
  loaded: Promise<
    Readonly<Pick<Settings, "note.template-pack-installs" | "template.folder">>
  >;
  update(patch: Pick<Settings, "note.template-pack-installs">): void;
  flush(): Promise<void>;
}

interface LiteratureNotePackTemplate {
  ready: Promise<void>;
  exportLiteratureNotePack(reference: string): Promise<string>;
  renderLiteratureNoteTemplateSource<T extends object>(
    source: string,
    data: T,
  ): { create: string; update: string | null };
}

export interface LiteratureNotePackServiceOptions {
  app: LiteratureNotePackApp;
  settings: LiteratureNotePackSettings;
  template: LiteratureNotePackTemplate;
}

export interface LiteratureNotePackDiff {
  readonly accepted: boolean;
  readonly files: readonly LiteratureNotePackDiffRow[];
}

/** Recorded, recoverable install lifecycle for Literature Note Template Packs. */
export class LiteratureNotePackService extends Service<void> {
  readonly #app;
  readonly #settings;
  readonly #template;

  readonly ready: Promise<void>;

  constructor(options: LiteratureNotePackServiceOptions) {
    super();
    this.#app = options.app;
    this.#settings = options.settings;
    this.#template = options.template;
    this.ready = Promise.all([
      this.#settings.loaded,
      this.#template.ready,
    ]).then(() => undefined);
  }

  async preview<T extends object>(
    source: string,
    data: T,
  ): Promise<{ create: string; update: string | null }> {
    await this.ready;
    return this.#template.renderLiteratureNoteTemplateSource(source, data);
  }

  async export(reference: string): Promise<string> {
    await this.ready;
    return await this.#template.exportLiteratureNotePack(reference);
  }

  async diff(
    reference: string,
    source: string,
    options: { readonly overwrite?: readonly string[] } = {},
  ): Promise<LiteratureNotePackDiff> {
    await this.ready;
    const settings = await this.#settings.loaded;
    const candidate = parseLiteratureNotePack(reference, source);
    const current = await this.#readCurrentFiles(
      candidate.files,
      settings["template.folder"],
    );
    const prior = [...settings["note.template-pack-installs"]]
      .reverse()
      .find((record) => record.pack.id === candidate.pack.id);
    const files = diffLiteratureNotePack(candidate.files, current, {
      overwrite: options.overwrite,
      prior,
    });
    return {
      accepted: files.every((file) => file.verdict !== "refuse"),
      files,
    };
  }

  async apply(
    reference: string,
    source: string,
    options: { readonly overwrite?: readonly string[] } = {},
  ): Promise<LiteratureNotePackInstallRecord> {
    await this.ready;
    const settings = await this.#settings.loaded;
    const candidate = parseLiteratureNotePack(reference, source);
    const current = await this.#readCurrentFiles(
      candidate.files,
      settings["template.folder"],
    );
    const prior = [...settings["note.template-pack-installs"]]
      .reverse()
      .find((record) => record.pack.id === candidate.pack.id);
    const diff = diffLiteratureNotePack(candidate.files, current, {
      overwrite: options.overwrite,
      prior,
    });
    const record = createLiteratureNotePackInstallRecord(
      candidate.pack,
      candidate.files,
      diff,
    );

    for (const file of candidate.files) {
      const path = packFilePath(settings["template.folder"], file.key);
      const currentFile = this.#app.vault.getFileByPath(path);
      if (currentFile) await this.#app.vault.modify(currentFile, file.source);
      else await this.#app.vault.create(path, file.source);
    }
    this.#settings.update({
      "note.template-pack-installs": [
        ...settings["note.template-pack-installs"],
        record,
      ],
    });
    await this.#settings.flush();
    return record;
  }

  async revert(packId: string): Promise<{
    readonly restored: readonly string[];
    readonly trashed: readonly string[];
  }> {
    await this.ready;
    const settings = await this.#settings.loaded;
    const records = settings["note.template-pack-installs"];
    const index = records.findLastIndex((record) => record.pack.id === packId);
    if (index === -1)
      throw new Error(`Literature Note Pack '${packId}' is not installed`);
    const record = records[index]!;
    const current = await this.#readInstalledFiles(
      record,
      settings["template.folder"],
    );
    const actions = planLiteratureNotePackRevert(record, current);
    const restored: string[] = [];
    const trashed: string[] = [];
    for (const action of actions) {
      const path = packFilePath(settings["template.folder"], action.key);
      const file = this.#app.vault.getFileByPath(path)!;
      if (action.action === "trash") {
        await this.#app.fileManager.trashFile(file);
        trashed.push(path);
      } else {
        await this.#app.vault.modify(file, action.source);
        restored.push(path);
      }
    }
    this.#settings.update({
      "note.template-pack-installs": records.filter(
        (_record, recordIndex) => recordIndex !== index,
      ),
    });
    await this.#settings.flush();
    return { restored, trashed };
  }

  async #readCurrentFiles(
    candidate: readonly LiteratureNotePackFile[],
    folder: string,
  ): Promise<LiteratureNotePackCurrentFile[]> {
    return await Promise.all(
      candidate.map(async (file) => {
        const path = packFilePath(folder, file.key);
        const current = this.#app.vault.getFileByPath(path);
        const builtInSource = current ? null : builtInPackSource(file.key);
        return {
          key: file.key,
          source: current
            ? await this.#app.vault.cachedRead(current)
            : builtInSource,
          builtIn: builtInSource !== null,
        };
      }),
    );
  }

  async #readInstalledFiles(
    record: LiteratureNotePackInstallRecord,
    folder: string,
  ): Promise<LiteratureNotePackFile[]> {
    return await Promise.all(
      record.files.map(async (installed) => {
        const path = packFilePath(folder, installed.key);
        const file = this.#app.vault.getFileByPath(path);
        return {
          key: installed.key,
          source: file ? await this.#app.vault.cachedRead(file) : "",
        };
      }),
    );
  }
}

function packFilePath(folder: string, key: string): string {
  if (key.startsWith("document:")) {
    return join(folder, key.slice("document:".length));
  }
  const [, name, language] = key.split(":");
  return templatePath(folder, name!, language as "liquid" | "eta");
}

function builtInPackSource(key: string): string | null {
  if (!key.startsWith("partial:")) return null;
  const name = key.split(":")[1]!;
  return Object.hasOwn(DEFAULT_TEMPLATES, name)
    ? DEFAULT_TEMPLATES[name as keyof typeof DEFAULT_TEMPLATES]
    : null;
}
