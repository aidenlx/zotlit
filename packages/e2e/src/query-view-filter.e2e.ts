import { describe, expect, it } from "vitest";

import { reachable } from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { obRun } from "./obsidian-cli.ts";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  it("finds a Zotero field by a common word in the Filter's property list, reads a saved match-case row, and stores the default text row", async () => {
    const path = "query-files/Filter by journal.zotquery";
    const source = `views:\n  - type: table\n    name: Items\n    from: items\n    order:\n      - title\n    limit: 5\n    filters:\n      and:\n        - title.contains("Nature")\n`;
    const result = await obRun(
      run.vaultId,
      async ({ app, page: pageHelpers }, { path, source }) => {
        const { press, until } = pageHelpers;
        await using cleanup = new AsyncDisposableStack();
        const layout = app.workspace.getLayout();
        cleanup.defer(() => app.workspace.changeLayout(layout));
        const file = cleanup.adopt(
          await app.vault.create(path, source),
          (file) => app.vault.delete(file),
        );
        const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (leaf) =>
          leaf.detach(),
        );
        cleanup.defer(() => {
          for (const popup of document.querySelectorAll<HTMLElement>(
            "[popover]:popover-open",
          ))
            popup.hidePopover();
        });
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        await (
          leaf.view as import("@/views/query-view/file-view").QueryFileView
        ).query.settled;
        const el = (leaf.view as import("obsidian").ItemView).contentEl;
        press(
          await until("Filter button", () =>
            el.querySelector<HTMLElement>('[data-query-toolbar="filter"]')!,
          ),
          "Filter",
        );
        const popover = await until("Filter popover", () =>
          el.doc.querySelector<HTMLElement>(
            '[data-query-popover="filter"]:popover-open',
          )!,
        );
        const savedOperator = await until("saved match-case operator", () => {
          const select = popover.querySelector<HTMLSelectElement>(
            '[data-filter-section="view"] [data-condition-row] select',
          );
          return select?.value === "contains-match-case" ? select : null!;
        });
        const savedRow = {
          operator: savedOperator.value,
          firstOperators: [...savedOperator.options]
            .slice(0, 4)
            .map((option) => option.value),
          value: popover.querySelector<HTMLInputElement>(
            '[data-filter-section="view"] [data-condition-row] input',
          )?.value,
        };
        const kind = await until("property select", () =>
          popover.querySelector<HTMLButtonElement>(
            '[data-filter-section="view"] [data-condition-row] [role=combobox]',
          )!,
        );
        press(kind, "property select");
        const list = await until("property list", () =>
          kind.popoverTargetElement?.matches(":popover-open")
            ? (kind.popoverTargetElement as HTMLElement)
            : null!,
        );
        const search = await until("search field", () =>
          list.querySelector<HTMLInputElement>("input")!,
        );
        search.focus();
        await until(
          "focus in the search",
          () => el.doc.activeElement === search,
        );
        el.doc.execCommand("insertText", false, "journal");
        const row = await until("the journal row", () =>
          list.querySelector<HTMLElement>(
            '[role=option][data-value="field:publicationTitle"]',
          )!,
        );
        const offered = [
          ...list.querySelectorAll<HTMLElement>("[role=option]"),
        ].map((option) => option.dataset.value ?? "");
        press(row, "the journal row");
        await until(
          "the row reads the field",
          () => kind.dataset.value === "field:publicationTitle",
        );
        const value = await until("value field", () =>
          popover.querySelector<HTMLInputElement>(
            '[data-filter-section="view"] [data-condition-row] input',
          )!,
        );
        value.focus();
        await until("focus in the value", () => el.doc.activeElement === value);
        el.doc.execCommand("insertText", false, "Nature");
        const saved = await until("the file saves", async () => {
          const text = await app.vault.read(file);
          return text.includes('publicationTitle.icontains("Nature")') && text;
        });
        return { offered, saved, savedRow };
      },
      { path, source },
    );
    expect(result.savedRow).toEqual({
      operator: "contains-match-case",
      firstOperators: [
        "contains",
        "does-not-contain",
        "contains-match-case",
        "does-not-contain-match-case",
      ],
      value: "Nature",
    });
    expect(result.offered).toContain("field:journalAbbreviation");
    expect(result.offered).not.toContain("item-title");
    expect(result.saved).toContain('publicationTitle.icontains("Nature")');
    expect(result.saved).not.toMatch(/journal\b/);
  });
});
