// @vitest-environment happy-dom
// The Welcome View banner as it draws from its store: its setup steps, its
// Help menu, and the template conversion and migration sections.
import { Menu } from "@mock/obsidian";
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { LiteratureNoteTemplateMigrationResult } from "@/services/template/migration";

import { WelcomeActionsContext } from "./actions";
import type { WelcomeActions } from "./actions";
import { WelcomeStoreProvider, createWelcomeStore } from "./store";
import type { WelcomeState, WelcomeStore } from "./store";
import { Welcome } from "./Welcome";

vi.mock("zustand", () => import("../__fixtures__/zustand"));

let root: Root | undefined;

const CONVERTED: LiteratureNoteTemplateMigrationResult = {
  outcome: "converted",
  document: "zotlit-profile.default.md",
  trashed: [],
  pendingCleanup: [],
  kept: [],
};

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

it("offers the user-controlled template conversion in upgraded onboarding", async () => {
  const { actions, container } = await render("upgraded", {
    templateConversionPending: true,
    templateFolder: "Research templates",
  });
  const button = [...container.querySelectorAll("button")].find(
    (candidate) =>
      candidate.textContent === m.welcome_template_conversion_action(),
  );

  expect(container.textContent).toContain(
    m.welcome_template_conversion_title(),
  );
  expect(container.textContent).toContain(
    m.welcome_template_conversion_body({
      path: "Research templates/zotlit-profile.default.md",
    }),
  );
  expect(container.textContent).not.toContain(m.welcome_migration_title());
  await act(() => button?.click());
  expect(actions.convertLiteratureNoteTemplates).toHaveBeenCalledOnce();
});

it.each(["fresh", "upgraded"] as const)(
  "shows the saved conversion result when reopened in %s mode",
  async (mode) => {
    const { container } = await render(mode, {
      templateConversionResult: {
        document: "Research templates/zotlit-profile.default.md",
        trashed: 4,
        pendingCleanup: [],
      },
    });
    expect(container.textContent).toContain(
      m.welcome_template_conversion_completed_title(),
    );
    expect(container.textContent).toContain(
      m.welcome_template_conversion_completed_body({
        path: "Research templates/zotlit-profile.default.md",
        count: 4,
      }),
    );
    expect(container.textContent).not.toContain(
      m.welcome_template_conversion_action(),
    );
    expect(container.textContent).not.toContain(m.welcome_migration_title());
  },
);

it.each([false, true])(
  "shows the v1 banner only with v1 evidence (%s)",
  async (v1TemplatesPresent) => {
    const { container } = await render("upgraded", { v1TemplatesPresent });
    expect(container.textContent?.includes(m.welcome_migration_title())).toBe(
      v1TemplatesPresent,
    );
  },
);

describe("Welcome setup steps", () => {
  const headings = (container: HTMLElement) =>
    [...container.querySelectorAll('[role="heading"]')].map(
      (el) => el.textContent,
    );
  /** The timeline node a step heading belongs to, which carries its state. */
  function isDone(container: HTMLElement, title: string): boolean {
    const heading = [...container.querySelectorAll('[role="heading"]')].find(
      (el) => el.textContent === title,
    );
    const node = heading?.parentElement?.previousElementSibling;
    if (!node) throw new Error(`No step titled ${title}`);
    return node.classList.contains("zt:border-green");
  }

  it("shows two steps, Connect and the folder, under the name alone", async () => {
    const { container } = await render("fresh");
    expect(headings(container)).toEqual([
      "ZotLit",
      m.welcome_step_connect_title(),
      m.welcome_step_folder_title(),
    ]);
  });

  it("marks the folder step done once the folder exists", async () => {
    const { container } = await render("fresh", {
      literatureFolderExists: true,
    });
    expect(isDone(container, m.welcome_step_folder_title())).toBe(true);
  });

  it("leaves out the Connect step while the Library View says Zotero is not found", async () => {
    const { container } = await render("fresh", { notFound: true });
    expect(headings(container)).toEqual([
      "ZotLit",
      m.welcome_step_folder_title(),
    ]);
  });
});

