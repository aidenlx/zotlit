// Registers the Workbench commands with Obsidian's CLI.
//
// Command, flag, guide, and diagnostic text is all hardcoded English: an
// agent-facing contract surface, not localized UI. See
// apps/obsidian/policies/cli-text.md.

import type {
  App,
  CliFlag,
  CliFlags,
  FileSystemAdapter,
  Plugin,
} from "obsidian";

import type { DatabaseService } from "@/services/database/service";
import type { NoteIndex } from "@/services/note-index/service";
import type { SettingsService } from "@/services/settings/service";
import type { TemplateService } from "@/services/template/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import {
  createTemplateWorkbenchHandlers,
  FRONTMATTER_EVAL_COMMAND,
  FRONTMATTER_REMOVE_COMMAND,
  FRONTMATTER_REORDER_COMMAND,
  FRONTMATTER_SET_COMMAND,
  FRONTMATTER_STATUS_COMMAND,
  TEMPLATE_DATA_COMMAND,
  TEMPLATE_DOCUMENT_RENDER_COMMAND,
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
} from "./request";
import type {
  DATA_PARAMS,
  DOCUMENT_RENDER_PARAMS,
  FRONTMATTER_EVAL_PARAMS,
  FRONTMATTER_REMOVE_PARAMS,
  FRONTMATTER_REORDER_PARAMS,
  FRONTMATTER_SET_PARAMS,
  GUIDE_PARAMS,
  RENDER_PARAMS,
  SOURCE_PARAMS,
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

/** The Indexed Key selector both item-backed commands take. */
function keyFlag(): CliFlag {
  return {
    value: "<indexed-key>",
    description: "Zotero key for an object",
    required: true,
  };
}

/** The identity assertion both item-backed commands take, listed last. */
function expectationFlags(): Record<"expect-source", CliFlag> {
  return {
    "expect-source": {
      value: "<source-id>",
      description: "Zotero source ID the call must match",
    },
  };
}

function rootFlag(): CliFlag {
  return {
    value: choices(CONTRACT_ROOT_NAMES),
    description: "Template data root",
    required: true,
  };
}

/** `format`'s `value` is a bare `|`-separated list, not `choices()`'s
 *  bracketed form: Obsidian's `--json`/`--markdown` alias sugar only fires
 *  when the declared flag value looks like that bare list. */
function formatFlag(values: readonly string[]): CliFlag {
  return {
    value: values.join("|"),
    description: "Output format, default json",
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
      description: "Guide topic",
    },
  } satisfies Record<(typeof GUIDE_PARAMS)[number], CliFlag>;
}

function renderFlags(): CliFlags {
  return {
    key: keyFlag(),
    template: {
      value: choices(TEMPLATE_SLOT_NAMES),
      description: "Template to render",
      required: true,
    },
    format: formatFlag(["markdown", "json"]),
    ...expectationFlags(),
  } satisfies Record<(typeof RENDER_PARAMS)[number], CliFlag>;
}

function documentRenderFlags(): CliFlags {
  return {
    key: keyFlag(),
    profile: {
      value: "<default|profile-id>",
      description: "Profile id whose document to render",
    },
    document: {
      value: "<reference>",
      description: "Installed document reference to render",
    },
    source: {
      value: "<document-source>",
      description: "Uninstalled document source to render in memory",
    },
    ...expectationFlags(),
  } satisfies Record<(typeof DOCUMENT_RENDER_PARAMS)[number], CliFlag>;
}

function sourceFlags(): CliFlags {
  return {
    template: {
      value: choices(TEMPLATE_SLOT_NAMES),
      description: "Template to render",
      required: true,
    },
  } satisfies Record<(typeof SOURCE_PARAMS)[number], CliFlag>;
}

function frontmatterEvalFlags(): CliFlags {
  return {
    key: keyFlag(),
    expr: {
      value: "<expression>",
      description:
        "Ad-hoc frontmatter expression to evaluate instead of the configured fields",
    },
    language: {
      value: choices(FRONTMATTER_LANGUAGE_NAMES),
      description: "Language of expr, default liquid",
    },
    format: formatFlag(["json"]),
    ...expectationFlags(),
  } satisfies Record<(typeof FRONTMATTER_EVAL_PARAMS)[number], CliFlag>;
}

