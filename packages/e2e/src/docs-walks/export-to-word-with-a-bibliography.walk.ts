// The walk of /learn Lesson 4, "Export your draft to Word with a reference
// list": a researcher sends `Chapter 3 - Presenting the results`, which cites
// three papers after Lesson 3, to a supervisor as a Word document in APA
// style, with a References list. Each `it` is one step of the lesson, in the
// lesson's order, named after it, and asserts what the lesson says the reader
// sees. Run it with `pnpm --filter @zotlit/e2e docs-walk`; see AGENTS.md.

import { obRun } from "@e2e/obsidian-cli.ts";
import type { PageApp } from "@e2e/page-host.ts";
import { isObsidianReachable } from "@e2e/vault-script.ts";
import { execFile } from "node:child_process";
import { mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  FileSystemAdapter,
  MarkdownView,
  View,
  WorkspaceLeaf,
} from "obsidian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import {
  captureRequested,
  closeWelcome,
  openDocsWalk,
  readNotices,
  watchNotices,
} from "./docs-walk.ts";
import type { DocsWalk } from "./docs-walk.ts";

const execFileAsync = promisify(execFile);
const root = await getWorkspaceRoot(import.meta.dirname);
const reachable = await isObsidianReachable(root);
const m = await import("@obsidian-messages");

const SLUG = "export-to-word-with-a-bibliography";
/** The thesis chapter of the docs Vault Case; it already cites two papers. */
const DRAFT = "Thesis/Chapter 3 - Presenting the results.md";
const EXPORTED = DRAFT.replace(/\.md$/, ".docx");
const EXPORTED_NAME = "Chapter 3 - Presenting the results.docx";
/** The section Lesson 3 added, with its citation and page. */
const LESSON_3 =
  "## 3.3 Keeping each figure reproducible\n\nEvery figure in this chapter comes from a script that records how it ran [@sandve2013, p. 2].\n\n";
/** The chapter's private notes, which the reader takes out before sending it. */
const NOTES_TO_SELF = "## Notes to self";
const APA = "http://www.zotero.org/styles/apa";
const APA_TITLE = "APA Style 7th edition";
const VAULT_STYLE = "Default (Chicago author-date)";
/** What the supervisor reads in the exported chapter, in APA style. */
const IN_TEXT = [
  "(Rougier et al., 2014, p. 1)",
  "(Ioannidis, 2005)",
  "(Sandve et al., 2013, p. 2)",
];
/** The first words of each reference, in the order APA sorts them. */
const ENTRIES = [
  "Ioannidis, J. P. A. (2005). Why Most Published Research Findings Are False.",
  "Rougier, N. P., Droettboom, M., & Bourne, P. E. (2014). Ten Simple Rules for Better Figures.",
  "Sandve, G. K., Nekrutenko, A., Taylor, J., & Hovig, E. (2013). Ten Simple Rules for Reproducible Computational Research.",
];

type DraftLeaf = WorkspaceLeaf & { view: MarkdownView };
/** The file explorer's rows, by path. */
type ExplorerLeaf = WorkspaceLeaf & {
  view: View & {
    fileItems: Record<
      string,
      {
        selfEl: HTMLElement;
        collapsed?: boolean;
        setCollapsed?(collapsed: boolean): void;
      }
    >;
  };
};
/** Obsidian's "Show all file types" setting, by its config key. */
type ConfigVault = PageApp["vault"] & {
  getConfig(key: "showUnsupportedFiles"): boolean;
};

const STEP = { timeoutMs: 60000 };

/** The exported document as plain text, read back with the Pandoc CLI. */
async function plainText(file: string): Promise<string> {
  const { stdout } = await execFileAsync("pandoc", [
    file,
    "-t",
    "plain",
    "--wrap=none",
  ]);
  return stdout;
}

