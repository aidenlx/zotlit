import { it } from "@effect/vitest";
// @vitest-environment happy-dom
import {
  ButtonComponent,
  ExtraButtonComponent,
  Menu,
  renderRow,
} from "@mock/obsidian";
import type { Setting } from "@mock/obsidian";
import { Effect, Layer, Queue } from "effect";
import { TFile } from "obsidian";
import type { App, Modal, SettingDefinitionList } from "obsidian";
import { expect, vi } from "vitest";

import { answerConfirmation } from "@/lib/__fixtures__/confirm";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { Vault } from "@/lib/obsidian-vault";
import { Template } from "@/services/template/service";
import type { CitationTemplateStatus } from "@/services/template/service";
import { openNewPartialPrompt } from "@/views/template-workbench/new-partial";
import { openTemplateWorkbench } from "@/views/template-workbench/register";

import { rebuildingSettingTab } from "./__fixtures__";
import type { SettingsKey, SettingTabContext } from "./context";
import { citationTextItems, partialItems } from "./templates";

vi.mock("@/views/template-workbench/register", () => ({
  openTemplateWorkbench: vi.fn(async () => {}),
}));
vi.mock("@/views/template-workbench/new-partial", () => ({
  openNewPartialPrompt: vi.fn(),
}));

/**
 * The tab context over `template` and `vault`, with a settings window that
 * closes through `close`. `rebuilt` takes one element per definition rebuild
 * an action asks for.
 */
const tabOver = Effect.fnUntraced(function* (
  template: Partial<Template["Service"]>,
  options: {
    vault?: Partial<Vault["Service"]>;
    close?: () => void;
  } = {},
) {
  const { tab, rebuilt } = yield* rebuildingSettingTab(
    Layer.merge(
      Layer.mock(Template, template),
      Layer.mock(Vault, options.vault ?? {}),
    ),
    options,
  );
  const app = stubService<App>("App", {});
  const ctx = stubService<SettingTabContext>("SettingTabContext", { tab, app });
  return { ctx, rebuilt };
});

const DEFAULT_STATUS: CitationTemplateStatus = {
  path: "Templates/zotlit-citation.md",
  customized: false,
  language: "liquid",
  inertPath: null,
  compileError: null,
};

/** The Citation text row as it renders for one Citation Template state. */
const citationRow = Effect.fnUntraced(function* (
  status: CitationTemplateStatus,
) {
  const { ctx } = yield* tabOver({
    loaded: Effect.succeed(true),
    getCitationTemplateStatus: Effect.succeed(status),
  });
  const [row] = citationTextItems(ctx);
  if (!row) throw new Error("Expected one Citation text render row");
  return renderRow(row);
});

/** The row's description, as `setDesc` received it. */
function description(setting: Setting): DocumentFragment {
  return setting.desc as unknown as DocumentFragment;
}

function tooltips(setting: Setting): string[] {
  return setting.components
    .filter((control) => control instanceof ButtonComponent)
    .map((button) => button.tooltip);
}

it.effect(
  "reads as the built-in default and offers Open alone until a document exists",
  () =>
    Effect.gen(function* () {
      const setting = yield* citationRow(DEFAULT_STATUS);

      expect(description(setting).textContent).toContain(
        m.settings_template_using_default(),
      );
      expect(description(setting).textContent).not.toContain(
        DEFAULT_STATUS.path,
      );
      expect(tooltips(setting)).toEqual([m.settings_citation_text_open()]);
    }),
);

it.effect("names the document and adds Reset once the vault holds one", () =>
  Effect.gen(function* () {
    const setting = yield* citationRow({ ...DEFAULT_STATUS, customized: true });

    expect(description(setting).querySelector("code")?.textContent).toBe(
      DEFAULT_STATUS.path,
    );
    expect(description(setting).textContent).not.toContain(
      m.settings_template_using_default(),
    );
    expect(tooltips(setting)).toEqual([
      m.settings_citation_text_open(),
      m.settings_template_reset(),
    ]);
  }),
);

