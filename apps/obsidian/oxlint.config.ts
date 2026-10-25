import { defineConfig } from "oxlint";

import { testBaselineOverrides } from "@zotlit/config/oxlint";
import baseConfig, {
  itemQuerySchemaPaths,
  parentImportPattern,
  uniqueIdPaths,
} from "@zotlit/config/oxlint";

const obsidianImportPaths = [
  {
    name: "semver",
    allowTypeImports: true,
    message:
      "Import from semver/functions/<name> to keep unused semver code out of the plugin bundle.",
  },
  {
    name: "obsidian",
    importNames: ["HoverPopover"],
    allowTypeImports: true,
    message:
      "Extend PopoutAwareHoverPopover from @/lib/popout-aware-hover-popover; it cancels Obsidian's popover timers on the window that armed them (see policies/hover-popover.md).",
  },
  ...uniqueIdPaths,
];

// Effect tests run with the services the plugin's entry points add.
const effectTestPaths = [
  {
    name: "@effect/vitest",
    message:
      "Use @/lib/effect-vitest: its Effect tests run with the plugin's browser scheduler and loggers.",
  },
];

const commonImports = {
  patterns: [
    parentImportPattern,
    {
      group: ["**/citation-index/scan", "./scan"],
      importNames: [
        "scanDocumentCitations",
        "scanCitekeyOccurrences",
        "documentWikilinks",
        "maskExclusions",
        "maskWikilinks",
      ],
      message: "Read document citations through the citation parse worker.",
    },
  ],
  paths: [...obsidianImportPaths, ...itemQuerySchemaPaths],
};

const runtimeImports = {
  ...commonImports,
  paths: [
    {
      name: "@/lib/effect",
      importNames: ["ManagedRuntime", "Scheduler"],
      allowTypeImports: true,
      message:
        "Start Effects through Effect in @/lib/effect; its entry points supply the browser scheduler.",
    },
    {
      name: "effect",
      allowTypeImports: true,
      message:
        "Use @/lib/effect: Obsidian's renderer and workers default to Chromium MessageChannel scheduling. Node setImmediate can starve browser tasks.",
    },
    {
      name: "effect/Effect",
      allowTypeImports: true,
      message: "Use Effect from @/lib/effect for Chromium scheduling.",
    },
    {
      name: "effect/ManagedRuntime",
      allowTypeImports: true,
      message:
        "Use the Effect entry points in @/lib/effect for Chromium scheduling.",
    },
    {
      name: "effect/Scheduler",
      allowTypeImports: true,
      message:
        "Obsidian scheduling is owned by @/lib/effect-runtime and @/lib/browser-scheduler.",
    },
    ...effectTestPaths,
    ...commonImports.paths,
  ],
};

