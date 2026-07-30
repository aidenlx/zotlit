// Registers the Workbench commands with Obsidian's CLI.
//
// Flag and command help text is localized: it is UI text a user reads while
// discovering the commands. Guide output and diagnostic prose inside a response
// stay literal English, since `code` is the machine surface agent scripts read.

import {
  type App,
  type CliFlag,
  type CliFlags,
  FileSystemAdapter,
  type Plugin,
} from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { type DatabaseService } from "@/services/database/service";
import { type NoteIndex } from "@/services/note-index/service";
import { type SettingsService } from "@/services/settings/service";
import { type TemplateService } from "@/services/template/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

import {
  createTemplateWorkbenchHandlers,
  TEMPLATE_DATA_COMMAND,
  TEMPLATE_GUIDE_COMMAND,
  TEMPLATE_RENDER_COMMAND,
  TEMPLATE_SCHEMA_COMMAND,
  TEMPLATE_SOURCE_COMMAND,
  TEMPLATE_STATUS_COMMAND,
} from "./cli";
import { loadTemplateData } from "./data";
import { GUIDE_TOPIC_NAMES } from "./guide";
import { TEMPLATE_SLOT_NAMES } from "./request";
import { CONTRACT_ROOT_NAMES } from "./schema";

const VAULT_ID_STORAGE_KEY = "zotlit-template-workbench-vault-id";

interface TemplateWorkbenchRegistrationDeps {
  app: App;
  db: DatabaseService;
  noteIndex: NoteIndex;
  settings: SettingsService;
  templates: TemplateService;
  zoteroPref: ZoteroPrefService;
}

/** `<a|b|c>` — a flag's accepted values, read from the canonical registry so
 *  renaming a root or a slot cannot leave the help text stale. */
function choices(names: readonly string[]): string {
  return `<${names.join("|")}>`;
}

/** The Indexed Key selector both item-backed commands take. Flags are built per
 *  registration, so their help text resolves against the active Language Pack
 *  rather than the one loaded when this module was imported. */
function keyFlag(): CliFlag {
  return {
    value: "<indexed-key>",
    description: m.cli_flag_key_desc(),
    required: true,
  };
}

/** The identity assertions both item-backed commands take, listed last. */
function expectationFlags(): CliFlags {
  return {
    "expect-vault": {
      value: "<vault-id>",
      description: m.cli_flag_expect_vault_desc(),
    },
    "expect-source": {
      value: "<source-id>",
      description: m.cli_flag_expect_source_desc(),
    },
  };
}

function rootFlag(): CliFlag {
  return {
    value: choices(CONTRACT_ROOT_NAMES),
    description: m.cli_flag_root_desc(),
    required: true,
  };
}

function formatFlag(values: readonly string[]): CliFlag {
  return {
    value: choices(values),
    description: m.cli_flag_format_desc(),
    required: true,
  };
}

function dataFlags(): CliFlags {
  return {
    key: keyFlag(),
    root: rootFlag(),
    format: formatFlag(["json"]),
    ...expectationFlags(),
  };
}

function schemaFlags(): CliFlags {
  return { root: rootFlag() };
}

function guideFlags(): CliFlags {
  return {
    topic: {
      value: choices(GUIDE_TOPIC_NAMES),
      description: m.cli_flag_topic_desc(),
    },
  };
}

function renderFlags(): CliFlags {
  return {
    key: keyFlag(),
    template: {
      value: choices(TEMPLATE_SLOT_NAMES),
      description: m.cli_flag_template_desc(),
      required: true,
    },
    format: formatFlag(["markdown", "json"]),
    ...expectationFlags(),
  };
}

function sourceFlags(): CliFlags {
  return {
    template: {
      value: choices(TEMPLATE_SLOT_NAMES),
      description: m.cli_flag_template_desc(),
      required: true,
    },
  };
}

/** Return the opaque Workbench id persisted in Obsidian's vault-local storage. */
function vaultId(app: App): string {
  const stored: unknown = app.loadLocalStorage(VAULT_ID_STORAGE_KEY);
  if (typeof stored === "string" && stored.length > 0) return stored;

  const created = crypto.randomUUID();
  app.saveLocalStorage(VAULT_ID_STORAGE_KEY, created);
  return created;
}

export function registerTemplateWorkbench(
  plugin: Plugin,
  deps: TemplateWorkbenchRegistrationDeps,
): void {
  const handlers = createTemplateWorkbenchHandlers({
    getIdentity: async () => {
      await deps.zoteroPref.ready;
      return {
        vault: {
          id: vaultId(deps.app),
          path:
            deps.app.vault.adapter instanceof FileSystemAdapter
              ? deps.app.vault.adapter.getBasePath()
              : deps.app.vault.getName(),
        },
        source: {
          id: deps.zoteroPref.sourceId,
          databasePath: deps.zoteroPref.databasePath,
        },
      };
    },
    loadData: (indexedKey, root) => loadTemplateData(deps, indexedKey, root),
    templates: deps.templates,
  });

  plugin.registerCliHandler(
    TEMPLATE_STATUS_COMMAND,
    m.cli_template_status_desc(),
    null,
    handlers[TEMPLATE_STATUS_COMMAND],
  );
  plugin.registerCliHandler(
    TEMPLATE_DATA_COMMAND,
    m.cli_template_data_desc(),
    dataFlags(),
    handlers[TEMPLATE_DATA_COMMAND],
  );
  plugin.registerCliHandler(
    TEMPLATE_SCHEMA_COMMAND,
    m.cli_template_schema_desc(),
    schemaFlags(),
    handlers[TEMPLATE_SCHEMA_COMMAND],
  );
  plugin.registerCliHandler(
    TEMPLATE_RENDER_COMMAND,
    m.cli_template_render_desc(),
    renderFlags(),
    handlers[TEMPLATE_RENDER_COMMAND],
  );
  plugin.registerCliHandler(
    TEMPLATE_GUIDE_COMMAND,
    m.cli_template_guide_desc(),
    guideFlags(),
    handlers[TEMPLATE_GUIDE_COMMAND],
  );
  plugin.registerCliHandler(
    TEMPLATE_SOURCE_COMMAND,
    m.cli_template_source_desc(),
    sourceFlags(),
    handlers[TEMPLATE_SOURCE_COMMAND],
  );
}
