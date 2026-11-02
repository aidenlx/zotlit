import { describe, expect, it } from "vitest";

import { reachable } from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { obRun } from "./obsidian-cli.ts";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  it("finds a Zotero field by a common word in the Filter's property list, and stores only the field's name", async () => {
    const path = "query-files/Filter by journal.zotquery";
    const source = `views:\n  - type: table\n    name: Items\n    from: items\n    order:\n      - title\n    limit: 5\n    filters:\n      and:\n        - itemType == "journalArticle"\n`;
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
          return text.includes("Nature") && text;
        });
        return { offered, saved };
      },
      { path, source },
    );
    expect(result.offered).toContain("field:journalAbbreviation");
    expect(result.offered).not.toContain("item-title");
    expect(result.saved).toContain('publicationTitle.contains("Nature")');
    expect(result.saved).not.toMatch(/journal\b/);
  });

  it("paints a condition's tooltip above the Filter popover, under its button", async () => {
    const path = "query-files/Filter tooltip.zotquery";
    const source = `views:\n  - type: table\n    name: Items\n    from: items\n    order:\n      - title\n    limit: 5\n    filters:\n      and:\n        - itemType == "journalArticle"\n`;
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
        // A tooltip outlives the button it hovers until a pointer comes up.
        cleanup.defer(() => {
          document.body.dispatchEvent(new PointerEvent("pointerup"));
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
        const remove = await until("remove button", () =>
          popover.querySelector<HTMLElement>(
            '[data-filter-section="view"] [aria-label="Remove condition"]',
          )!,
        );
        // Obsidian shows a tooltip for a mouse that has moved: two moves
        // count as one, and the hover itself is what its listener reads.
        const hover = { bubbles: true, pointerType: "mouse", view: el.win };
        remove.dispatchEvent(new PointerEvent("pointermove", hover));
        remove.dispatchEvent(new PointerEvent("pointermove", hover));
        remove.dispatchEvent(new PointerEvent("pointerover", hover));
        const tooltip = await until("tooltip", () =>
          el.doc.querySelector<HTMLElement>(".tooltip")!,
        );
        const box = tooltip.getBoundingClientRect();
        const button = remove.getBoundingClientRect();
        const shell = popover.getBoundingClientRect();
        // A tooltip takes no pointer; for this one reading it takes the
        // point, so the hit test reports what paints there.
        const x =
          (Math.max(box.left, shell.left) + Math.min(box.right, shell.right)) /
          2;
        const y =
          (Math.max(box.top, shell.top) + Math.min(box.bottom, shell.bottom)) /
          2;
        tooltip.style.pointerEvents = "auto";
        const painted = el.doc.elementFromPoint(x, y);
        tooltip.style.pointerEvents = "";
        return {
          onTop: painted === tooltip,
          offCentre: Math.abs(
            (box.left + box.right) / 2 - (button.left + button.right) / 2,
          ),
          gap: box.top - button.bottom,
          arrowShown: getComputedStyle(tooltip).overflow === "visible",
          popoverOpen: popover.matches(":popover-open"),
        };
      },
      { path, source },
    );
    expect(result.onTop).toBe(true);
    expect(result.offCentre).toBeLessThan(2);
    expect(result.gap).toBeGreaterThanOrEqual(0);
    expect(result.gap).toBeLessThan(16);
    expect(result.arrowShown).toBe(true);
    expect(result.popoverOpen).toBe(true);
  });
});