it.effect(
  "warns on the row when the document is inert or fails to compile",
  () =>
    Effect.gen(function* () {
      const inert = yield* citationRow({
        ...DEFAULT_STATUS,
        customized: true,
        language: "eta",
        inertPath: DEFAULT_STATUS.path,
      });
      expect(description(inert).textContent).toContain(
        m.settings_template_inert_eta({ path: DEFAULT_STATUS.path }),
      );

      const broken = yield* citationRow({
        ...DEFAULT_STATUS,
        customized: true,
        compileError: "Unexpected token",
      });
      expect(description(broken).textContent).toContain("Unexpected token");
    }),
);

const AUTHORS = {
  name: "authors",
  path: "Templates/zotlit-partial.authors.md",
  language: "liquid",
} as const;
const VENUE = {
  name: "venue-line",
  path: "Templates/zotlit-partial.venue-line.md",
  language: "liquid",
} as const;

/** The Partials list of the Profiles page. */
function partialList(
  ctx: SettingTabContext,
): SettingDefinitionList<SettingsKey> {
  const list = partialItems(ctx).find(
    (row): row is SettingDefinitionList<SettingsKey> =>
      "type" in row && row.type === "list",
  );
  if (!list) throw new Error("Expected the Partials list");
  return list;
}

it.effect("offers Open for each partial", () =>
  Effect.gen(function* () {
    const { ctx } = yield* tabOver({
      loaded: Effect.succeed(true),
      getPartialDocuments: Effect.succeed([AUTHORS, VENUE]),
      getReservedPartialFiles: Effect.succeed([]),
    });
    const list = partialList(ctx);

    expect(tooltips(renderRow(list.items![0]!))).toEqual([
      m.settings_partial_open(),
    ]);
    expect(tooltips(renderRow(list.items![1]!))).toEqual([
      m.settings_partial_open(),
    ]);
  }),
);

it.effect(
  "holds Delete in the row's menu and trashes the partial once confirmed",
  () =>
    Effect.gen(function* () {
      using _answer = answerConfirmation(true);
      const deletePartial = vi.fn(() => Effect.void);
      const { ctx, rebuilt } = yield* tabOver({
        loaded: Effect.succeed(true),
        getPartialDocuments: Effect.succeed([AUTHORS]),
        getReservedPartialFiles: Effect.succeed([]),
        deletePartial,
      });
      const more = renderRow(partialList(ctx).items![0]!)
        .components.filter((control) => control instanceof ExtraButtonComponent)
        .find((button) => button.icon === "more-horizontal")!;
      Object.assign(more, {
        extraSettingsEl: document.createElement("button"),
      });
      more.click();

      const menu = Menu.instances.at(-1)!;
      expect(menu.items.map((item) => item.title)).toEqual([
        m.settings_partial_delete(),
      ]);
      menu.items[0]!.click();
      yield* Queue.take(rebuilt);
      expect(deletePartial).toHaveBeenCalledWith("authors");
    }),
);

it.effect("closes settings only once Add partial has created a document", () =>
  Effect.gen(function* () {
    const close = vi.fn();
    const createPartial = vi.fn(() => Effect.succeed(new TFile()));
    const partialFile = new TFile();
    partialFile.path = AUTHORS.path;
    const { ctx, rebuilt } = yield* tabOver(
      {
        loaded: Effect.succeed(true),
        getPartialDocuments: Effect.succeed([]),
        getReservedPartialFiles: Effect.succeed([]),
        getPartialNames: Effect.succeed([]),
        getPartialDocument: () => Effect.succeed(AUTHORS),
        createPartial,
      },
      {
        vault: { getFileByPath: () => Effect.succeed(partialFile) },
        close,
      },
    );
    const promptAnswers = (name: string | null) =>
      vi
        .mocked(openNewPartialPrompt)
        .mockImplementationOnce((_app, _taken, settle) => {
          settle(name);
          return stubService<Modal>("Modal", { close: () => {} });
        });
    const list = partialList(ctx);

    promptAnswers(null);
    list.addItem!.action(document.createElement("button"));
    yield* Queue.take(rebuilt);
    expect(createPartial).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(openTemplateWorkbench).not.toHaveBeenCalled();

    promptAnswers("authors");
    list.addItem!.action(document.createElement("button"));
    yield* Queue.take(rebuilt);
    expect(createPartial).toHaveBeenCalledWith("authors");
    expect(close).toHaveBeenCalled();
    expect(openTemplateWorkbench).toHaveBeenCalledWith(ctx.app, partialFile, {
      explainUnsupported: false,
    });
  }),
);
