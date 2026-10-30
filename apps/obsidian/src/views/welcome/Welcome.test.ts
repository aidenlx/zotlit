// @vitest-environment happy-dom
// The Welcome View banner as it draws from its store: its header, its checklist
// of setup steps, its Help Links, and the template conversion and migration
// sections.
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { act } from "preact/test-utils";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DOCS_COMPANION } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import { ViewRegistryProvider } from "@/lib/view-atoms";
import type { LiteratureNoteTemplateMigrationResult } from "@/services/template/migration";

import { makeWelcomeHost } from "./__fixtures__";
import { WelcomeActionsContext } from "./actions";
import type { WelcomeActions } from "./actions";
import type { ConversionRun } from "./atoms";
import { WelcomeModelProvider } from "./model";
import type { WelcomeModel } from "./model";
import type { WelcomeState } from "./presentation";
import { Welcome } from "./Welcome";

let cleanup = new AsyncDisposableStack();

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
  await cleanup.disposeAsync();
  cleanup = new AsyncDisposableStack();
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
  // One lead sentence beside the action; the full explanation is folded
  // behind "How it works".
  expect(container.textContent).toContain(m.welcome_template_conversion_lead());
  const details = container.querySelector("details");
  expect(details?.open).toBe(false);
  expect(details?.querySelector("summary")?.textContent).toBe(
    m.welcome_how_it_works(),
  );
  expect(details?.textContent).toContain(
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

describe("Welcome setup checklist", () => {
  const CONNECTED = {
    status: "connected",
    path: "~/Zotero",
    itemCount: 1204,
  } as const;
  const headings = (container: HTMLElement) =>
    [...container.querySelectorAll('[role="heading"]')].map(
      (el) => el.textContent,
    );
  /** The checklist row of the step titled `title`. */
  function step(container: HTMLElement, title: string): HTMLElement {
    const heading = [...container.querySelectorAll('[role="heading"]')].find(
      (el) => el.textContent === title,
    );
    const row = heading?.closest<HTMLElement>("[data-welcome-step]");
    if (!row) throw new Error(`No step titled ${title}`);
    return row;
  }
  const isOpen = (container: HTMLElement, title: string) =>
    step(container, title).hasAttribute("data-open");
  const button = (container: HTMLElement, label: string) =>
    [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === label,
    );

  it("opens only the first step that isn't done, with its text and action", async () => {
    const { actions, container } = await render("fresh", {
      connection: CONNECTED,
    });
    expect(
      [
        m.welcome_step_connect_title(),
        m.welcome_step_folder_title(),
        m.welcome_step_library_title(),
      ].map((title) => isOpen(container, title)),
    ).toEqual([false, true, false]);
    const folder = step(container, m.welcome_step_folder_title());
    expect(folder.textContent).toContain(
      m.welcome_step_folder_body({ folder: "Literature" }),
    );
    await act(() => button(folder, m.welcome_action_pick_folder())?.click());
    expect(actions.pickFolder).toHaveBeenCalledOnce();
    // The library step is done, so its text stays folded away.
    expect(container.textContent).not.toContain(m.welcome_step_library_body());
  });

  it("keeps each done step's action within reach once setup is done", async () => {
    const { actions, container } = await render("fresh", {
      connection: CONNECTED,
      literatureFolderExists: true,
      requested: true,
      companionInstalled: true,
    });
    expect(container.querySelector("[data-open]")).toBeNull();
    await act(() =>
      button(container, m.welcome_action_open_settings())?.click(),
    );
    await act(() => button(container, m.welcome_action_pick_folder())?.click());
    await act(() => button(container, m.welcome_action_search())?.click());
    expect(actions.openSettings).toHaveBeenCalledOnce();
    expect(actions.pickFolder).toHaveBeenCalledOnce();
    expect(actions.searchLibrary).toHaveBeenCalledOnce();
  });

  it("folds the done steps into one Setup done line beside a notice, which Show steps opens", async () => {
    const { container } = await render("upgraded", {
      connection: CONNECTED,
      literatureFolderExists: true,
    });
    const folded = container.querySelector<HTMLElement>(
      "[data-welcome-setup-done]",
    );
    expect(folded?.textContent).toContain(m.welcome_setup_done());
    expect(folded?.textContent).toContain("~/Zotero");
    expect(folded?.textContent).toContain(
      m.welcome_setup_done_folder({ folder: "Literature" }),
    );
    expect(container.querySelector("[data-welcome-step]")).toBeNull();
    const show = button(container, m.welcome_show_steps())!;
    expect(show.getAttribute("aria-expanded")).toBe("false");
    await act(() => show.click());
    expect(show.getAttribute("aria-expanded")).toBe("true");
    expect(show.textContent).toBe(m.welcome_hide_steps());
    expect(
      [...container.querySelectorAll("[data-welcome-step]")].map((el) =>
        el.getAttribute("data-welcome-step"),
      ),
      // ZotLit Companion is optional: it does not keep setup from being done.
    ).toEqual(["done", "done", "done", "todo"]);
  });

  it("keeps the steps open when asked for, even beside a notice", async () => {
    const { container } = await render("upgraded", {
      connection: CONNECTED,
      literatureFolderExists: true,
      requested: true,
    });
    expect(container.querySelector("[data-welcome-setup-done]")).toBeNull();
    expect(container.querySelectorAll("[data-welcome-step]")).toHaveLength(4);
  });

  it("opens Connect while Zotero is missing, saying so beside the Locate action", async () => {
    const { actions, container } = await render("fresh");
    expect(isOpen(container, m.welcome_step_connect_title())).toBe(true);
    expect(isOpen(container, m.welcome_step_folder_title())).toBe(false);
    const connect = step(container, m.welcome_step_connect_title());
    expect(connect.textContent).toContain(m.welcome_step_connect_missing());
    await act(() => button(connect, m.welcome_action_locate())?.click());
    expect(actions.locateZotero).toHaveBeenCalledOnce();
  });

  it("says Connect is still checking in words", async () => {
    const { container } = await render("fresh", {
      connection: { status: "checking" },
      requested: true,
    });
    expect(
      step(container, m.welcome_step_connect_title()).textContent,
    ).toContain(m.welcome_step_connect_checking());
  });

  it("offers no search while the Library View says Zotero is not found, since its search box is gone", async () => {
    const { container } = await render("fresh", { notFound: true });
    expect(
      [...container.querySelectorAll("button")].map((el) => el.textContent),
    ).not.toContain(m.welcome_action_search());
  });

  it("leaves out the Connect step while the Library View says Zotero is not found", async () => {
    const { container } = await render("fresh", { notFound: true });
    expect(headings(container)).toEqual([
      "ZotLit",
      m.welcome_step_folder_title(),
      m.welcome_step_library_title(),
      m.welcome_step_companion_title(),
    ]);
  });

  it("recommends ZotLit Companion last, folded while a step before it is not done", async () => {
    const { container } = await render("fresh", { connection: CONNECTED });
    const companion = step(container, m.welcome_step_companion_title());
    expect(companion.hasAttribute("data-open")).toBe(false);
    expect(companion.textContent).toContain(
      m.welcome_step_companion_recommended(),
    );
  });

  it("opens ZotLit Companion once the other steps are done, with its installation guide", async () => {
    const { actions, container } = await render("fresh", {
      connection: CONNECTED,
      literatureFolderExists: true,
      requested: true,
    });
    const companion = step(container, m.welcome_step_companion_title());
    expect(companion.hasAttribute("data-open")).toBe(true);
    expect(companion.textContent).toContain(m.welcome_step_companion_body());
    await act(() =>
      button(companion, m.welcome_action_install_companion())?.click(),
    );
    expect(actions.openExternal).toHaveBeenCalledWith(DOCS_COMPANION);
  });

  it("marks ZotLit Companion done once Zotero lists it as installed", async () => {
    const { container } = await render("fresh", {
      connection: CONNECTED,
      literatureFolderExists: true,
      requested: true,
      companionInstalled: true,
    });
    const companion = step(container, m.welcome_step_companion_title());
    expect(companion.getAttribute("data-welcome-step")).toBe("done");
    expect(companion.textContent).toContain(
      m.welcome_step_companion_installed(),
    );
    expect(button(companion, m.welcome_action_install_companion())).toBe(
      undefined,
    );
  });
});

describe("Help Links", () => {
  /** The accessible name of a link: the element its `aria-labelledby` names, else its text. */
  function name(a: Element): string | null {
    const labelledBy = a.getAttribute("aria-labelledby");
    return labelledBy
      ? (a.ownerDocument.getElementById(labelledBy)?.textContent ?? null)
      : a.textContent;
  }
  /** Each link on the banner: its name, the page it names, and the page a click opens. */
  function links({
    actions,
    container,
  }: {
    actions: WelcomeActions;
    container: HTMLElement;
  }) {
    return [...container.querySelectorAll("a")].map((a) => {
      vi.mocked(actions.openExternal).mockClear();
      a.click();
      return [
        name(a),
        a.getAttribute("href"),
        vi.mocked(actions.openExternal).mock.calls,
      ];
    });
  }
  // The docs site of the test build is https://zotlit.aidenlx.site.
  const page = (label: string, url: string) => [label, url, [[url]]];
  const HELP_LINKS = [
    page("Getting started", "https://zotlit.aidenlx.site/docs"),
    page("Chat & discuss", "https://zotlit.aidenlx.site/community"),
    page("Star on GitHub", "https://github.com/aidenlx/zotlit"),
    page("Templates", "https://zotlit.aidenlx.site/docs/reference/templates"),
    page(
      "Citations",
      "https://zotlit.aidenlx.site/docs/how-to/insert-citations",
    ),
    page("Blog", "https://zotlit.aidenlx.site/blog"),
    page("Changelog", "https://zotlit.aidenlx.site/changelog"),
    page("Sponsor", "https://github.com/sponsors/aidenlx"),
  ];
  const DONE = {
    connection: { status: "connected", path: "~/Zotero", itemCount: 3 },
    literatureFolderExists: true,
  } as const;

  const MIGRATION_LINK = page(
    "Read the migration guide.",
    "https://zotlit.aidenlx.site/docs/how-to/migrate-from-v1",
  );

  it("ends with the migration guide in the fresh state, each link opening its own page", async () => {
    expect(links(await render("fresh"))).toEqual([
      ...HELP_LINKS,
      MIGRATION_LINK,
    ]);
  });

  it("shows the Help Links beside the Migration Prompt, leaving out the migration link it says", async () => {
    const banner = await render("upgraded", { v1TemplatesPresent: true });
    expect(banner.container.textContent).toContain(m.welcome_migration_title());
    expect(links(banner)).toEqual(HELP_LINKS);
  });

  it.each([
    [
      "the template conversion offer alone",
      { templateConversionPending: true },
    ],
    [
      "the conversion result alone",
      {
        templateConversionResult: {
          document: null,
          trashed: 1,
          pendingCleanup: ["templates/zt-note.eta.md"],
        },
      },
    ],
  ] satisfies [string, Partial<WelcomeState>][])(
    "shows the Help Links with %s",
    async (_, state) => {
      const banner = await render("fresh", { ...DONE, ...state });
      expect(banner.container.querySelector("[data-welcome-step]")).toBeNull();
      expect(links(banner)).toEqual([...HELP_LINKS, MIGRATION_LINK]);
    },
  );

  it("shows the Help Links on a banner asked for after setup", async () => {
    const banner = await render("fresh", { ...DONE, requested: true });
    expect(links(banner)).toEqual([...HELP_LINKS, MIGRATION_LINK]);
  });
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
  const { actions, container, converted } = await render("upgraded", {
    templateConversionPending: true,
    templateFolder: "templates",
  });
  vi.mocked(actions.convertLiteratureNoteTemplates).mockImplementationOnce(() =>
    converted({
      retry: false,
      result: {
        outcome: "refused",
        diagnostic: {
          code: "unsupported-legacy-template",
          message:
            "Legacy note template must contain one supported content insertion",
          difference: "content insertion",
          hint: "Keep one standard content render in the legacy note template.",
          files: ["templates/zotlit-note.liquid.md"],
        },
      },
    }),
  );
  const button = [...container.querySelectorAll("button")].find(
    (candidate) =>
      candidate.textContent === m.welcome_template_conversion_action(),
  );

  await act(() => button?.click());

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

describe("the update section", () => {
  const DONE = {
    connection: { status: "connected", path: "~/Zotero", itemCount: 3 },
    literatureFolderExists: true,
  } as const;

  it("says which version ZotLit updated to, and opens the Release Note on What's new", async () => {
    const { actions, container } = await render("fresh", {
      ...DONE,
      updatePending: true,
      version: "2.3.0",
    });
    expect(container.textContent).toContain("ZotLit updated to 2.3.0");
    expect(container.textContent).toContain(m.welcome_update_body());
    const whatsNew = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === m.welcome_update_action(),
    );
    await act(() => whatsNew?.click());
    expect(actions.openReleaseNote).toHaveBeenCalledOnce();
  });
});

async function render(
  mode: "fresh" | "upgraded",
  state: Partial<WelcomeState> = {},
): Promise<{
  actions: WelcomeActions;
  container: HTMLElement;
  store: { setState(patch: Partial<WelcomeState>): void };
  converted: (run: ConversionRun) => void;
}> {
  const host = cleanup.use(await makeWelcomeHost());
  const { registry } = host;
  const session = cleanup.use(host.openSession());
  const conversion = Atom.make<Atom.Type<WelcomeModel["conversion"]>>(
    AsyncResult.initial(),
  );
  cleanup.defer(registry.mount(conversion));
  // The banner runs the conversion command; here each gesture answers at once.
  const converted = (run: ConversionRun) =>
    registry.set(conversion, AsyncResult.success(run));
  const model = {
    conversion,
    state: Atom.make<WelcomeState>({
      ...session.state(),
      migrationPending: mode === "upgraded",
      connection: { status: "missing" },
      literatureFolder: "Literature",
      version: "2.2.0",
      ...state,
    }),
  };
  cleanup.defer(registry.mount(model.state));
  const store = {
    setState: (patch: Partial<WelcomeState>) =>
      registry.update(model.state, (s) => ({ ...s, ...patch })),
  };
  const actions: WelcomeActions = {
    convertLiteratureNoteTemplates: vi.fn(() =>
      converted({ retry: false, result: CONVERTED }),
    ),
    dismiss: vi.fn(),
    retryTemplateCleanup: vi.fn(() =>
      converted({ retry: true, result: CONVERTED }),
    ),
    locateZotero: vi.fn(),
    openExternal: vi.fn(),
    openReleaseNote: vi.fn(),
    openSettings: vi.fn(),
    pickFolder: vi.fn(),
    searchLibrary: vi.fn(),
    // The banner saves it in plugin data, which seeds the store.
    showSteps: vi.fn((shown: boolean) => store.setState({ stepsShown: shown })),
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => {
    root!.render(
      createElement(
        ViewRegistryProvider,
        { registry },
        createElement(
          WelcomeModelProvider,
          { value: model },
          createElement(
            WelcomeActionsContext,
            { value: actions },
            createElement(Welcome),
          ),
        ),
      ),
    );
  });
  return { actions, container, store, converted };
}
