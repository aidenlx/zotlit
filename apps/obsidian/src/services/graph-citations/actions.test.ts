// @vitest-environment happy-dom
import { createMockPlugin, Keymap } from "@mock/obsidian";
import type {
  App,
  Command,
  GraphOptions,
  TFile,
  ViewState,
  WorkspaceLeaf,
} from "obsidian";
import { describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import {
  addGraphCitationsActions,
  citationGraphReadiness,
  openLocalCitationGraph,
} from "./actions";
import type { GraphCitationsActionDeps } from "./actions";
import { installDisplayRows } from "./display";
import { applyCitationGraphPreset } from "./preset";
import { FakeColorGroupSection, FakeControlSection } from "./test-double";

/** Every command id, in registration order. */
const ALL_COMMAND_IDS = ["open-citation-graph", "open-local-citation-graph"];

/** A note the local command can graph. */
const DRAFT = { path: "Draft.md" } as TFile;

/** What one opened leaf recorded: how it was asked for, and what it was told to show. */
interface OpenedLeaf {
  /** The `getLeaf` arguments the leaf came from. */
  asked: unknown[];
  state?: ViewState;
}

interface FixtureOptions {
  graphEnabled?: boolean;
  activeFile?: TFile | null;
  /** Whether Graph Citations started; a failed start rejects its `ready`. */
  started?: boolean;
  /** The vault-wide "Show citations in graph view" setting. */
  featureEnabled?: boolean;
}

function setup(options: FixtureOptions = {}) {
  const opened: OpenedLeaf[] = [];
  /** What each leaf showed by the time the preset reached it. */
  const preset: { leaf: WorkspaceLeaf; showing?: string }[] = [];
  const leafStates = new WeakMap<WorkspaceLeaf, OpenedLeaf>();
  const mostRecent = { id: "most-recent" } as unknown as WorkspaceLeaf;
  const workspace = {
    getActiveFile: () => options.activeFile ?? null,
    getMostRecentLeaf: () => mostRecent,
    getLeaf: (...asked: unknown[]) => {
      const record: OpenedLeaf = { asked };
      opened.push(record);
      const leaf = {
        setViewState: (state: ViewState) => {
          record.state = state;
          return Promise.resolve();
        },
      } as unknown as WorkspaceLeaf;
      leafStates.set(leaf, record);
      return leaf;
    },
  };
  const app = {
    workspace,
    lastEvent: { type: "keydown" },
    internalPlugins: {
      getEnabledPluginById: (id: string) =>
        id === "graph" && (options.graphEnabled ?? true) ? {} : null,
    },
  } as unknown as App;
  const plugin = createMockPlugin();
  const ready =
    (options.started ?? true)
      ? Promise.resolve()
      : Promise.reject(new Error("start failed"));
  // Awaited by the readiness check alone in some cases, so it never counts as
  // an unhandled rejection.
  ready.catch(() => {});
  const presetApplied = Promise.withResolvers<void>();
  const deps: GraphCitationsActionDeps = {
    app,
    graphCitations: {
      ready,
      enabled: options.featureEnabled ?? true,
      applyPreset: vi.fn((leaf: WorkspaceLeaf) => {
        preset.push({ leaf, showing: leafStates.get(leaf)?.state?.type });
        presetApplied.resolve();
      }),
    },
  };
  addGraphCitationsActions(plugin, deps);
  const command = (id: string): Command => plugin.commands.get(id)!;
  return {
    app,
    deps,
    plugin,
    opened,
    preset,
    commandSettled: presetApplied.resolve,
    mostRecent,
    command,
    /** Performs one command, then lets what it started settle. */
    async run(id: string): Promise<void> {
      const { callback, checkCallback } = command(id);
      if (callback) await callback();
      else {
        const ran = checkCallback!(false);
        if (ran) await presetApplied.promise;
      }
    },
  };
}

describe("addGraphCitationsActions", () => {
  it("registers both commands under their house-style names", () => {
    const { plugin, command } = setup();
    expect([...plugin.commands.keys()]).toEqual(ALL_COMMAND_IDS);
    expect(command("open-citation-graph").name).toBe(
      m.command_open_citation_graph_name(),
    );
    expect(command("open-local-citation-graph").name).toBe(
      m.command_open_local_citation_graph_name(),
    );
  });

  it("ships no default keyboard shortcut", () => {
    const { plugin } = setup();
    for (const registered of plugin.commands.values()) {
      expect(registered.hotkeys).toBeUndefined();
    }
  });

  it("opens the global graph where the native command opens it, then presets it", async () => {
    const isModEvent = vi.spyOn(Keymap, "isModEvent").mockReturnValue("tab");
    const fixture = setup();

    await fixture.run("open-citation-graph");

    expect(isModEvent).toHaveBeenCalledWith(fixture.app.lastEvent);
    expect(fixture.opened).toEqual([
      { asked: ["tab"], state: { type: "graph", active: true, state: {} } },
    ]);
    // The preset reaches the leaf it opened, and only once that leaf shows a graph.
    expect(fixture.preset).toEqual([
      { leaf: expect.anything(), showing: "graph" },
    ]);
    isModEvent.mockRestore();
  });

  it("opens the local graph as a vertical split grouped to the pane it came from", async () => {
    const fixture = setup({ activeFile: DRAFT });

    await fixture.run("open-local-citation-graph");

    expect(fixture.opened).toEqual([
      {
        asked: ["split", "vertical"],
        state: {
          type: "localgraph",
          active: true,
          group: fixture.mostRecent,
          state: { file: "Draft.md" },
        },
      },
    ]);
    expect(fixture.preset).toEqual([
      { leaf: expect.anything(), showing: "localgraph" },
    ]);
  });

  it.each(ALL_COMMAND_IDS)(
    "%s enables author and title labels through set-options",
    async (id) => {
      const fixture = setup({ activeFile: DRAFT });
      const displayOptions = new FakeControlSection();
      const colorGroupOptions = new FakeColorGroupSection();
      const engine = {
        options: {
          centerStrength: 0.42,
          textFadeMultiplier: -0.5,
        } as GraphOptions,
        displayOptions,
        colorGroupOptions,
        render: vi.fn(),
        onOptionsChange: vi.fn(),
        setOptions: vi.fn((options: GraphOptions) => {
          displayOptions.setOptions(options);
          if (Array.isArray(options.colorGroups))
            colorGroupOptions.setColorQueries(options.colorGroups);
        }),
      };
      using _rows = installDisplayRows(engine, { saved: null });
      expect(engine.options["zotlit-author-title-labels"]).toBe(false);
      fixture.deps.graphCitations.applyPreset = (leaf) => {
        Object.assign(leaf, {
          view: {
            getViewType: () =>
              id === "open-citation-graph" ? "graph" : "localgraph",
            dataEngine: engine,
            engine,
          },
        });
        applyCitationGraphPreset(leaf, {
          wikilinkCitations: false,
          color: { a: 1, rgb: 0xe8622c },
        });
        fixture.commandSettled();
      };

      await fixture.run(id);

      expect(engine.options["zotlit-author-title-labels"]).toBe(true);
      expect(engine.setOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          "zotlit-author-title-labels": true,
        }),
      );
      expect(engine.options.centerStrength).toBe(0.42);
      expect(engine.options.textFadeMultiplier).toBe(-0.5);
      const firstOptions = structuredClone(engine.options);
      const firstRenders = engine.render.mock.calls.length;

      await fixture.run(id);

      expect(engine.options).toEqual(firstOptions);
      expect(engine.render).toHaveBeenCalledTimes(firstRenders);
    },
  );

  it("leaves the local command out of the palette while no note is active", async () => {
    const fixture = setup({ activeFile: null });
    expect(
      fixture.command("open-local-citation-graph").checkCallback!(true),
    ).toBe(false);

    await fixture.run("open-local-citation-graph");

    expect(fixture.opened).toEqual([]);
  });

  it("offers the local command while a note is active", () => {
    const fixture = setup({ activeFile: DRAFT });
    expect(
      fixture.command("open-local-citation-graph").checkCallback!(true),
    ).toBe(true);
  });

  it("opens nothing while the Graph core plugin is disabled", async () => {
    const fixture = setup({ graphEnabled: false, activeFile: DRAFT });

    await fixture.run("open-citation-graph");
    await openLocalCitationGraph(fixture.deps, DRAFT);

    expect(fixture.opened).toEqual([]);
    expect(fixture.preset).toEqual([]);
  });

  it("opens nothing while Graph Citations failed to start", async () => {
    const fixture = setup({ started: false, activeFile: DRAFT });

    await fixture.run("open-citation-graph");
    await openLocalCitationGraph(fixture.deps, DRAFT);

    expect(fixture.opened).toEqual([]);
    expect(fixture.preset).toEqual([]);
  });

  it("opens nothing while the vault-wide setting is off", async () => {
    const fixture = setup({ featureEnabled: false, activeFile: DRAFT });

    await fixture.run("open-citation-graph");
    await openLocalCitationGraph(fixture.deps, DRAFT);

    // A preset graph with no citations drawn is a graph with the reader's own
    // options taken away for nothing, so neither command opens a leaf at all.
    expect(fixture.opened).toEqual([]);
    expect(fixture.preset).toEqual([]);
  });

  it("still offers the local command while the vault-wide setting is off", () => {
    const fixture = setup({ featureEnabled: false, activeFile: DRAFT });
    expect(
      fixture.command("open-local-citation-graph").checkCallback!(true),
    ).toBe(true);
  });
});

describe("citationGraphReadiness", () => {
  it("reads a Citation Graph as ready where everything it stands on is there", async () => {
    await expect(citationGraphReadiness(setup().deps)).resolves.toBe("ready");
  });

  it("tells the three ways it cannot be opened apart", async () => {
    await expect(
      citationGraphReadiness(setup({ graphEnabled: false }).deps),
    ).resolves.toBe("core-plugin-disabled");
    await expect(
      citationGraphReadiness(setup({ started: false }).deps),
    ).resolves.toBe("unavailable");
    await expect(
      citationGraphReadiness(setup({ featureEnabled: false }).deps),
    ).resolves.toBe("feature-off");
  });
});
