// Registers the Workbench commands with Obsidian's CLI.
//
// Flag and command help text is localized: it is UI text a user reads while
// discovering the commands. Guide output and diagnostic prose inside a response
// stay literal English, since `code` is the machine surface agent scripts read.

import {
  type App,
  type CliFlag,
  type CliFlags,
  type FileSystemAdapter,
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
import {
  TEMPLATE_SLOT_NAMES,
  type DATA_PARAMS,
  type GUIDE_PARAMS,
  type RENDER_PARAMS,
  type SOURCE_PARAMS,
} from "./request";
import { CONTRACT_ROOT_NAMES } from "./schema";
import { choices } from "./vocabulary";

interface TemplateWorkbenchRegistrationDeps {
  app: App;
  db: DatabaseService;
  noteIndex: NoteIndex;
  settings: SettingsService;
  templates: TemplateService;
  zoteroPref: ZoteroPrefService;
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

/** The identity assertion both item-backed commands take, listed last. */
function expectationFlags(): Record<"expect-source", CliFlag> {
  return {
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

/** `format`'s `value` is a bare `|`-separated list, not `choices()`'s
 *  bracketed form: Obsidian's `--json`/`--markdown` alias sugar only fires
 *  when the declared flag value looks like that bare list. */
function formatFlag(values: readonly string[]): CliFlag {
  return {
    value: values.join("|"),
    description: m.cli_flag_format_desc(),
  };
}

function dataFlags(): CliFlags {
  return {
    key: keyFlag(),
    root: rootFlag(),
    format: formatFlag(["json"]),
    ...expectationFlags(),
  } satisfies Record<(typeof DATA_PARAMS)[number], CliFlag>;
}

function guideFlags(): CliFlags {
  return {
    topic: {
      value: choices(GUIDE_TOPIC_NAMES),
      description: m.cli_flag_topic_desc(),
    },
  } satisfies Record<(typeof GUIDE_PARAMS)[number], CliFlag>;
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
  } satisfies Record<(typeof RENDER_PARAMS)[number], CliFlag>;
}

function sourceFlags(): CliFlags {
  return {
    template: {
      value: choices(TEMPLATE_SLOT_NAMES),
      description: m.cli_flag_template_desc(),
      required: true,
    },
  } satisfies Record<(typeof SOURCE_PARAMS)[number], CliFlag>;
}

export function registerTemplateWorkbench(
  plugin: Plugin,
  deps: TemplateWorkbenchRegistrationDeps,
): void {
  const handlers = createTemplateWorkbenchHandlers({
    pluginVersion: plugin.manifest.version,
    getIdentity: async () => {
      await deps.zoteroPref.ready;
      return {
        vault: {
          name: deps.app.vault.getName(),
          // Desktop-only plugin: the adapter is always a FileSystemAdapter.
          path: (deps.app.vault.adapter as FileSystemAdapter).getBasePath(),
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
    null,
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
