import { cp, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ITEMS } from "@zotlit/scripts/fixture";

import { prepareRunWindow } from "./background-throttling.ts";
import { reachable, runVaultScript, workspaceRoot } from "./e2e-run-fixture.ts";
import {
  changeNativeAnnotationCallout,
  openProfilesSettings,
} from "./e2e-run-helpers.ts";
import {
  clickModalButton,
  createFixtureNote,
  indexedNote,
  pressPromptKey,
  selectItemSuggestion,
  selectSuggestion,
} from "./e2e-run-note-helpers.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";
import { waitFor } from "./obsidian-cli.ts";
import { clearVault, e2eVaultDir } from "./vault-script.ts";

describe.skipIf(!reachable)("Fresh destination flow", () => {
  const vaultPath = e2eVaultDir(workspaceRoot, "destination-vault");
  let vaultId = "";
  let m: typeof import("@obsidian-messages");

  beforeAll(async () => {
    m = await import("@obsidian-messages");
    await clearVault(runVaultScript, vaultPath);
    const pluginDir = join(vaultPath, ".obsidian", "plugins", "zotlit");
    await mkdir(pluginDir, { recursive: true });
    await cp(join(workspaceRoot, "apps", "obsidian", "dist-dev"), pluginDir, {
      recursive: true,
    });
    const created = await runVaultScript([
      "open",
      vaultPath,
      "--vault-case",
      "fresh",
    ]);
    vaultId = created.stdout.trim().split("\n")[0]!.trim();
    await prepareRunWindow(vaultId);
    await obRun(
      vaultId,
      async ({ zotlit }) => {
        zotlit.services.bridge.runSync(
          zotlit.services.settings.update({ "server.live-update": false }),
        );
        return String(true);
      },
      undefined,
    );
  }, 180000);

  afterAll(async () => {
    await runVaultScript(["remove", vaultPath, "--purge"]);
  }, 120000);

  it("creates Books from the edited Default appearance after cancelling a destination", async () => {
    const first = await createFixtureNote(vaultId, 46, "default");
    expect(first.outcome, JSON.stringify(first)).toBe("created");
    if (first.outcome !== "created")
      throw new Error("First Literature Note was not created");
    expect(first.path).toBe("literatures/rougierTenSimpleRules2014.md");
    const original = await readFile(join(vaultPath, first.path), "utf-8");
    expect(original).toContain("```zotquery");
    await obRun(
      vaultId,
      async ({ app }, { __typedArg0 }) => {
        await app.workspace
          .getLeaf(false)
          .openFile(app.vault.getFileByPath(__typedArg0)!);
        return String(true);
      },
      { __typedArg0: first.path },
    );
    await obRunUntil(
      vaultId,
      async ({ app }) => {
        return app.commands.executeCommandById(
          "zotlit:customize-note-template",
        );
      },
      undefined,
      { what: "fresh-destination.e2e.ts:75" },
    );
    await changeNativeAnnotationCallout(vaultId, {
      view: {
        path: await obRun(
          vaultId,
          ({ zotlit }) => zotlit.services.profile.defaultDocumentPath,
        ),
      },
      vaultPath,
      tabLabel: m.workbench_tab_annotation(),
    });
    expect(await readFile(join(vaultPath, first.path), "utf-8")).toBe(original);

    const openAdd = async () => {
      await obRun(
        vaultId,
        async ({ app }, { __typedArg0 }) => {
          var leaf = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (leaf) =>
                (leaf.view as import("obsidian").FileView).file?.path ===
                __typedArg0,
            );
          await app.workspace.revealLeaf(leaf!);
          leaf!.getContainer().focus();
          return String(true);
        },
        { __typedArg0: first.path },
      );
      await openProfilesSettings(vaultId, "settings_page_profiles");
      await obRunUntil(
        vaultId,
        async ({ app, page }, { __typedArg0, __typedArg1 }) => {
          const { press } = page;
          var settings = app.setting.containerEl;
          var button = Array.from(
            settings.querySelectorAll<HTMLButtonElement>("[aria-label],button"),
          ).find(
            (el) =>
              el.getAttribute("aria-label") === __typedArg0 ||
              el.textContent.trim() === __typedArg1,
          );
          if (!button || button.disabled) return false;
          press(button, "Add profile");
          return true;
        },
        {
          __typedArg0: m.settings_profile_add(),
          __typedArg1: m.settings_profile_add(),
        },
        { what: "fresh-destination.e2e.ts:97" },
      );
      await obRunUntil(
        vaultId,
        async (_context, { __typedArg0 }) => {
          return Array.from(document.querySelectorAll(".modal-title")).some(
            (el) => el.textContent === __typedArg0,
          );
        },
        { __typedArg0: m.settings_profile_add() },
        { what: "fresh-destination.e2e.ts:104" },
      );
    };
    await openAdd();
    expect(await clickModalButton(vaultId, m.modal_cancel())).toBe(true);
    expect(
      await obRun(
        vaultId,
        async ({ zotlit }) => {
          return String(String(zotlit.services.profile.profiles.length));
        },
        undefined,
      ),
    ).toBe("0");
    expect(
      (await readdir(vaultPath, { recursive: true }))
        .filter(
          (path) => path.includes("zotlit-profile.") && path.endsWith(".md"),
        )
        .map((path) => path.replaceAll("\\", "/")),
    ).toEqual(["templates/zotlit-profile.default.md"]);

    await openAdd();
    expect(
      await obRun(
        vaultId,
        async (_context, { __typedArg0, __typedArg1 }) => {
          var modal = Array.from(document.querySelectorAll(".modal")).at(-1)!;
          var labels = Array.from(modal.querySelectorAll("label"));
          var name = labels
            .find((el) => el.textContent === __typedArg0)
            ?.querySelector("input");
          var folder = labels
            .find((el) => el.textContent === __typedArg1)
            ?.querySelector("input");
          return String(
            String(
              !!name &&
                !!folder &&
                name.tabIndex === 0 &&
                folder.tabIndex === 0 &&
                name === name.ownerDocument.activeElement,
            ),
          );
        },
        {
          __typedArg0: m.settings_profile_name_name(),
          __typedArg1: m.settings_profile_folder_name(),
        },
      ),
    ).toBe("true");
    const fill = async (name: string, folder: string) => {
      await obRun(
        vaultId,
        async (_context, { __typedArg0 }) => {
          var modal = Array.from(document.querySelectorAll(".modal")).at(-1)!;
          var values = __typedArg0;
          Array.from(modal.querySelectorAll("input")).forEach((input, i) => {
            input.value = values[i]!;
            input.dispatchEvent(new Event("input", { bubbles: true }));
          });
          return String(true);
        },
        { __typedArg0: [name, folder] },
      );
    };
    await fill("Default", "books");
    await obRunUntil(
      vaultId,
      async (_context, { __typedArg0, __typedArg1 }) => {
        var modal = Array.from(document.querySelectorAll(".modal")).at(-1)!;
        var status = modal?.querySelector("[role=status]");
        var button = Array.from(modal?.querySelectorAll("button") ?? []).find(
          (el) => el.textContent === __typedArg0,
        );
        return (
          status?.textContent === __typedArg1 &&
          status.getBoundingClientRect().height > 0 &&
          button?.disabled
        );
      },
      {
        __typedArg0: m.settings_profile_add(),
        __typedArg1: m.settings_profile_name_invalid(),
      },
      { what: "fresh-destination.e2e.ts:142" },
    );
    await fill("Books", "books");
    expect(await clickModalButton(vaultId, m.settings_profile_add())).toBe(
      true,
    );
    await obRunUntil(
      vaultId,
      async ({ zotlit }) => {
        return zotlit.services.profile.profiles.some(
          (p) => p.label === "Books",
        );
      },
      undefined,
      { what: "fresh-destination.e2e.ts:153" },
    );
    const books = JSON.parse(
      await obRun(
        vaultId,
        async ({ zotlit }) => {
          return String(
            JSON.stringify(
              zotlit.services.profile.profiles.find((p) => p.label === "Books"),
            ),
          );
        },
        undefined,
      ),
    ) as { id: string; path: string };
    const saved = await readFile(join(vaultPath, books.path), "utf-8");
    expect(saved).toContain("[!quote]");
    expect(saved).toContain("folder: books");

    await obRunUntil(
      vaultId,
      async ({ page }, { __typedArg0, __typedArg1 }) => {
        var view = page.workbench({ path: __typedArg0 });
        return (
          view?.contentEl
            .querySelector("[role=tab][aria-selected=true]")
            ?.textContent.trim() === __typedArg1 &&
          Array.from(view!.contentEl.querySelectorAll("input")).some(
            (el) => el.value === "books",
          )
        );
      },
      {
        __typedArg0: books.path,
        __typedArg1: m.workbench_tab_name_and_folder(),
      },
      { what: "fresh-destination.e2e.ts:170" },
    );

    await obRun(
      vaultId,
      async ({ app }, { __typedArg0 }) => {
        var leaf = app.workspace
          .getLeavesOfType("markdown")
          .find(
            (leaf) =>
              (leaf.view as import("obsidian").FileView).file?.path ===
              __typedArg0,
          );
        await app.workspace.revealLeaf(leaf!);
        leaf!.getContainer().focus();
        return String(true);
      },
      { __typedArg0: first.path },
    );
    await obRunUntil(
      vaultId,
      async (_context) => {
        return activeWindow === window;
      },
      undefined,
      { what: "fresh-destination.e2e.ts:182" },
    );
    await obRun(
      vaultId,
      async ({ app }) => {
        return String(
          app.commands.executeCommandById("zotlit:note-quick-switcher"),
        );
      },
      undefined,
    );
    await obRunUntil(
      vaultId,
      async (_context) => {
        return !!activeDocument.querySelector(".prompt input");
      },
      undefined,
      { what: "fresh-destination.e2e.ts:191" },
    );
    const kahneman = ITEMS.find(({ itemID }) => itemID === 61)!;
    await selectItemSuggestion(vaultId, kahneman.title, kahneman.key);
    await pressPromptKey(vaultId, "Enter");
    const choice = await selectSuggestion(vaultId, "books/Kahneman2011.md");
    expect(choice).toContain("Books");
    expect(choice).toContain("books/Kahneman2011.md");
    await pressPromptKey(vaultId, "Enter");
    expect(
      await waitFor(async () =>
        (
          await readFile(
            join(vaultPath, "books/Kahneman2011.md"),
            "utf-8",
          ).catch(() => "")
        ).includes("Thinking, fast and slow"),
      ),
    ).toBe(true);
    const book = await readFile(
      join(vaultPath, "books/Kahneman2011.md"),
      "utf-8",
    );
    expect(book).toContain(`zotlit-profile: Books (${books.id})`);
    expect(await readFile(join(vaultPath, first.path), "utf-8")).toBe(original);
    expect(await indexedNote(vaultId, 46)).toEqual({
      indexedKey: first.indexedKey,
      path: first.path,
    });
  }, 180000);
});