function frontmatterSetFlags(): CliFlags {
  return {
    field: {
      value: "<key>",
      description: "Managed Frontmatter field key to add or update",
      required: true,
    },
    expr: {
      value: "<expression>",
      description:
        "Field expression; required for a new field, keeps the current expression when omitted on an existing field",
    },
    language: {
      value: choices(FRONTMATTER_LANGUAGE_NAMES),
      description:
        "Field language; defaults to liquid on a new field, keeps the current language when omitted on an existing field",
    },
    merge: {
      value: choices(FRONTMATTER_MERGE_NAMES),
      description:
        "Merge strategy; defaults to replace on a new field, keeps the current strategy when omitted on an existing field",
    },
  } satisfies Record<(typeof FRONTMATTER_SET_PARAMS)[number], CliFlag>;
}

function frontmatterRemoveFlags(): CliFlags {
  return {
    field: {
      value: "<key>",
      description: "Managed Frontmatter field key to delete",
      required: true,
    },
  } satisfies Record<(typeof FRONTMATTER_REMOVE_PARAMS)[number], CliFlag>;
}

function frontmatterReorderFlags(): CliFlags {
  return {
    order: {
      value: "<k1,k2,...>",
      description:
        "Complete, comma-separated permutation of the configured field keys, in write order",
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
    literatureNotes: {
      readProfiles: () => {
        const settings = deps.settings.current;
        if (!settings) throw new Error("Settings are not loaded");
        return {
          defaultProfile: settings["note.default-profile"],
          profiles: settings["note.profiles"],
        };
      },
      getDocumentStatuses: () =>
        deps.templates.getLiteratureNoteTemplateStatuses(),
      getDocument: (reference) =>
        deps.templates.getLiteratureNoteTemplate(reference),
      renderSource: (source, data) =>
        deps.templates.renderLiteratureNoteTemplateSource(source, data),
    },
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
    "Report ZotLit Template Workbench state",
    null,
    handlers[TEMPLATE_STATUS_COMMAND],
  );
  plugin.registerCliHandler(
    TEMPLATE_DATA_COMMAND,
    "Return serialized ZotLit Template data, payload under 'zt'",
    dataFlags(),
    handlers[TEMPLATE_DATA_COMMAND],
  );
  plugin.registerCliHandler(
    TEMPLATE_SCHEMA_COMMAND,
    "Return download URLs for every ZotLit Template data schema",
    null,
    handlers[TEMPLATE_SCHEMA_COMMAND],
  );
  plugin.registerCliHandler(
    TEMPLATE_RENDER_COMMAND,
    "Render an active ZotLit Template in memory, rendered bytes under 'markdown'",
    renderFlags(),
    handlers[TEMPLATE_RENDER_COMMAND],
  );
  plugin.registerCliHandler(
    TEMPLATE_DOCUMENT_RENDER_COMMAND,
    "Render a Literature Note Template document in memory, create and update bytes under 'render'",
    documentRenderFlags(),
    handlers[TEMPLATE_DOCUMENT_RENDER_COMMAND],
  );
  plugin.registerCliHandler(
    TEMPLATE_GUIDE_COMMAND,
    "Print the ZotLit Template Workbench guide",
    guideFlags(),
    handlers[TEMPLATE_GUIDE_COMMAND],
  );
  plugin.registerCliHandler(
    TEMPLATE_SOURCE_COMMAND,
    "Return the active ZotLit Template body, under 'source'",
    sourceFlags(),
    handlers[TEMPLATE_SOURCE_COMMAND],
  );
  plugin.registerCliHandler(
    FRONTMATTER_STATUS_COMMAND,
    "Report the configured ZotLit Managed Frontmatter fields",
    null,
    handlers[FRONTMATTER_STATUS_COMMAND],
  );
  plugin.registerCliHandler(
    FRONTMATTER_EVAL_COMMAND,
    "Evaluate ZotLit Managed Frontmatter fields, or one ad-hoc expression, against an item",
    frontmatterEvalFlags(),
    handlers[FRONTMATTER_EVAL_COMMAND],
  );
  plugin.registerCliHandler(
    FRONTMATTER_SET_COMMAND,
    "Add or update one ZotLit Managed Frontmatter field; omitted parameters on an existing field keep their current values",
    frontmatterSetFlags(),
    handlers[FRONTMATTER_SET_COMMAND],
  );
  plugin.registerCliHandler(
    FRONTMATTER_REMOVE_COMMAND,
    "Delete one ZotLit Managed Frontmatter field",
    frontmatterRemoveFlags(),
    handlers[FRONTMATTER_REMOVE_COMMAND],
  );
  plugin.registerCliHandler(
    FRONTMATTER_REORDER_COMMAND,
    "Arrange the configured ZotLit Managed Frontmatter fields into a new order",
    frontmatterReorderFlags(),
    handlers[FRONTMATTER_REORDER_COMMAND],
  );
}
