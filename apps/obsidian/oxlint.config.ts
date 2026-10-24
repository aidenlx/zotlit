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
    new URL("../../packages/config/oxlint-plugin-keyboard.ts", import.meta.url)
      .pathname,
  ],
  rules: {
    "no-console": "error",
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
      // These tests exercise the run entry points themselves.
      files: ["src/lib/effect-runtime.test.ts"],
      rules: { "zotlit-effect-tests/no-effect-run-in-test": "off" },
    },
    {
      files: ["src/**"],
      excludeFiles: ["**/*.test.{ts,tsx}"],
      rules: {
        "zotlit-services/effect-native-resources": "error",
        "zotlit-services/no-legacy-service": "error",
        // A layer takes Obsidian events through obsidianEvents
        // (@/lib/effect-obsidian-events), which gives one ordered intake and a
        // failure boundary per event; a bare registerEvent has neither.
        "zotlit-services/obsidian-events-intake": "error",
      },
    },
    {
      // Events are Streams and state: a SubscriptionRef for what consumers
      // watch, a PubSub Stream for occurrences (policies/events.md). Tests too,
      // since a fake emitter keeps the legacy shape alive in its consumers.
      files: ["src/**"],
      rules: { "zotlit-services/no-nanoevents": "error" },
    },
    {
      // A plain adapter hands out its service's Streams and state. Plain code
      // subscribes with subscribe(runtime, stream, callback) from
      // @/lib/effect-stream, which attaches before returning, isolates each
      // callback's failures and goes quiet after runtime disposal; an
      // adapter's own on/subscribe would each have to re-earn that.
      files: ["src/services/**/plain.ts"],
      rules: { "zotlit-services/plain-adapter-streams": "error" },
    },
    {
      // Legacy emitters, written before no-nanoevents. A file moves off this
      // list when its service converts to Effect.
      files: [
        "src/services/annotation-repository/__fixtures__.ts",
        "src/services/annotation-repository/service.ts",
        "src/services/attachment-import/service.ts",
        "src/services/attachment-resolver/__fixtures__.ts",
        "src/services/attachment-resolver/service.ts",
        "src/services/citation-text/service.ts",
        "src/services/citekey-editor/service.ts",
        "src/services/graph-citations/service.test.ts",
        "src/services/local-bridge/service.ts",
        "src/services/local-server/service.ts",
        "src/services/note-feature/operations.membership.test.ts",
        "src/services/note-feature/operations.ts",
        "src/services/pdf-annotation-editor/__fixtures__.ts",
        "src/services/pdf-annotation-editor/service.ts",
        "src/services/reader-session/session.ts",
        "src/services/zotero-local-api/__fixtures__.ts",
        "src/services/zotero-local-api/service.ts",
        "src/views/library/item-drag.test.ts",
        "src/views/library/view.test.ts",
        "src/views/query-view/table-notes.ts",
        "src/views/welcome/banner.test.ts",
      ],
      rules: { "zotlit-services/no-nanoevents": "off" },
    },
    {
      // Adapters written before plain-adapter-streams. A file moves off this
      // list when its callers subscribe through the helper (#1705).
      files: [
        "src/services/citation-index/plain.ts",
        "src/services/library-scope/plain.ts",
        "src/services/managed-binary/plain.ts",
        "src/services/note-index/plain.ts",
        "src/services/pandoc/render-cache/plain.ts",
        "src/services/profile/plain.ts",
        "src/services/query-client/plain.ts",
        "src/services/settings/plain.ts",
        "src/services/template/plain.ts",
        "src/services/use-ledger/plain.ts",
        "src/services/zotero-pref/plain.ts",
        "src/services/zotero-reads/plain.ts",
      ],
      rules: { "zotlit-services/plain-adapter-streams": "off" },
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
        "no-console": "off",
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
        "src/services/annotation-popover/reading.ts",
        "src/services/annotation-popover/service.tsx",
        "src/services/annotation-repository/notices.ts",
        "src/services/annotation-repository/service.ts",
        "src/services/attachment-import/service.ts",
        "src/services/attachment-resolver/service.ts",
        "src/services/citation-popover/service.tsx",
        "src/services/citation-text/service.ts",
        "src/services/citekey-editor/service.ts",
        "src/services/citekey-reading/service.ts",
        "src/services/excerpt-image/display.ts",
        "src/services/excerpt-image/service.ts",
        "src/services/graph-citations/service.ts",
        "src/services/item-lookup/service.ts",
        "src/services/item-query/service.ts",
        "src/services/local-bridge/service.ts",
        "src/services/local-server/service.ts",
        "src/services/pdf-annotation-editor/service.ts",
        "src/services/release/service.ts",
        "src/services/wikilink-editor/service.ts",
        "src/services/wikilink-reading/service.ts",
        "src/services/zotero-local-api/service.ts",
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
