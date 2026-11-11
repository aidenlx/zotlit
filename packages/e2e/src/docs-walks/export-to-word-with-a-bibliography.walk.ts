// The walk of the lesson apps/docs/content/docs/cite-and-export/
// export-to-word-with-a-bibliography.mdx: a researcher has a thesis chapter
// with citations and sends it to a supervisor as a Word document, in the
// supervisor's citation style, with a bibliography. Each `it` is one step of
// the page, in the page's order, and asserts what the page says the reader
// sees. Run it with `pnpm --filter @zotlit/e2e docs-walk`; see AGENTS.md.

import { clearNotices, cli, obRun } from "@e2e/obsidian-cli.ts";
import type { PageApp } from "@e2e/page-host.ts";
import { isObsidianReachable } from "@e2e/vault-script.ts";
import { execFile } from "node:child_process";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type {
  FileSystemAdapter,
  MarkdownView,
  View,
  WorkspaceLeaf,
} from "obsidian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { captureRequested, openDocsWalk, watchNotices } from "./docs-walk.ts";
import type { DocsWalk } from "./docs-walk.ts";

const execFileAsync = promisify(execFile);
const root = await getWorkspaceRoot(import.meta.dirname);
const reachable = await isObsidianReachable(root);
const m = await import("@obsidian-messages");

const SLUG = "export-to-word-with-a-bibliography";
/** The thesis chapter of the docs Vault Case; it already cites two papers. */
const DRAFT = "Thesis/Chapter 3 - Presenting the results.md";
const EXPORTED = DRAFT.replace(/\.md$/, ".docx");
/** The papers the reader cites through a literature note link. */
const LINKED = [
  { citekey: "sandve2013", key: "DCSNDART" },
  { citekey: "wilson2014", key: "DCWLSART" },
];
/**
 * The section the reader adds: a literature note link with a page, and a
 * literature note link written inside another citation.
 */
const SECTION =
  "## 3.3 Keeping the analysis reproducible\n\nEvery figure in this chapter comes from a script kept under version control [[sandve2013#cite:locator=2]]. The analysis plan was registered before the data came in [@munafo2017, building on [[wilson2014|Wilson and colleagues]]].\n";
/** The chapter's private notes, which the reader takes out before sending it. */
const NOTES_TO_SELF = "## Notes to self";
/** A citation key with a typo: the likely failure. */
const TYPO = "ioannidis2015";
const APA = "http://www.zotero.org/styles/apa";
const APA_TITLE = "APA Style 7th edition";
const VAULT_STYLE = "Default (Chicago author-date)";
/** What the supervisor reads in the exported chapter, in APA style. */
const IN_TEXT = [
  "(Rougier et al., 2014, p. 1)",
  "(Ioannidis, 2005)",
  "(Sandve et al., 2013, p. 2)",
  "(Munafò et al., 2017, building on Wilson and colleagues)",
];
/** The first words of each bibliography entry, in the order APA sorts them. */
const ENTRIES = [
  "Ioannidis, J. P. A. (2005). Why Most Published Research Findings Are False.",
  "Munafò, M. R.",
  "Rougier, N. P., Droettboom, M., & Bourne, P. E. (2014). Ten Simple Rules for Better Figures.",
  "Sandve, G. K., Nekrutenko, A., Taylor, J., & Hovig, E. (2013). Ten Simple Rules for Reproducible Computational Research.",
  "Wilson, G., Aruliah, D. A.",
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
  setConfig(key: "showUnsupportedFiles", value: boolean): void;
};

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

