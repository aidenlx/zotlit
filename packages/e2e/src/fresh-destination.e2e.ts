import { cp, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ITEMS } from "@zotlit/scripts/fixture";

import { prepareRunWindow } from "./background-throttling.ts";
import {
  reachable,
  runVaultScript,
  settingsContent,
  workspaceRoot,
} from "./e2e-run-fixture.ts";
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
import { obEval, obEvalUntil, waitFor } from "./obsidian-cli.ts";
import { PAGE } from "./page-gestures.ts";
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
    await obEval(
      vaultId,
      "app.plugins.plugins.zotlit.services.settings.update({'server.live-update':false});true",
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
    await obEval(
      vaultId,
      `(async function(){await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath(${JSON.stringify(first.path)}));return true;})()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        "app.commands.executeCommandById('zotlit:customize-note-template')",
        { expected: "true" },
      ),
    ).toBe(true);
    const defaultView =
      "app.workspace.getLeavesOfType('zotlit-template-workbench').find(leaf=>leaf.view.file?.path===app.plugins.plugins.zotlit.services.profile.defaultDocumentPath)?.view";
    await changeNativeAnnotationCallout(vaultId, {
      view: defaultView,
      vaultPath,
      tabLabel: m.workbench_tab_annotation(),
    });
    expect(await readFile(join(vaultPath, first.path), "utf-8")).toBe(original);

    const openAdd = async () => {
      await obEval(
        vaultId,
        `(async function(){var leaf=app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.view.file?.path===${JSON.stringify(first.path)});await app.workspace.revealLeaf(leaf);leaf.getContainer().focus();return true;})()`,
      );
      await openProfilesSettings(vaultId, "settings_page_profiles");
      expect(
        await obEvalUntil(
          vaultId,
          `(function(){${PAGE}var settings=${settingsContent};var button=Array.from(settings.querySelectorAll('[aria-label],button')).find(el=>el.getAttribute('aria-label')===${JSON.stringify(m.settings_profile_add())}||el.textContent.trim()===${JSON.stringify(m.settings_profile_add())});if(!button||button.disabled)return false;press(button,'Add profile');return true;})()`,
          { expected: "true" },
        ),
      ).toBe(true);
      expect(
        await obEvalUntil(
          vaultId,
          `String(Array.from(document.querySelectorAll('.modal-title')).some(el=>el.textContent===${JSON.stringify(m.settings_profile_add())}))`,
          { expected: "true" },
        ),
      ).toBe(true);
    };
    await openAdd();
    expect(await clickModalButton(vaultId, m.modal_cancel())).toBe(true);
    expect(
      await obEval(
        vaultId,
        "String(app.plugins.plugins.zotlit.services.profile.profiles.length)",
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
      await obEval(
        vaultId,
        `(function(){var modal=Array.from(document.querySelectorAll('.modal')).at(-1);var labels=Array.from(modal.querySelectorAll('label'));var name=labels.find(el=>el.textContent===${JSON.stringify(m.settings_profile_name_name())})?.querySelector('input');var folder=labels.find(el=>el.textContent===${JSON.stringify(m.settings_profile_folder_name())})?.querySelector('input');return String(!!name&&!!folder&&name.tabIndex===0&&folder.tabIndex===0&&name===name.ownerDocument.activeElement);})()`,
      ),
    ).toBe("true");
    const fill = async (name: string, folder: string) => {
      await obEval(
        vaultId,
        `(function(){var modal=Array.from(document.querySelectorAll('.modal')).at(-1);var values=${JSON.stringify([name, folder])};Array.from(modal.querySelectorAll('input')).forEach((input,i)=>{input.value=values[i];input.dispatchEvent(new Event('input',{bubbles:true}));});return true;})()`,
      );
    };
    await fill("Default", "books");
    expect(
      await obEvalUntil(
        vaultId,
        `(function(){var modal=Array.from(document.querySelectorAll('.modal')).at(-1);var status=modal?.querySelector('[role=status]');var button=Array.from(modal?.querySelectorAll('button')??[]).find(el=>el.textContent===${JSON.stringify(m.settings_profile_add())});return String(status?.textContent===${JSON.stringify(m.settings_profile_name_invalid())}&&status.getBoundingClientRect().height>0&&button?.disabled);})()`,
        { expected: "true" },
      ),
    ).toBe(true);
    await fill("Books", "books");
    expect(await clickModalButton(vaultId, m.settings_profile_add())).toBe(
      true,
    );
    expect(
      await obEvalUntil(
        vaultId,
        "String(app.plugins.plugins.zotlit.services.profile.profiles.some(p=>p.label==='Books'))",
        { expected: "true" },
      ),
    ).toBe(true);
    const books = JSON.parse(
      await obEval(
        vaultId,
        "JSON.stringify(app.plugins.plugins.zotlit.services.profile.profiles.find(p=>p.label==='Books'))",
      ),
    ) as { id: string; path: string };
    const saved = await readFile(join(vaultPath, books.path), "utf-8");
    expect(saved).toContain("[!quote]");
    expect(saved).toContain("folder: books");
    const booksView = `app.workspace.getLeavesOfType('zotlit-template-workbench').find(leaf=>leaf.view.file?.path===${JSON.stringify(books.path)})?.view`;
    expect(
      await obEvalUntil(
        vaultId,
        `(function(){var view=${booksView};return String(view?.contentEl.querySelector('[role=tab][aria-selected=true]')?.textContent.trim()===${JSON.stringify(m.workbench_tab_name_and_folder())}&&Array.from(view.contentEl.querySelectorAll('input')).some(el=>el.value==='books'));})()`,
        { expected: "true" },
      ),
    ).toBe(true);

    await obEval(
      vaultId,
      `(async function(){var leaf=app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.view.file?.path===${JSON.stringify(first.path)});await app.workspace.revealLeaf(leaf);leaf.getContainer().focus();return true;})()`,
    );
    expect(
      await obEvalUntil(vaultId, "String(activeWindow===window)", {
        expected: "true",
      }),
    ).toBe(true);
    await obEval(
      vaultId,
      "app.commands.executeCommandById('zotlit:note-quick-switcher')",
    );
    expect(
      await obEvalUntil(
        vaultId,
        "String(!!activeDocument.querySelector('.prompt input'))",
        { expected: "true" },
      ),
    ).toBe(true);
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
