// The side a vault cell's editor opens to in a Query File tab's Table: down
// over the rows below, or up over the rows above where its box shows more
// room above the cell. Either way it shows whole in the box, and the open
// moves no row and leaves the box's length as it was.
import { expect } from "vitest";

import { obRun, obRunUntil } from "./obsidian-cli.ts";

/** The box and its rows as the open finds them, and leaves them. */
interface BoxState {
  scrollTop: number;
  scrollHeight: number;
  /** The top of each mounted Item row in the window, by its key. */
  rows: Record<string, number>;
}

/** An editor just opened, and the box around it. */
export interface EditorSide {
  before: BoxState;
  after: BoxState;
  /** The editor opened up over the rows above. */
  up: boolean;
  /** How many rows tall the editor stands. */
  rows: number;
  /** The editor stands between the header's bottom and the box's end. */
  inside: boolean;
  /** The editor itself is under the pointer at its top and bottom edges. */
  edges: boolean[];
  /** The caret stands at the end of the text, and the field shows it. */
  caret: boolean;
}

/**
 * Opens the editor of the vault cell `name` on the row of `key` in the
 * Table of the first Query File tab, with a trusted click, reads where it
 * stands, then drops it with Escape. `place` scrolls the box first: `end`
 * to its end, `top` so the row stands under the header. With `lines`, the
 * reader first types words into the text until it wraps to that many lines.
 */
export async function openEditorAt(
  vaultId: string,
  {
    key,
    name,
    place,
    lines,
  }: { key: string; name: string; place: "top" | "end"; lines?: number },
): Promise<EditorSide> {
  const side = await obRun(
    vaultId,
    async ({ app, page }, { key, name, place, lines }) => {
      const el = (
        app.workspace.getLeavesOfType("zotlit-query-file")[0]!
          .view as import("obsidian").ItemView
      ).contentEl;
      const box = el.querySelector<HTMLElement>(".zt-table-scroller")!;
      const head = box.querySelector("thead")!;
      const cellOf = () =>
        box.querySelector<HTMLElement>(
          `[data-query-key="${key}"] [data-query-vault-cell][data-query-vault-name="${name}"]`,
        )!;
      // The rows show under the header, which stays at the box's top.
      const top = box.getBoundingClientRect().top + box.clientTop;
      const start = top + head.offsetHeight;
      const end = top + box.clientHeight;
      if (place === "end") box.scrollTop = box.scrollHeight;
      else
        box.scrollTop +=
          cellOf().closest("tr")!.getBoundingClientRect().top - start;
      for (let frame = 0; frame < 3; frame++)
        await new Promise((resolve) => requestAnimationFrame(resolve));
      // The cell's column comes into view; the row already shows whole.
      cellOf().scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "instant",
      });
      for (let frame = 0; frame < 2; frame++)
        await new Promise((resolve) => requestAnimationFrame(resolve));
      const state = () => ({
        scrollTop: box.scrollTop,
        scrollHeight: box.scrollHeight,
        rows: Object.fromEntries(
          [
            ...box.querySelectorAll<HTMLElement>(
              'tr[data-query-table-row="item"]',
            ),
          ].map((row) => [
            row.getAttribute("data-query-key")!,
            Math.round(row.getBoundingClientRect().top * 10) / 10,
          ]),
        ),
      });
      const before = state();
      const cell = cellOf();
      await page.trusted(box.win).click(cell);
      for (let tries = 0; tries < 50; tries++) {
        if (box.doc.activeElement?.matches("[data-query-vault-input]")) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      for (let frame = 0; frame < 3; frame++)
        await new Promise((resolve) => requestAnimationFrame(resolve));
      const field = box.doc.activeElement as HTMLTextAreaElement;
      if (lines !== undefined) {
        const contents = (
          box.win as Window & {
            electronWindow: { webContents: import("electron").WebContents };
          }
        ).electronWindow.webContents;
        // The lines the text takes, its padding aside.
        const wrapped = () => {
          const style = getComputedStyle(field);
          return Math.round(
            (field.scrollHeight -
              Number.parseFloat(style.paddingTop) -
              Number.parseFloat(style.paddingBottom)) /
              Number.parseFloat(style.lineHeight),
          );
        };
        for (let words = 0; words < 200 && wrapped() < lines; words++) {
          await contents.insertText(words === 0 ? "word" : " word");
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        if (wrapped() < lines)
          throw new Error(`The text wraps to ${wrapped()} lines alone`);
        for (let frame = 0; frame < 3; frame++)
          await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      const after = state();
      const editor = cell.querySelector<HTMLElement>(
        "[data-query-vault-editor]",
      )!;
      // A click that reached another element names it.
      if (!editor) {
        const b = cell.getBoundingClientRect();
        const hit = box.doc.elementFromPoint(
          b.left + b.width / 2,
          b.top + b.height / 2,
        );
        throw new Error(
          `No editor opened; the click reached ${hit?.outerHTML.slice(0, 200)}`,
        );
      }
      const rect = editor.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const side = {
        before,
        after,
        up: editor.hasAttribute("data-up"),
        rows: rect.height / cell.closest("tr")!.getBoundingClientRect().height,
        inside: rect.top >= start - 0.5 && rect.bottom <= end + 0.5,
        edges: [rect.top + 2, rect.bottom - 2].map((y) =>
          editor.contains(box.doc.elementFromPoint(x, y)),
        ),
        caret:
          field.selectionEnd === field.value.length &&
          field.scrollTop + field.clientHeight >= field.scrollHeight - 0.5,
      };
      // The first Escape can close the suggestions of the text alone.
      for (let tries = 0; tries < 3 && editor.isConnected; tries++) {
        await page.trusted(box.win).key("Escape");
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return side;
    },
    { key, name, place, lines },
  );
  await obRunUntil(
    vaultId,
    () => activeDocument.querySelector("[data-query-vault-editor]") === null,
    undefined,
    { what: "the vault cell's editor to close on Escape" },
  );
  return side;
}

/**
 * The editor of `side` stands whole in its box on the side `up` names, at
 * least two rows tall, and its open moved no row and kept the box's length.
 */
export function expectEditorSide(side: EditorSide, up: boolean) {
  expect(side.rows, "the editor wraps its value").toBeGreaterThan(2);
  const { rows: before, ...box } = side.before;
  const { rows: after, ...opened } = side.after;
  expect(opened, "the box after the open").toEqual(box);
  // A long Table can mount other rows past the screen meanwhile.
  const kept = Object.keys(before).filter((key) => key in after);
  expect(kept.length, "the rows mounted through the open").toBeGreaterThan(4);
  expect(
    Object.fromEntries(kept.map((key) => [key, after[key]])),
    "the rows after the open",
  ).toEqual(Object.fromEntries(kept.map((key) => [key, before[key]])));
  expect(side.inside, "the editor inside the box").toBe(true);
  expect(side.edges, "the editor shown at its edges").toEqual([true, true]);
  expect(side.up, "the editor opened up").toBe(up);
}