describe.skipIf(!reachable)(
  "Export a cited note to Word with a bibliography",
  () => {
    let walk: DocsWalk;
    let vaultPath: string;

    /** Opens the export dialog on the draft and answers its rows. */
    function openDialog(): Promise<{ name: string; desc: string }[]> {
      return obRun(
        walk.vaultId,
        async ({ app, page }, { draft, title }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === draft,
            ) as DraftLeaf;
          app.workspace.setActiveLeaf(leaf, { focus: true });
          app.commands.executeCommandById("zotlit:pandoc-export");
          const el = await page.until(
            "export dialog",
            () =>
              [...document.querySelectorAll(".modal")].find(
                (d) => d.querySelector(".modal-title")?.textContent === title,
              ),
            10000,
          );
          return [...el.querySelectorAll(".setting-item")].map((s) => ({
            name: s.querySelector(".setting-item-name")?.textContent ?? "",
            desc:
              s.querySelector(".setting-item-description")?.textContent ?? "",
          }));
        },
        { draft: DRAFT, title: m.pandoc_export_title() },
      );
    }

    /** Presses Export and answers the notices once the export has ended. */
    async function pressExport(): Promise<string[]> {
      // A notice still on screen from an earlier export would answer first.
      await clearNotices(walk.vaultId);
      await watchNotices(walk.vaultId);
      return obRun(
        walk.vaultId,
        async ({ page }, { title, done, failed }) => {
          const dialog = [...document.querySelectorAll(".modal")].find(
            (d) => d.querySelector(".modal-title")?.textContent === title,
          );
          page.press(
            dialog?.querySelector<HTMLElement>("button.mod-cta"),
            "Export",
          );
          await page.until(
            "export ends",
            () =>
              page.scratch.docsWalkNotices!.some(
                (t) => t.startsWith(done) || t.startsWith(failed),
              ),
            60000,
          );
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
      );
    }

    /** The draft's text on disk. */
    function readDraft(): Promise<string> {
      return obRun(
        walk.vaultId,
        ({ app }, { draft }) => app.vault.read(app.vault.getFileByPath(draft)!),
        { draft: DRAFT },
      );
    }

    /** Replaces the draft's text, as the reader's typing would. */
    function editDraft(from: string, to: string): Promise<string> {
      return obRun(
        walk.vaultId,
        async ({ app }, { draft, from, to }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === draft,
            ) as DraftLeaf;
          const cm = leaf.view.editor.cm;
          const doc = cm.state.doc.toString();
          const at = doc.indexOf(from);
          if (at < 0) throw new Error(`not in the draft: ${from}`);
          cm.dispatch({
            changes: { from: at, to: at + from.length, insert: to },
            userEvent: "input.type",
          });
          await leaf.view.save();
          return app.vault.read(leaf.view.file!);
        },
        { draft: DRAFT, from, to },
      );
    }

    beforeAll(async () => {
      walk = await openDocsWalk({
        slug: SLUG,
        collection: `cite-and-export/${SLUG}`,
        vaultCase: "docs",
      });
      vaultPath = await obRun(walk.vaultId, ({ app }) =>
        (app.vault.adapter as FileSystemAdapter).getBasePath(),
      );
      await watchNotices(walk.vaultId);
      // The reader made literature notes for the papers they link to, as the
      // lesson "Create a literature note" teaches.
      for (const { citekey, key } of LINKED) {
        const created = await obRun(
          walk.vaultId,
          async ({ zotlit }, { key }) => {
            const services = zotlit.services;
            const hits = await services.itemLookup.search("", { limit: 100 });
            const hit = hits.find((h) => h.item.key === key);
            if (!hit) throw new Error(`no item ${key}`);
            const result = await services.noteFeature.createNote(hit.item, {});
            return result.outcome === "created" ? result.file.path : "refused";
          },
          { key },
        );
        expect(created).toBe(`literatures/${citekey}.md`);
      }
      await obRun(
        walk.vaultId,
        async ({ app }, { draft }) => {
          const leaf = app.workspace.getLeaf("tab");
          await leaf.openFile(app.vault.getFileByPath(draft)!);
          app.workspace.setActiveLeaf(leaf, { focus: true });
        },
        { draft: DRAFT },
      );
    });

    afterAll(async () => {
      await walk?.[Symbol.asyncDispose]();
    });

    it("finds the Pandoc engine installed on the Citations settings page", async () => {
      // The engine is installed once per computer, so a reader who has seen
      // formatted citations in Obsidian already has it. Never uninstalled
      // here: it would leave this computer's other vaults without it.
      const version = await obRun(walk.vaultId, ({ zotlit }) => {
        const h = zotlit.services.pandocEngine;
        const s = h.runSync(h.binary.getStatus);
        return s.kind === "installed" ? s.version : "not installed";
      });
      const row = await obRun(
        walk.vaultId,
        async ({ app, page }, { citationsName, engineName, expected }) => {
          app.vault.setConfig("settingsPopoutWindow", false);
          app.setting.open();
          app.setting.openTabById("zotlit");
          const named = (name: string) =>
            [
              ...app.setting.modalEl.querySelectorAll<HTMLElement>(
                ".setting-item",
              ),
            ].find(
              (s) =>
                s.querySelector(".setting-item-name")?.textContent === name,
            );
          const citations = await page.until(
            "Citations row",
            () => named(citationsName),
            5000,
          ); // The page list sits below the window's fold; the reader scrolls to it.
          citations.scrollIntoView({ block: "center", behavior: "instant" });
          await new Promise((r) => requestAnimationFrame(r));
          page.press(citations, "Citations");
          const row = await page.until(
            "engine row",
            () => named(engineName),
            5000,
          );
          row.scrollIntoView({ block: "center", behavior: "instant" });
          await page.stands(row, "engine row");
          // The row's description paints after the row itself.
          const desc = () =>
            row.querySelector(".setting-item-description")?.textContent ?? "";
          await page
            .until("engine status", () => desc().includes(expected), 5000)
            .catch(() => undefined);
          return desc();
        },
        {
          citationsName: m.settings_page_citations(),
          engineName: m.settings_citation_engine_name(),
          expected: m.settings_citation_engine_status_installed({ version }),
        },
      );
      expect(row).toContain(
        m.settings_citation_engine_status_installed({ version }),
      );
      await walk.capture("engine");
      await walk.compose("engine");
      await obRun(walk.vaultId, ({ app }) => {
        app.setting.close();
      });
    });

    it("finishes the draft: one more cited section, and no notes to self", async () => {
      await editDraft(NOTES_TO_SELF, `${SECTION}\n${NOTES_TO_SELF}`);
      // Everything in the note goes into the document, so the reader takes
      // out the notes meant for themselves before sending it.
      const body = await obRun(
        walk.vaultId,
        async ({ app }, { draft, notes }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find(
              (l) => (l.view as MarkdownView).file?.path === draft,
            ) as DraftLeaf;
          const cm = leaf.view.editor.cm;
          const doc = cm.state.doc.toString();
          const at = doc.indexOf(notes);
          cm.dispatch({
            changes: { from: at, to: doc.length, insert: "" },
            userEvent: "delete",
          });
          await leaf.view.save();
          return app.vault.read(leaf.view.file!);
        },
        { draft: DRAFT, notes: `\n${NOTES_TO_SELF}` },
      );
      expect(body).toContain(SECTION.trimEnd());
      expect(body).not.toContain(NOTES_TO_SELF);
      expect(body).toContain("[@rougier2014, p. 1]");
      expect(body).toContain("[@ioannidis2005]");
    });

    it("opens the export dialog on the vault style and picks the supervisor's style", async () => {
      const rows = await openDialog();
      expect(rows.slice(0, 3)).toEqual([
        {
          name: m.pandoc_export_format_name(),
          desc: m.pandoc_export_format_desc(),
        },
        {
          name: m.pandoc_export_style_name(),
          desc: m.pandoc_export_style_from_vault(),
        },
        {
          name: m.pandoc_export_destination_name(),
          desc: m.pandoc_export_destination_in_vault({
            path: EXPORTED,
            vault: await obRun(walk.vaultId, ({ app }) => app.vault.getName()),
          }),
        },
      ]);
      const picked = await obRun(
        walk.vaultId,
        async ({ page }, { title, apa }) => {
          const el = [...document.querySelectorAll(".modal")].find(
            (d) => d.querySelector(".modal-title")?.textContent === title,
          )!;
          const [format, style] = [...el.querySelectorAll(".setting-item")].map(
            (s) =>
              s.querySelector<HTMLSelectElement>("select:not(.is-measuring)"),
          );
          const starts = style!.selectedOptions[0]!.textContent;
          await page.until(
            "installed styles",
            () => style!.querySelector(`option[value="${apa}"]`),
            10000,
          );
          await page.pick(style, apa, "Citation style");
          return {
            format: format!.selectedOptions[0]!.textContent,
            style: style!.selectedOptions[0]!.textContent,
            starts,
            desc: el
              .querySelectorAll(".setting-item")[1]!
              .querySelector(".setting-item-description")!.textContent,
          };
        },
        { title: m.pandoc_export_title(), apa: APA },
      );
      expect(picked).toEqual({
        format: m.pandoc_export_format_docx(),
        starts: VAULT_STYLE,
        style: APA_TITLE,
        desc: m.pandoc_export_style_changed({ style: VAULT_STYLE }),
      });
      await walk.capture("export-dialog");
      await walk.compose("export-dialog");
    });

    it("saves a Word document beside the note, with formatted citations and a bibliography", async () => {
      const before = await readDraft();
      const notices = await pressExport();
      expect(notices).toContain(
        m.notice_pandoc_export_done({
          file: "Chapter 3 - Presenting the results.docx",
          style: APA_TITLE,
        }),
      );
      const docx = join(vaultPath, EXPORTED);
      expect((await stat(docx)).size).toBeGreaterThan(0);
      const text = await plainText(docx);
      for (const citation of IN_TEXT) expect(text).toContain(citation);
      // The bibliography closes the document under its own heading, one entry
      // per work, the nested Wilson et al. 2014 among them.
      const references = text.slice(text.indexOf("\nReferences\n"));
      expect(text.indexOf("\nReferences\n")).toBeGreaterThan(
        text.indexOf(IN_TEXT.at(-1)!),
      );
      const entries = references
        .split("\n")
        .slice(2)
        .filter((line) => line.trim());
      expect(entries).toHaveLength(ENTRIES.length);
      ENTRIES.forEach((entry, i) => expect(entries[i]).toContain(entry));
      // The Word document sits beside the note. Obsidian's file explorer
      // lists it once "Show all file types" is on.
      const explorer = await obRun(
        walk.vaultId,
        async ({ app, page }, { exported }) => {
          const ex = app.workspace.getLeavesOfType(
            "file-explorer",
          )[0] as ExplorerLeaf;
          const folder = ex.view.fileItems["Thesis"]!;
          if (folder.collapsed) folder.setCollapsed!(false);
          const row = () => ex.view.fileItems[exported]!.selfEl;
          const tall = () => row().getBoundingClientRect().height > 0;
          await new Promise((r) => setTimeout(r, 300));
          const hidden = !tall();
          (app.vault as ConfigVault).setConfig("showUnsupportedFiles", true);
          await page.until("docx row", tall, 5000);
          row().dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              clientX: 200,
              clientY: 280,
            }),
          );
          const menu = await page.until(
            "file menu",
            () => document.querySelector(".menu"),
            3000,
          );
          const items = [...menu.querySelectorAll(".menu-item-title")].map(
            (n) => n.textContent,
          );
          document.body.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
          menu.remove();
          return {
            hidden,
            shown: tall(),
            ext: row().querySelector(".nav-file-tag")?.textContent ?? null,
            menu: items,
          };
        },
        { exported: EXPORTED },
      );
      expect(explorer).toMatchObject({
        hidden: true,
        shown: true,
        ext: "docx",
      });
      expect(explorer.menu).toEqual(
        expect.arrayContaining(["Open in default app", "Reveal in Finder"]),
      );
      // The setting's name, as Obsidian's Files and links page shows it.
      const detect = await obRun(walk.vaultId, async ({ app, page }) => {
        app.setting.open();
        app.setting.openTabById("file");
        const names = await page.until(
          "Files and links rows",
          () => {
            const n = [
              ...app.setting.modalEl.querySelectorAll(".setting-item-name"),
            ].map((n) => n.textContent);
            return n.length ? n : null;
          },
          5000,
        );
        app.setting.close();
        return (
          names.find((n) => n === "Show all file types") ??
          JSON.stringify(names)
        );
      });
      expect(detect).toBe("Show all file types");
      await walk.capture("explorer");
      await walk.compose("explorer");
      // The note keeps its citations as written.
      expect(await readDraft()).toBe(before);

      if (captureRequested()) {
        // The document as the supervisor sees it: macOS Quick Look draws its
        // first page.
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
          join(captures, "Chapter 3 - Presenting the results.docx.png"),
          join(captures, "document.png"),
        );
        await walk.compose("exported-document");
      }
    });

    it("cites through a plain literature note link", async () => {
      // A plain link to a literature note exports as a citation, though
      // Wikilink citations is off.
      const extra =
        " A checklist such as [[sandve2013]] keeps the habit honest.";
      const end = "building on [[wilson2014|Wilson and colleagues]]].";
      await editDraft(end, end + extra);
      await openDialog();
      expect(await pressExport()).toContain(
        m.notice_pandoc_export_done({
          file: "Chapter 3 - Presenting the results.docx",
          style: VAULT_STYLE,
        }),
      );
      const text = await plainText(join(vaultPath, EXPORTED));
      expect(text).toContain("A checklist such as (Sandve et al. 2013) keeps");
      await editDraft(end + extra, end);
    });

    it("stops with the misspelled key named, and exports once the key is fixed", async () => {
      await editDraft("[@ioannidis2005]", `[@${TYPO}]`);
      await openDialog();
      const notices = await pressExport();
      const failed = notices.find((t) =>
        t.startsWith(m.notice_pandoc_export_failed()),
      );
      expect(failed).toBe(
        m.notice_pandoc_export_failed() +
          m.pandoc_export_error_citekeys_unknown() +
          TYPO,
      );
      await editDraft(`[@${TYPO}]`, "[@ioannidis2005]");
      await openDialog();
      expect(await pressExport()).toContain(
        m.notice_pandoc_export_done({
          file: "Chapter 3 - Presenting the results.docx",
          style: VAULT_STYLE,
        }),
      );
    });

    it("exports the same chapter with native Pandoc", async () => {
      // The reader saves the integration pair to a folder of their own; the
      // Save button's folder dialog is the operating system's, so the walk
      // takes the same pair from the CLI command the button reads.
      const workflow = join(root, ".scratch", "docs-walks", SLUG, "workflow");
      await mkdir(workflow, { recursive: true });
      const pair = JSON.parse(
        await cli([`vault=${walk.vaultId}`, "zotlit:pandoc-files"]),
      ) as { files: Record<string, string> };
      for (const [name, content] of Object.entries(pair.files))
        await writeFile(join(workflow, name), content);
      expect(Object.keys(pair.files).toSorted()).toEqual([
        "zotlit-cite.lua",
        "zotlit.yaml",
      ]);
      // The reader exports the library from Zotero as Better CSL JSON; the
      // walk asks Better BibTeX for the same export over its JSON-RPC.
      const port = await obRun(walk.vaultId, ({ zotlit }) =>
        String(
          zotlit.services.bridge.runSync(zotlit.services.zoteroPref.current)
            .httpPort,
        ),
      );
      const rpc = (await (
        await fetch(`http://127.0.0.1:${port}/better-bibtex/json-rpc`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "item.export",
            params: [
              [
                "rougier2014",
                "ioannidis2005",
                "sandve2013",
                "wilson2014",
                "munafo2017",
              ],
              "Better CSL JSON",
            ],
            id: 1,
          }),
        })
      ).json()) as { result?: unknown; error?: unknown };
      expect(typeof rpc.result).toBe("string");
      const bibliography = join(workflow, "references.json");
      await writeFile(bibliography, rpc.result as string);
      const output = join(workflow, "Chapter 3 - native.docx");
      const run = await execFileAsync(
        "pandoc",
        [
          join(vaultPath, DRAFT),
          "--defaults",
          join(workflow, "zotlit.yaml"),
          "--bibliography",
          bibliography,
          "--fail-if-warnings",
          "--output",
          output,
        ],
        { cwd: dirname(output) },
      );
      // The one line ZotLit prints names the style and where it comes from;
      // the note sets none, so the vault's Default applies.
      expect(run.stderr.trim()).toBe(
        "ZotLit: citations use the Pandoc default style, Chicago author-date (from your vault settings).",
      );
      const text = await plainText(output);
      expect(text).toContain("(Sandve et al. 2013, 2)");
      expect(text).toContain(
        "(Munafò et al. 2017, building on Wilson and colleagues)",
      );
      expect(text).toContain(
        "Wilson, Greg, D. A. Aruliah, C. Titus Brown, et al. 2014.",
      );
    });
  },
);
