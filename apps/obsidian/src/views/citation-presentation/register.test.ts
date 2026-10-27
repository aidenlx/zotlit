import { it } from "@effect/vitest";
import {
  ButtonComponent,
  DropdownComponent,
  Modal,
  settingsOf,
  TextComponent,
} from "@mock/obsidian";
import { Effect, Exit, FileSystem, Scope } from "effect";
import type {
  App,
  Command,
  Menu as ObsidianMenu,
  MenuItem,
  Plugin,
} from "obsidian";
import { describe, expect, vi } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { createObsidianHost } from "@/lib/__fixtures__/obsidian-host";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { scopedBridge } from "@/lib/effect-bridge";
import * as m from "@/lib/i18n/generated/messages";
import { makeMetadataCache } from "@/lib/obsidian-metadata-cache";
import { makeWorkspace } from "@/lib/obsidian-workspace";
import { defaults } from "@/services/settings/schema";
import { zoteroPrefFixture } from "@/services/zotero-pref/__fixtures__";

import {
  citationPresentationFileMenu,
  registerCitationPresentation,
  setCitationPresentation,
} from "./register";
import type { CitationPresentationDeps } from "./register";

const STYLE = "http://www.zotero.org/styles/test-style";
const styles = FileSystem.makeNoop({
  readDirectory: (path) =>
    Effect.succeed(path === "/zotero/styles" ? ["test-style.csl"] : []),
  readFileString: () =>
    Effect.succeed(
      `<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text"><info><id>${STYLE}</id><title>Test style</title></info><citation><layout><text variable="title"/></layout></citation></style>`,
    ),
});

const setup = Effect.fn("citationPresentationTest")(function* (
  text = "A draft.\n",
) {
  const host = createObsidianHost({ "draft.md": text });
  const file = host.file("draft.md");
  host.workspace.activeFile = file;
  const app = stubService<App>("App", {
    vault: stubService<App["vault"]>("Vault", {
      process: host.vault.process.bind(host.vault),
    }),
    workspace: stubService<App["workspace"]>("Workspace", {
      getActiveFile: host.workspace.getActiveFile.bind(host.workspace),
      iterateAllLeaves: host.workspace.iterateAllLeaves.bind(host.workspace),
    }),
    metadataCache: stubService<App["metadataCache"]>("MetadataCache", {
      getFileCache: host.metadataCache.getFileCache.bind(host.metadataCache),
    }),
  });
  const scope = yield* Scope.make();
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
  const bridge = yield* scopedBridge.pipe(
    Effect.provideService(Scope.Scope, scope),
  );
  const { pref } = yield* zoteroPrefFixture(() => Effect.succeed(""), {
    profileDir: "/profile",
    dataDir: "/zotero",
  });
  const notifier = testNotifier();
  const deps: CitationPresentationDeps = {
    app,
    bridge,
    fileSystem: styles,
    workspace: yield* makeWorkspace(host.workspace),
    metadataCache: yield* makeMetadataCache(host.metadataCache),
    zoteroPref: pref,
    notifier: notifier.service,
    settings: {
      current: Effect.succeed({
        ...defaults,
        "citation.locale": "en-GB",
        "note.default-profile": {
          ...defaults["note.default-profile"],
          bindings: {
            ...defaults["note.default-profile"].bindings,
            "citation.references-style": STYLE,
          },
        },
      }),
    },
  };
  let command: Command | undefined;
  registerCitationPresentation(
    stubService<Pick<Plugin, "app" | "addCommand">>("Plugin", {
      app,
      addCommand: (value) => {
        command = value;
        return value;
      },
    }),
    deps,
  );
  if (!command) throw new Error("Command was not registered");
  const palette = command;
  return {
    host,
    file,
    app,
    deps,
    scope,
    notifier,
    offered: () => palette.checkCallback?.(true),
    perform: () => palette.checkCallback?.(false),
    menu: (source = "more-options") => {
      const items: { title: string; section: string; click: () => void }[] = [];
      const menu: ObsidianMenu = stubService<ObsidianMenu>("Menu", {
        addItem: (callback) => {
          const recorded = { title: "", section: "", click: () => {} };
          const item: MenuItem = stubService<MenuItem>("MenuItem", {
            setSection: (value) => {
              recorded.section = value;
              return item;
            },
            setTitle: (value) => {
              recorded.title =
                typeof value === "string" ? value : (value.textContent ?? "");
              return item;
            },
            setIcon: () => item,
            onClick: (clicked) => {
              recorded.click = () =>
                clicked(stubService<MouseEvent>("MouseEvent", {}));
              return item;
            },
          });
          callback(item);
          items.push(recorded);
          return menu;
        },
      });
      citationPresentationFileMenu(deps)(menu, {
        file,
        source,
        leaf: undefined,
        itemKey: null,
        noteKey: null,
      });
      return { items };
    },
    read: Effect.promise(() => host.vault.cachedRead(file)),
    open: () => setCitationPresentation(file, deps),
  };
});