/** The export dialog's rows: each name, description and chosen option. */
function dialogRows(
  vaultId: string,
): Promise<{ name: string; desc: string; value: string | null }[]> {
  return obRun(
    vaultId,
    (_, { title }) => {
      const el = [...document.querySelectorAll(".modal")].find(
        (d) => d.querySelector(".modal-title")?.textContent === title,
      )!;
      return [...el.querySelectorAll(".setting-item")].map((s) => ({
        name: s.querySelector(".setting-item-name")?.textContent ?? "",
        desc: s.querySelector(".setting-item-description")?.textContent ?? "",
        value:
          s.querySelector<HTMLSelectElement>("select:not(.is-measuring)")
            ?.selectedOptions[0]?.textContent ?? null,
      }));
    },
    { title: m.pandoc_export_title() },
  );
}

describe.skipIf(!reachable)(
  "Lesson 4: Export your draft to Word with a reference list",
  () => {
    let walk: DocsWalk;
    let vaultPath: string;

    beforeAll(async () => {
      walk = await openDocsWalk({
        slug: SLUG,
        collection: `learn/${SLUG}`,
        vaultCase: "docs",
      });
      vaultPath = await obRun(walk.vaultId, ({ app }) =>
        (app.vault.adapter as FileSystemAdapter).getBasePath(),
      );
      // The draft as Lesson 3 left it: a third section that cites Sandve et
      // al. 2013 with its page.
      await obRun(
        walk.vaultId,
        async ({ app }, { draft, section, notes }) => {
          const file = app.vault.getFileByPath(draft)!;
          await app.vault.process(file, (text) =>
            text.replace(notes, `${section}${notes}`),
          );
          app.workspace.leftSplit.collapse();
          const leaf = app.workspace.getLeaf("tab");
          await leaf.openFile(file);
          app.workspace.iterateRootLeaves((l) => {
            if (l !== leaf) l.detach();
          });
          app.workspace.setActiveLeaf(leaf, { focus: true });
        },
        { draft: DRAFT, section: LESSON_3, notes: NOTES_TO_SELF },
        STEP,
      );
      await watchNotices(walk.vaultId);
      // The reader closed the setup section in Lesson 1.
      await closeWelcome(walk.vaultId);
    });

    afterAll(async () => {
      await walk?.[Symbol.asyncDispose]();
    });

    it("step 1: remove lines meant only for you, such as a to-do list; a draft you can send", async () => {
      const body = await walk.record("step-1", () =>
        obRun(
          walk.vaultId,
          async ({ app, page }, { draft, notes }) => {
            const pointer = page.scratch.docsWalkPointer;
            const leaf = app.workspace
              .getLeavesOfType("markdown")
              .find(
                (l) => (l.view as MarkdownView).file?.path === draft,
              ) as DraftLeaf;
            const cm = leaf.view.editor.cm;
            const doc = cm.state.doc.toString();
            const at = doc.indexOf(notes);
            if (pointer) {
              // The reader drags from the notes' heading to the end, and
              // deletes the selection.
              const from = cm.coordsAtPos(at + 1)!;
              const to = cm.coordsAtPos(doc.length)!;
              await pointer.pointAt(from.left, (from.top + from.bottom) / 2);
              await pointer.park(to.right, (to.top + to.bottom) / 2);
              cm.dispatch({ selection: { anchor: at + 1, head: doc.length } });
              cm.focus();
              await new Promise((r) => setTimeout(r, 700));
            }
            cm.dispatch({
              changes: { from: at, to: doc.length, insert: "" },
              userEvent: "delete",
            });
            await leaf.view.save();
            leaf.view.editor.setCursor({ line: 0, ch: 0 });
            if (pointer) {
              const b = leaf.view.contentEl.getBoundingClientRect();
              await pointer.park(b.right - 14, b.bottom - 24);
            }
            return app.vault.read(leaf.view.file!);
          },
          { draft: DRAFT, notes: `\n${NOTES_TO_SELF}` },
        ),
      );
      expect(body).not.toContain(NOTES_TO_SELF);
      expect(body).not.toContain("- Redraw Figure 3.2");
      expect(body).toContain("[@rougier2014, p. 1]");
      expect(body).toContain("[@ioannidis2005]");
      expect(body).toContain("[@sandve2013, p. 2]");
      await walk.capture("step-1");
      await walk.compose("step-1");
    });

    it("step 2: open the command palette and run Export note with citations; a dialog, and Format is Word document", async () => {
      const ran = await walk.record("step-2", () =>
        obRun(
          walk.vaultId,
          async ({ app, page }, { draft, command, title }) => {
            const pointer = page.scratch.docsWalkPointer;
            const leaf = app.workspace
              .getLeavesOfType("markdown")
              .find(
                (l) => (l.view as MarkdownView).file?.path === draft,
              ) as DraftLeaf;
            app.workspace.setActiveLeaf(leaf, { focus: true });
            app.commands.executeCommandById("command-palette:open");
            const input = await page.until(
              "command palette",
              () =>
                activeDocument.querySelector<HTMLInputElement>(".prompt-input"),
              5000,
            );
            input.focus();
            if (pointer) {
              // The pointer rests below the palette, off its list.
              const b = input.getBoundingClientRect();
              await pointer.park(b.right + 40, b.top);
              await pointer.keys(
                command,
                (ch) => document.execCommand("insertText", false, ch),
                { speed: 2 },
              );
              await new Promise((r) => setTimeout(r, 500));
            } else document.execCommand("insertText", false, command);
            const item = await page.until(
              "the command",
              () =>
                [
                  ...activeDocument.querySelectorAll<HTMLElement>(
                    ".prompt .suggestion-item",
                  ),
                ].find((i) => i.innerText.includes(command)),
              5000,
            );
            const shown = item.innerText.replaceAll(/\s+/g, " ").trim();
            await page.trusted(window).key("Enter");
            await page.until(
              "export dialog",
              () =>
                [...document.querySelectorAll(".modal")].find(
                  (d) => d.querySelector(".modal-title")?.textContent === title,
                ),
              10000,
            );
            return shown;
          },
          {
            draft: DRAFT,
            command: m.command_pandoc_export_name(),
            title: m.pandoc_export_title(),
          },
          STEP,
        ),
      );
      expect(ran).toContain(m.command_pandoc_export_name());
      const rows = await dialogRows(walk.vaultId);
      console.log("[walk] dialog", JSON.stringify({ ran, rows }));
      expect(rows[0]).toEqual({
        name: m.pandoc_export_format_name(),
        desc: m.pandoc_export_format_desc(),
        value: m.pandoc_export_format_docx(),
      });
      expect(rows[1]).toMatchObject({
        name: m.pandoc_export_style_name(),
        desc: m.pandoc_export_style_from_vault(),
        value: VAULT_STYLE,
      });
      await walk.capture("step-2");
      await walk.compose("step-2");
    });

    it("step 3: choose the citation style you need, such as APA 7th edition; Only this export uses this style.", async () => {
      await walk.record("step-3", () =>
        obRun(
          walk.vaultId,
          async ({ page }, { title, apa }) => {
            const pointer = page.scratch.docsWalkPointer;
            const el = [...document.querySelectorAll(".modal")].find(
              (d) => d.querySelector(".modal-title")?.textContent === title,
            )!;
            const style = el
              .querySelectorAll(".setting-item")[1]!
              .querySelector<HTMLSelectElement>("select:not(.is-measuring)")!;
            await page.until(
              "installed styles",
              () => style.querySelector(`option[value="${apa}"]`),
              10000,
            );
            await pointer?.point(style);
            await page.pick(style, apa, "Citation style");
            if (pointer) {
              // The pointer leaves the row's new description in view.
              const b = style.getBoundingClientRect();
              await pointer.park(b.right - 20, b.bottom + 40);
            }
          },
          { title: m.pandoc_export_title(), apa: APA },
          STEP,
        ),
      );
      const rows = await dialogRows(walk.vaultId);
      expect(rows[1]).toEqual({
        name: m.pandoc_export_style_name(),
        desc: m.pandoc_export_style_changed({ style: VAULT_STYLE }),
        value: APA_TITLE,
      });
      expect(
        rows[1]!.desc.startsWith("Only this export uses this style."),
      ).toBe(true);
      await walk.capture("step-3");
      await walk.compose("step-3");
    });

    it("step 4: select Export; a notice with the file name and the style", async () => {
      const notices = await walk.record("step-4", () =>
        obRun(
          walk.vaultId,
          async ({ page }, { title, done, failed }) => {
            const pointer = page.scratch.docsWalkPointer;
            const dialog = [...document.querySelectorAll(".modal")].find(
              (d) => d.querySelector(".modal-title")?.textContent === title,
            );
            const button = await page.stands(
              dialog?.querySelector<HTMLElement>("button.mod-cta"),
              "Export",
            );
            await pointer?.point(button);
            const at = button.getBoundingClientRect();
            page.press(button, "Export");
            await page.until(
              "export ends",
              () =>
                page.scratch.docsWalkNotices!.some(
                  (t) => t.startsWith(done) || t.startsWith(failed),
                ),
              60000,
            );
            // The pointer leaves the notice in the top right corner clear.
            await pointer?.park(at.left, at.bottom);
            return page.scratch.docsWalkNotices!;
          },
          {
            title: m.pandoc_export_title(),
            done: m
              .notice_pandoc_export_done({ file: "", style: "" })
              .split(" ")[0]!,
            failed: m.notice_pandoc_export_failed(),
          },
          { timeoutMs: 90000 },
        ),
      );
      expect(notices).toContain(
        m.notice_pandoc_export_done({ file: EXPORTED_NAME, style: APA_TITLE }),
      );
      expect((await stat(join(vaultPath, EXPORTED))).size).toBeGreaterThan(0);
      expect(await readNotices(walk.vaultId)).toContain(
        m.notice_pandoc_export_done({ file: EXPORTED_NAME, style: APA_TITLE }),
      );
      await walk.capture("step-4", { notices: true });
      await walk.compose("step-4");
    });

    it("step 5: open the Word file beside your note; formatted citations and a References list at the end", async () => {
      const docx = join(vaultPath, EXPORTED);
      const text = await plainText(docx);
      for (const citation of IN_TEXT) expect(text).toContain(citation);
      // The References list closes the document under its own heading.
      const at = text.indexOf("\nReferences\n");
      expect(at).toBeGreaterThan(text.indexOf(IN_TEXT.at(-1)!));
      const entries = text
        .slice(at)
        .split("\n")
        .slice(2)
        .filter((line) => line.trim());
      expect(entries).toHaveLength(ENTRIES.length);
      ENTRIES.forEach((entry, i) => expect(entries[i]).toContain(entry));
      // Fact f: what Obsidian's file explorer shows for the Word file, as
      // installed: Show all file types is off by default.
      const explorer = await obRun(
        walk.vaultId,
        async ({ app }, { exported }) => {
          app.workspace.leftSplit.expand();
          const ex = app.workspace.getLeavesOfType(
            "file-explorer",
          )[0] as ExplorerLeaf;
          const folder = ex.view.fileItems["Thesis"]!;
          if (folder.collapsed) folder.setCollapsed!(false);
          await new Promise((r) => setTimeout(r, 300));
          const row = ex.view.fileItems[exported]?.selfEl;
          return {
            showAll: (app.vault as ConfigVault).getConfig(
              "showUnsupportedFiles",
            ),
            listed: !!row,
            shown: (row?.getBoundingClientRect().height ?? 0) > 0,
            inVault: !!app.vault.getFileByPath(exported),
          };
        },
        { exported: EXPORTED },
      );
      console.log("[walk] explorer", JSON.stringify(explorer));
      expect(explorer).toEqual({
        showAll: false,
        listed: explorer.listed,
        shown: false,
        inVault: true,
      });
      // OUTLINE-MISMATCH: Obsidian opens no Word file; the reader opens it
      // in Word from Finder or Explorer. The image is the document's first
      // page as macOS Quick Look draws it.
      if (captureRequested()) {
        const captures = join(root, ".scratch", "docs-walks", SLUG);
        await mkdir(captures, { recursive: true });
        await execFileAsync("qlmanage", [
          "-t",
          "-s",
          "3000",
          "-o",
          captures,
          docx,
        ]);
        await rename(
          join(captures, `${EXPORTED_NAME}.png`),
          join(captures, "step-5-document.png"),
        );
        await walk.compose("step-5");
      }
    });
  },
);
