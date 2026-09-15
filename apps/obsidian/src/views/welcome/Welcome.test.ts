// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DOCS_COMPANION } from "@/lib/constants";
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

describe("Welcome Companion setup", () => {
  it("shows the installation step and link in fresh onboarding", async () => {
    const { actions, container } = await render("fresh");
    const button = [...container.querySelectorAll("button")].find(
      (candidate) =>
        candidate.textContent === m.welcome_action_install_companion(),
    );

    expect(container.textContent).toContain(m.welcome_step_companion_title());
    await act(() => button?.click());
    expect(actions.openExternal).toHaveBeenCalledWith(DOCS_COMPANION);
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

  it("shows Zotero 10 Companion guidance and link in upgraded onboarding", async () => {
    const { actions, container } = await render("upgraded");
    const button = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Open installation guide",
    );

    expect(container.textContent).toContain("Keep Zotero 10 changes available");
    expect(container.textContent).toContain(
      "Install or update ZotLit Companion, the Zotero add-on, so ZotLit reads recent changes from Zotero 10.",
    );
    await act(() => button?.click());
    expect(actions.openExternal).toHaveBeenCalledWith(DOCS_COMPANION);
  });
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
    mode,
    literatureFolder: "Literature",
    ...state,
  });
  const actions: WelcomeActions = {
    convertLiteratureNoteTemplates: vi.fn(async () => CONVERTED),
    retryTemplateCleanup: vi.fn(async () => {}),
    locateZotero: vi.fn(),
    openExternal: vi.fn(),
    openSettings: vi.fn(),
    pickFolder: vi.fn(),
    searchLibrary: vi.fn(),
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