function dialog() {
  const modal = Modal.instances.at(-1)!;
  const components = settingsOf(modal.contentEl).flatMap(
    (row) => row.components,
  );
  const language = components.find(
    (component): component is TextComponent =>
      component instanceof TextComponent,
  )!;
  const style = components.find(
    (component): component is DropdownComponent =>
      component instanceof DropdownComponent,
  )!;
  return {
    modal,
    language,
    style,
    confirm: () => {
      const button = components.find(
        (component): component is ButtonComponent =>
          component instanceof ButtonComponent &&
          component.text === m.citation_presentation_confirm(),
      )!;
      button.click();
    },
  };
}

const waitFor = (assertion: () => void) =>
  Effect.promise(() => vi.waitFor(assertion));

describe("Set citation presentation", () => {
  it.effect("is offered only for an active Markdown note", () =>
    Effect.gen(function* () {
      const vault = yield* setup();
      expect(vault.offered()).toBe(true);
      vault.host.workspace.activeFile = null;
      expect(vault.offered()).toBe(false);
      vault.host.workspace.activeFile = vault.file;
      vault.file.extension = "canvas";
      expect(vault.offered()).toBe(false);
    }),
  );

  it.effect(
    "opens on the note's style and language with the vault locale as its placeholder",
    () =>
      Effect.gen(function* () {
        const vault = yield* setup(
          "---\nzotlit-csl: http://www.zotero.org/styles/note-numbered\nlang: de-DE\n---\nDraft.\n",
        );
        const pending = vault.open();
        const opened = dialog();
        expect(opened.style.getValue()).toBe(
          "http://www.zotero.org/styles/note-numbered",
        );
        expect(opened.language.getValue()).toBe("de-DE");
        expect(opened.language.inputEl.placeholder).toBe("en-GB");
        opened.modal.close();
        yield* Effect.promise(() => pending);
      }),
  );

  it.effect(
    "confirms the palette dialog and writes the note's language, keeping its other properties",
    () =>
      Effect.gen(function* () {
        const vault = yield* setup("---\ntitle: Draft\n---\nA draft.\n");
        vault.perform();
        const opened = dialog();
        expect(opened.style.getValue()).toBe("");
        expect(opened.language.getValue()).toBe("");
        yield* waitFor(() =>
          expect(
            opened.style.options.some((option) => option.value === STYLE),
          ).toBe(true),
        );
        expect(opened.style.options[0]?.label).toBe(
          m.citation_presentation_style_inherited({ style: "Test style" }),
        );
        opened.style.choose(STYLE);
        opened.language.setValue("de-DE");
        opened.confirm();
        yield* waitFor(() =>
          expect(
            vault.host.metadataCache.getFileCache(vault.file)?.frontmatter,
          ).toEqual({ title: "Draft", lang: "de-DE", "zotlit-csl": STYLE }),
        );
        expect(vault.notifier.notices).toEqual([]);
      }),
  );

  it.effect("dismisses without changing the note", () =>
    Effect.gen(function* () {
      const vault = yield* setup();
      const pending = vault.open();
      dialog().language.setValue("de-DE");
      dialog().modal.close();
      yield* Effect.promise(() => pending);
      expect(yield* vault.read).toBe("A draft.\n");
      expect(vault.notifier.notices).toEqual([]);
    }),
  );

  it.effect("reports a note write failure through the Notifier (#1858)", () =>
    Effect.gen(function* () {
      const vault = yield* setup();
      vault.app.vault.process = async () => {
        throw new Error("Disk is full");
      };
      const pending = vault.open();
      dialog().language.setValue("de-DE");
      dialog().confirm();
      yield* Effect.promise(() => pending);
      expect(yield* vault.read).toBe("A draft.\n");
      expect(vault.notifier.notices.map((notice) => notice.messages)).toEqual([
        [m.notice_citation_presentation_failed()],
      ]);
    }),
  );

  it.effect(
    "closes a pending dialog on unload without changing the note (#1858)",
    () =>
      Effect.gen(function* () {
        const vault = yield* setup();
        const pending = vault.open();
        const opened = dialog();
        opened.language.setValue("de-DE");
        expect(opened.modal.isOpen).toBe(true);
        yield* Scope.close(vault.scope, Exit.void);
        expect(opened.modal.isOpen).toBe(false);
        yield* Effect.promise(() => pending);
        expect(yield* vault.read).toBe("A draft.\n");
        expect(vault.notifier.notices).toEqual([]);
      }),
  );

  it.effect("confirms from the note's More options menu", () =>
    Effect.gen(function* () {
      const vault = yield* setup();
      expect(vault.menu("file-explorer-context-menu").items).toHaveLength(0);
      const item = vault.menu().items[0]!;
      expect(item.title).toBe(m.command_set_citation_presentation_name());
      expect(item.section).toBe("action");
      item.click();
      dialog().language.setValue("fr-FR");
      dialog().confirm();
      yield* waitFor(() =>
        expect(
          vault.host.metadataCache.getFileCache(vault.file)?.frontmatter?.lang,
        ).toBe("fr-FR"),
      );
      vault.file.extension = "canvas";
      expect(vault.menu().items).toHaveLength(0);
    }),
  );
});