export default defineConfig({
  extends: [baseConfig],
  jsPlugins: [
    new URL("../../packages/config/oxlint-plugin-design.ts", import.meta.url)
      .pathname,
    "./scripts/oxlint-plugin-popout-windows.ts",
    "./scripts/oxlint-plugin-menu-sections.ts",
    "./scripts/oxlint-plugin-obsidian-css.ts",
    "./scripts/oxlint-plugin-private-api.ts",
    "./scripts/oxlint-plugin-services.ts",
    "./scripts/oxlint-plugin-effect-tests.ts",
    "./scripts/oxlint-plugin-logging.ts",
    new URL("../../packages/config/oxlint-plugin-keyboard.ts", import.meta.url)
      .pathname,
  ],
  rules: {
    "effecttsgo/global-console": "error",
    "effecttsgo/global-console-in-effect": "error",
    "zotlit-obsidian/no-cross-window-instanceof": "error",
    "zotlit-keyboard/no-layer-check": "error",
    "zotlit-menu/no-literal-section": "error",
    "zotlit-services/service-tag-id": "error",
    "zotlit-services/cli-command-registration": "error",
    // Repeats the base pattern: a rule set here replaces the base entry.
    "no-restricted-imports": ["error", runtimeImports],
  },
  overrides: [
    {
      files: ["src/services/citekey-editor/decorate.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          { ...runtimeImports, patterns: [parentImportPattern] },
        ],
      },
    },
    {
      files: ["src/**"],
      rules: { "zotlit-services/worker-rpc": "error" },
    },
    {
      files: ["src/**"],
      rules: { "zotlit-logging/no-logtape-in-effect-file": "error" },
    },
    {
      // Tests and the LogTape bridge and sink owners may use LogTape directly.
      files: [
        "src/**/*.test.{ts,tsx}",
        "src/lib/log.ts",
        "src/lib/effect-log.ts",
        "src/services/log/**",
      ],
      rules: { "zotlit-logging/no-logtape-in-effect-file": "off" },
    },
    {
      // Logging backlog: rework the file to log through Effect, then remove it from the list.
      files: [
        "src/lib/wikilink-citation.ts",
        "src/services/attachment-import/service.ts",
        "src/services/attachment-open/actions.ts",
        "src/services/attachment-resolver/service.ts",
        "src/services/citation-index/ambiguity.ts",
        "src/services/citation-index/sources.ts",
        "src/services/citekey-editor/service.ts",
        "src/services/citekey-reading/service.ts",
        "src/services/excerpt-image/prepare.ts",
        "src/services/graph-citations/service.ts",
        "src/services/item-lookup/service.ts",
        "src/services/item-query/service.ts",
        "src/services/local-bridge/service.ts",
        "src/services/note-feature/operations.ts",
        "src/services/note-feature/update-batch.ts",
        "src/services/note-import/batch-import.ts",
        "src/services/note-import/service.ts",
        "src/services/pandoc/document-presentation.ts",
        "src/services/protocol/register.ts",
        "src/services/template/actions.ts",
        "src/services/wikilink-editor/service.ts",
        "src/services/wikilink-reading/service.ts",
        "src/views/annot-view/view.tsx",
        "src/views/library/item-actions.ts",
        "src/views/library/library-tree.tsx",
        "src/views/library/reading-card.tsx",
        "src/views/library/view.ts",
        "src/views/note-preview/session.ts",
        "src/views/pandoc-export/register.ts",
        "src/views/query-view/view.tsx",
        "src/views/references/view.tsx",
        "src/views/template-workbench/view.tsx",
        "src/views/welcome/banner.tsx",
      ],
      rules: { "zotlit-logging/no-logtape-in-effect-file": "off" },
    },
    {
      // These adapters own effect/rpc worker creation, shutdown and log transport.
      files: [
        "src/services/citation-parse/worker-host.ts",
        "src/services/zotero-reads/worker-launch.ts",
        "src/services/zotero-reads/worker-host.ts",
        "src/services/zotero-reads/worker.ts",
      ],
      rules: { "zotlit-services/worker-rpc": "off" },
    },
    {
      // Worker migration backlog: move snapshot integrity checks to effect/rpc,
      // then remove this file from the list.
      files: ["src/services/database/snapshot-integrity.ts"],
      rules: { "zotlit-services/worker-rpc": "off" },
    },
    {
      files: ["src/**/*.test.{ts,tsx}"],
      rules: {
        "zotlit-effect-tests/no-effect-run-in-test": "error",
        "zotlit-effect-tests/no-real-timer-in-effect-test": "error",
      },
    },
    {
      files: ["src/**"],
      rules: { "zotlit-effect-tests/service-stub": "error" },
    },
    {
      // These tests exercise the run entry points themselves.
      files: ["src/lib/effect-runtime.test.ts"],
      rules: { "zotlit-effect-tests/no-effect-run-in-test": "off" },
    },
    {
      files: ["src/**"],
      excludeFiles: ["**/*.test.{ts,tsx}"],
      rules: {
        "zotlit-services/effect-native-resources": "error",
        "zotlit-services/interrupt-predicate": "error",
        "zotlit-services/layer-stream-consumer": "error",
        "zotlit-services/no-legacy-service": "error",
        "zotlit-services/obsidian-events-intake": "error",
        "zotlit-services/scope-closed": "error",
        "zotlit-services/state-stream": "error",
      },
    },
    {
      // The helper the rule points at.
      files: ["src/lib/effect-scope.ts"],
      rules: { "zotlit-services/scope-closed": "off" },
    },
    {
      files: ["src/**"],
      rules: { "zotlit-services/no-nanoevents": "error" },
    },
    {
      files: ["src/**/*.{ts,tsx}"],
      excludeFiles: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.browser-test.ts",
        "**/__fixtures__/**",
        "**/__fixtures__.ts",
        // Test support and benchmarks, not plugin code: no plugin runtime exists there.
        "**/test-harness.ts",
        "**/*.bench.ts",
        "src/lib/effect-bridge.ts",
        "src/lib/effect-vitest.ts",
      ],
      rules: { "zotlit-services/no-default-runtime": "error" },
    },
    {
      // Default-runtime backlog: run the Effect through the bridge, a layer context runner or a runtime, then remove the file from the list.
      files: [
        "src/lib/effect-scope.ts",
        "src/lib/temp-sweep.ts",
        "src/services/attachment-open/actions.ts",
        "src/services/attachment-resolver/service.ts",
        "src/services/batch-run.ts",
        "src/services/citation-index/ambiguity.ts",
        "src/services/citation-index/sources.ts",
        "src/services/citekey-editor/service.ts",
        "src/services/database/reap-temps.ts",
        "src/services/excerpt-image/prepare.ts",
        "src/services/excerpt-image/request.ts",
        "src/services/graph-citations/service.ts",
        "src/services/item-lookup/service.ts",
        "src/services/item-query/service.ts",
        "src/services/local-bridge/reads.ts",
        "src/services/local-bridge/vault-targets.ts",
        "src/services/note-feature/annotation-citation.ts",
        "src/services/note-feature/companion-view.ts",
        "src/services/note-feature/operations.ts",
        "src/services/note-feature/update-batch.ts",
        "src/services/note-feature/update-single.ts",
        "src/services/note-import/batch-import.ts",
        "src/services/note-import/service.ts",
        "src/services/profile/service.ts",
        "src/services/protocol/register.ts",
        "src/services/template-workbench/data.ts",
        "src/services/template/migration.ts",
        "src/views/annot-view/view.tsx",
        "src/views/library/item-actions.ts",
        "src/views/library/library-tree.tsx",
        "src/views/library/view.ts",
        "src/views/note-preview/citations.ts",
        "src/views/note-preview/session.ts",
        "src/views/pandoc-export/register.ts",
        "src/views/query-view/table-notes.ts",
        "src/views/query-view/view.tsx",
        "src/views/template-workbench/match-data.ts",
        "src/views/template-workbench/view.tsx",
        "src/views/welcome/connection.ts",
      ],
      rules: { "zotlit-services/no-default-runtime": "off" },
    },
    {
      files: ["src/**/*.{ts,tsx}"],
      excludeFiles: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.browser-test.ts",
        "**/__fixtures__/**",
        "**/__fixtures__.ts",
        // Benchmarks measure wall time on purpose.
        "**/*.bench.ts",
        // Converts the Effect Clock into a Temporal function for a non-Effect core.
        "src/lib/effect-clock.ts",
      ],
      rules: { "zotlit-services/clock-time": "error" },
    },
    {
      // Clock backlog: read time through Clock (`Clock.currentTimeMillis` or `DateTime.now` in Effect code; `instantClock(yield* Clock.Clock)` from `@/lib/effect-clock` for a non-Effect core), then remove the file from the list.
      files: [
        "src/services/citation-index/snapshot.ts",
        "src/services/item-lookup/service.ts",
        "src/services/item-query/answer.ts",
        "src/services/item-query/job.ts",
        "src/services/item-query/measure.ts",
        "src/services/item-query/service.ts",
        "src/services/item-query/trace.ts",
        "src/services/note-feature/operations.ts",
        "src/views/annot-view/view.tsx",
      ],
      rules: { "zotlit-services/clock-time": "off" },
    },
    {
      files: ["src/services/**/plain.ts"],
      rules: { "zotlit-services/plain-adapter-streams": "error" },
    },
    {
      // Legacy emitters, written before no-nanoevents. A file moves off this
      // list when its service converts to Effect.
      files: [
        "src/services/attachment-import/service.ts",
        "src/services/attachment-resolver/service.ts",
        "src/services/citekey-editor/service.ts",
        "src/services/local-bridge/service.ts",
        "src/services/note-feature/operations.ts",
        "src/services/pdf-annotation-editor/__fixtures__.ts",
        "src/services/pdf-annotation-editor/service.ts",
        "src/services/reader-session/session.ts",
        "src/views/library/item-drag.test.ts",
        "src/views/library/view.test.ts",
        "src/views/query-view/table-notes.ts",
      ],
      rules: { "zotlit-services/no-nanoevents": "off" },
    },
    {
      // Registered its events before obsidianEvents existed. It moves off this
      // list when it adopts the helper.
      files: ["src/services/use-ledger/service.ts"],
      rules: { "zotlit-services/obsidian-events-intake": "off" },
    },
    {
      files: ["src/views/annot-view/*.{ts,tsx}"],
      excludeFiles: ["**/*.test.{ts,tsx}"],
      rules: { "zotlit-design/annotation-view": "error" },
    },
    ...testBaselineOverrides("apps/obsidian"),
    {
      // UI code runs in the window it stands in, a pop-out included.
      files: ["src/views/**", "src/components/**", "src/**/*.tsx"],
      rules: { "zotlit-obsidian/no-global-timer": "error" },
    },
    {
      // Guarded private API reaches its surface through obsidian-ex.d.ts.
      files: ["src/lib/obsidian-private/**"],
      rules: { "zotlit-private/no-unknown-cast": "error" },
    },
    {
      // A test's fake App stands in for the whole surface.
      files: ["src/lib/obsidian-private/*.test.ts"],
      rules: { "zotlit-private/no-unknown-cast": "off" },
    },
    {
      // React draws its controls from JSX; imperative DOM builds on Obsidian's.
      files: ["src/**/*.tsx"],
      rules: {
        "zotlit-css/no-obsidian-class": "error",
        "zotlit-css/no-setting-in-react": "error",
      },
    },
    {
      // The wrappers that hand Obsidian's control classes to everything else.
      files: ["src/components/obsidian/**"],
      rules: { "zotlit-css/no-obsidian-class": "off" },
    },
    {
      // Tests can inspect the schema; the plugin's other import rules remain.
      files: [
        "src/**/*.{test,spec}.{ts,tsx,js,jsx}",
        "*.{config,setup}.{ts,js,mjs,cjs}",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [parentImportPattern],
            paths: [...effectTestPaths, ...obsidianImportPaths],
          },
        ],
      },
    },
    {
      files: [
        "src/lib/effect.ts",
        "src/lib/effect-worker.ts",
        "src/lib/effect-runtime.ts",
        "src/lib/effect-layer.ts",
        "src/lib/effect-log.ts",
        "src/lib/effect-services.ts",
        "src/lib/effect-vitest.ts",
        "src/lib/browser-scheduler.ts",
      ],
      rules: { "no-restricted-imports": ["error", commonImports] },
    },
    {
      files: [
        "vite.config.ts",
        "src/services/pandoc/filter/zotlit-cite.pandoc.test.ts",
        "src/zt-main.ts",
        "src/services/build.ts",
        "src/services/service-base.ts",
        "src/services/log/**",
      ],
      rules: {
        "effecttsgo/global-console": "off",
        "effecttsgo/global-console-in-effect": "off",
      },
    },
    {
      // The one module that wraps Obsidian's popover itself.
      files: ["src/lib/popout-aware-hover-popover.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: itemQuerySchemaPaths,
          },
        ],
      },
    },
    {
      // This stand-in implements the runtime helper that the rule requires.
      files: ["vitest.setup.js"],
      rules: {
        "zotlit-obsidian/no-cross-window-instanceof": "off",
      },
    },
    {
      // The rule tests reach the package-local Oxlint modules in scripts/.
      files: ["src/lint/*.test.ts"],
      rules: {
        "no-restricted-imports": "off",
      },
    },
    {
      // A reading view of a note: the app's own classes draw its Properties
      // block, so the sheet reads as the note does in the editor.
      files: ["src/views/note-preview/markdown.tsx"],
      rules: { "zotlit-css/no-obsidian-class": "off" },
    },
    {
      // Code written before the rule; new code follows it, and a file moves
      // off this list when it is next reworked.
      files: [
        "src/views/annot-view/AnnotView.tsx",
        "src/views/annot-view/FilterBar.tsx",
        "src/views/annot-view/tag-editor.tsx",
        "src/views/query-view/sort-control.tsx",
        "src/views/query-view/table-layout.tsx",
        "src/views/template-workbench/theme.tsx",
      ],
      rules: { "zotlit-css/no-obsidian-class": "off" },
    },
    {
      // Code written before the rule; new code follows it, and a file moves
      // off this list when it is next reworked.
      files: [
        "src/views/cited-by/CitedBy.tsx",
        "src/views/query-view/query-file-document.ts",
        "src/views/query-view/view.tsx",
        "src/views/welcome/companion-refresh.ts",
        "src/views/welcome/view.tsx",
      ],
      rules: { "zotlit-obsidian/no-global-timer": "off" },
    },
    {
      // Effect tests written before the rule, in plain Vitest. A file moves
      // off this list when its cases move to it.effect.
      files: [
        "src/services/note-feature/update-batch.test.ts",
        "src/services/zotero-reads/citation-lookup.test.ts",
        "src/services/zotero-reads/connection.test.ts",
        "src/services/zotero-reads/handlers.test.ts",
        "src/services/zotero-reads/source.test.ts",
        "src/views/template-workbench/view.test.ts",
      ],
      rules: { "zotlit-effect-tests/no-effect-run-in-test": "off" },
    },
    {
      // Legacy services, written before the rule. A file moves off this list
      // when its service converts to Effect (/obsidian-services).
      files: [
        "src/services/annotation-repository/notices.ts",
        "src/services/attachment-import/service.ts",
        "src/services/attachment-resolver/service.ts",
        "src/services/citekey-editor/service.ts",
        "src/services/citekey-reading/service.ts",
        "src/services/excerpt-image/display.ts",
        "src/services/excerpt-image/service.ts",
        "src/services/graph-citations/service.ts",
        "src/services/item-lookup/service.ts",
        "src/services/item-query/service.ts",
        "src/services/local-bridge/service.ts",
        "src/services/pdf-annotation-editor/service.ts",
        "src/services/wikilink-editor/service.ts",
        "src/services/wikilink-reading/service.ts",
      ],
      rules: { "zotlit-services/no-legacy-service": "off" },
    },
    {
      // Tests written before the rule that assert zt: classes; a file moves off
      // this list when its assertions move to behavior.
      files: [
        "src/services/citation-popover/content.test.ts",
        "src/services/citekey-navigation/citation.test.ts",
        "src/services/pandoc/inline-content.test.ts",
        "src/setting-tab/create-profile-modal.test.ts",
        "src/setting-tab/profile-destination-modal.test.ts",
        "src/views/cited-by/CitedBy.test.ts",
        "src/views/references/References.test.ts",
        "src/views/references/view.test.ts",
        "src/views/template-workbench/host.test.ts",
        "src/views/welcome/Welcome.test.ts",
      ],
      rules: { "zotlit-tests/no-class-assertion": "off" },
    },
    {
      // Node runs these straight from source, where the `@/` alias does not
      // resolve; and they stay independent of plugin code, which
      // tsconfig.node.json cannot type-check. The pin is the one shared
      // contract, a module with no imports.
      files: ["scripts/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["../src/**", "!../src/services/managed-binary/pin.ts"],
                allowTypeImports: true,
                message:
                  "Scripts stay independent of plugin code; a check of plugin code is a Vitest test under src/.",
              },
            ],
          },
        ],
      },
    },
  ],
});
