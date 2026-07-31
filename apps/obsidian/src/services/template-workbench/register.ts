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
  FRONTMATTER_EVAL_COMMAND,
  FRONTMATTER_REMOVE_COMMAND,
  FRONTMATTER_REORDER_COMMAND,
  FRONTMATTER_SET_COMMAND,
  FRONTMATTER_STATUS_COMMAND,
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
  FRONTMATTER_LANGUAGE_NAMES,
  FRONTMATTER_MERGE_NAMES,
  TEMPLATE_SLOT_NAMES,
  type DATA_PARAMS,
  type FRONTMATTER_EVAL_PARAMS,
  type FRONTMATTER_REMOVE_PARAMS,
  type FRONTMATTER_REORDER_PARAMS,
  type FRONTMATTER_SET_PARAMS,
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

function frontmatterEvalFlags(): CliFlags {
  return {
    key: keyFlag(),
    expr: {
      value: "<expression>",
      description: m.cli_flag_expr_desc(),
    },
    language: {
      value: choices(FRONTMATTER_LANGUAGE_NAMES),
      description: m.cli_flag_language_desc(),
    },
    format: formatFlag(["json"]),
    ...expectationFlags(),
  } satisfies Record<(typeof FRONTMATTER_EVAL_PARAMS)[number], CliFlag>;
}

function frontmatterSetFlags(): CliFlags {
  return {
    field: {
      value: "<key>",
      description: m.cli_flag_field_desc(),
      required: true,
    },
    expr: {
      value: "<expression>",
      description: m.cli_flag_frontmatter_set_expr_desc(),
    },
    language: {
      value: choices(FRONTMATTER_LANGUAGE_NAMES),
      description: m.cli_flag_frontmatter_set_language_desc(),
    },
    merge: {
      value: choices(FRONTMATTER_MERGE_NAMES),
      description: m.cli_flag_frontmatter_set_merge_desc(),
    },
  } satisfies Record<(typeof FRONTMATTER_SET_PARAMS)[number], CliFlag>;
}

function frontmatterRemoveFlags(): CliFlags {
  return {
    field: {
      value: "<key>",
      description: m.cli_flag_frontmatter_remove_field_desc(),
      required: true,
    },
  } satisfies Record<(typeof FRONTMATTER_REMOVE_PARAMS)[number], CliFlag>;
}

function frontmatterReorderFlags(): CliFlags {
  return {
    order: {
      value: "<k1,k2,...>",
      description: m.cli_flag_order_desc(),
      required: true,
    },
  } satisfies Record<(typeof FRONTMATTER_REORDER_PARAMS)[number], CliFlag>;
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
    frontmatter: {
      read: () => {
        const status = deps.templates.getFrontmatterFieldStatus();
        return {
          fields: status.fields,
          inertKeys: status.inertKeys,
          javascriptTemplatesEnabled: deps.templates.javascriptTemplatesEnabled,
        };
      },
      evaluate: (fields, zt) =>
        deps.templates.evaluateFrontmatterFields(fields, zt),
      validateExpr: (expr, language) =>
        deps.templates.validateFrontmatterExpr(expr, language),
      write: (fields) => {
        deps.settings.update({ "note.frontmatter-fields": [...fields] });
      },
    },
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
  plugin.registerCliHandler(
    FRONTMATTER_STATUS_COMMAND,
    m.cli_frontmatter_status_desc(),
    null,
    handlers[FRONTMATTER_STATUS_COMMAND],
  );
  plugin.registerCliHandler(
    FRONTMATTER_EVAL_COMMAND,
    m.cli_frontmatter_eval_desc(),
    frontmatterEvalFlags(),
    handlers[FRONTMATTER_EVAL_COMMAND],
  );
  plugin.registerCliHandler(
    FRONTMATTER_SET_COMMAND,
    m.cli_frontmatter_set_desc(),
    frontmatterSetFlags(),
    handlers[FRONTMATTER_SET_COMMAND],
  );
  plugin.registerCliHandler(
    FRONTMATTER_REMOVE_COMMAND,
    m.cli_frontmatter_remove_desc(),
    frontmatterRemoveFlags(),
    handlers[FRONTMATTER_REMOVE_COMMAND],
  );
  plugin.registerCliHandler(
    FRONTMATTER_REORDER_COMMAND,
    m.cli_frontmatter_reorder_desc(),
    frontmatterReorderFlags(),
    handlers[FRONTMATTER_REORDER_COMMAND],
  );
}