describe("Welcome links", () => {
  it("puts the documentation and community links under one Help menu, each item opening its own page", async () => {
    const { actions, container } = await render("fresh");
    // No link shows on the banner itself.
    expect(container.querySelectorAll("a")).toHaveLength(0);
    const help = container.querySelector<HTMLElement>("[data-welcome-help]")!;
    expect(help.textContent).toBe(m.welcome_help());
    Menu.instances.length = 0;
    await act(() => help.click());
    const { items } = Menu.instances.at(-1)!;
    const opened = items.map((item) => {
      vi.mocked(actions.openExternal).mockClear();
      item.click();
      return [item.title, vi.mocked(actions.openExternal).mock.calls];
    });
    // The docs site of the test build is https://zotlit.aidenlx.site.
    expect(opened).toEqual([
      [
        m.welcome_docs_getting_started(),
        [["https://zotlit.aidenlx.site/docs"]],
      ],
      [
        m.welcome_docs_templates(),
        [["https://zotlit.aidenlx.site/docs/reference/templates"]],
      ],
      [
        m.welcome_docs_citations(),
        [["https://zotlit.aidenlx.site/docs/how-to/insert-citations"]],
      ],
      [m.welcome_link_github(), [["https://github.com/aidenlx/zotlit"]]],
      [
        m.welcome_link_discussions(),
        [["https://zotlit.aidenlx.site/community"]],
      ],
      [m.welcome_link_sponsor(), [["https://github.com/sponsors/aidenlx"]]],
      [m.welcome_link_blog(), [["https://zotlit.aidenlx.site/blog"]]],
      [m.welcome_link_changelog(), [["https://zotlit.aidenlx.site/changelog"]]],
    ]);
  });

  it.each([false, true])(
    "shows the migration line only while a Migration Prompt is pending (%s)",
    async (migrationPending) => {
      const { container } = await render(
        migrationPending ? "upgraded" : "fresh",
      );
      expect(
        container.textContent?.includes(m.welcome_footer_migration_link()),
      ).toBe(migrationPending);
    },
  );
});

it("replaces the pending prompt with the persisted result after conversion", async () => {
  const { container, store } = await render("upgraded", {
    templateConversionPending: true,
    templateFolder: "templates",
  });
  expect(container.textContent).toContain(
    m.welcome_template_conversion_action(),
  );
  await act(() =>
    store.setState({
      templateConversionPending: false,
      templateConversionResult: {
        document: "templates/zotlit-profile.default.md",
        trashed: 4,
        pendingCleanup: [],
      },
    }),
  );
  expect(container.textContent).toContain(
    m.welcome_template_conversion_completed_body({
      path: "templates/zotlit-profile.default.md",
      count: 4,
    }),
  );
  expect(container.textContent).not.toContain(
    m.welcome_template_conversion_action(),
  );
  expect(container.textContent).not.toContain(m.welcome_migration_title());
});

it("keeps a refusal readable in the banner after the notice is gone", async () => {
  const { actions, container } = await render("upgraded", {
    templateConversionPending: true,
    templateFolder: "templates",
  });
  vi.mocked(actions.convertLiteratureNoteTemplates).mockResolvedValueOnce({
    outcome: "refused",
    diagnostic: {
      code: "unsupported-legacy-template",
      message:
        "Legacy note template must contain one supported content insertion",
      difference: "content insertion",
      hint: "Keep one standard content render in the legacy note template.",
      files: ["templates/zotlit-note.liquid.md"],
    },
  });
  const button = [...container.querySelectorAll("button")].find(
    (candidate) =>
      candidate.textContent === m.welcome_template_conversion_action(),
  );

  await act(async () => {
    button?.click();
    // Let the conversion promise settle before reading the banner.
    await Promise.resolve();
  });

  const alert = container.querySelector('[role="alert"]');
  expect(alert?.textContent).toBe(
    m.notice_literature_note_template_conversion_unsupported({
      files: "templates/zotlit-note.liquid.md",
    }),
  );
  // The button stays available for the retry after the file is edited.
  expect(button?.disabled).toBe(false);
});

it("lists retained files and retries cleanup from the completed state", async () => {
  const { actions, container } = await render("upgraded", {
    templateConversionResult: {
      document: "Research templates/zotlit-profile.default.md",
      trashed: 2,
      pendingCleanup: ["Research templates/zotlit-note.liquid.md"],
    },
  });

  expect(container.textContent).toContain(
    "Research templates/zotlit-note.liquid.md",
  );
  const retry = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === m.welcome_template_cleanup_retry(),
  );
  expect(retry).toBeDefined();
  await act(() => retry?.click());
  expect(actions.retryTemplateCleanup).toHaveBeenCalledOnce();
});

async function render(
  mode: "fresh" | "upgraded",
  state: Partial<WelcomeState> = {},
): Promise<{
  actions: WelcomeActions;
  container: HTMLElement;
  store: WelcomeStore;
}> {
  const store = createWelcomeStore();
  store.setState({
    migrationPending: mode === "upgraded",
    connection: { status: "missing" },
    literatureFolder: "Literature",
    ...state,
  });
  const actions: WelcomeActions = {
    convertLiteratureNoteTemplates: vi.fn(async () => CONVERTED),
    dismiss: vi.fn(),
    retryTemplateCleanup: vi.fn(async () => {}),
    locateZotero: vi.fn(),
    openExternal: vi.fn(),
    openSettings: vi.fn(),
    pickFolder: vi.fn(),
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => {
    root!.render(
      createElement(
        WelcomeStoreProvider,
        { value: store },
        createElement(
          WelcomeActionsContext,
          { value: actions },
          createElement(Welcome),
        ),
      ),
    );
  });
  return { actions, container, store };
}
