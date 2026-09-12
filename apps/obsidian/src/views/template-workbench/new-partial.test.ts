// @vitest-environment happy-dom
import {
  ButtonComponent,
  Modal,
  TextComponent,
  controlsOf,
} from "@mock/obsidian";
import type { App } from "obsidian";
import { beforeEach, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import { createSharedPartial } from "./new-partial";
import type { SharedPartialActions } from "./new-partial";
import { openTemplateWorkbench } from "./register";

vi.mock("./register", () => ({ openTemplateWorkbench: vi.fn(async () => {}) }));

const split = { id: "split-leaf" };
const getLeaf = vi.fn(() => split);
const app = { workspace: { getLeaf } } as unknown as App;

function actions(taken: readonly string[] = []): SharedPartialActions & {
  createPartial: ReturnType<typeof vi.fn>;
} {
  return {
    ready: Promise.resolve(),
    getPartialNames: () => taken,
    createPartial: vi.fn(async (name: string) => ({
      path: `templates/zotlit-partial.${name}.md`,
    })),
  } as unknown as SharedPartialActions & {
    createPartial: ReturnType<typeof vi.fn>;
  };
}

/** The prompt the flow opened, with its body built. */
async function prompt(): Promise<Modal> {
  await vi.waitFor(() => expect(Modal.instances).toHaveLength(1));
  const modal = Modal.instances[0]!;
  modal.onOpen();
  return modal;
}

function nameField(modal: Modal): TextComponent {
  return [...modal.contentEl.querySelectorAll<HTMLElement>("label")]
    .flatMap((label) => controlsOf(label.lastElementChild as HTMLElement))
    .find((control) => control instanceof TextComponent)!;
}

function button(modal: Modal, text: string): ButtonComponent {
  return controlsOf(
    modal.modalEl.querySelector<HTMLElement>(".modal-button-container")!,
  ).find(
    (control) => control instanceof ButtonComponent && control.text === text,
  ) as ButtonComponent;
}

beforeEach(() => {
  Modal.instances.length = 0;
  vi.mocked(openTemplateWorkbench).mockClear();
});

it("folds the typed name, names the file, and opens the partial in a split", async () => {
  const template = actions();
  const flow = createSharedPartial(app, template, { name: "Venue line" });
  const modal = await prompt();

  // The completion's query arrives folded, and the row names the file it makes.
  expect(nameField(modal).getValue()).toBe("Venue line");
  expect(modal.contentEl.textContent).toContain(
    m.partial_new_file({ file: "zotlit-partial.venue-line.md" }),
  );

  button(modal, m.partial_new_action()).click();
  modal.onClose();

  await expect(flow).resolves.toBe("venue-line");
  expect(template.createPartial).toHaveBeenCalledWith("venue-line", {});
  expect(openTemplateWorkbench).toHaveBeenCalledWith(
    app,
    { path: "templates/zotlit-partial.venue-line.md" },
    { leaf: split, explainUnsupported: false },
  );
  expect(getLeaf).toHaveBeenCalledWith("split");
});

it.each([
  ["annotation", (name: string) => m.partial_name_reserved({ name })],
  ["citation", (name: string) => m.partial_name_reserved({ name })],
  ["authors", (name: string) => m.partial_name_duplicate({ name })],
  ["venue.line", () => m.partial_name_characters()],
])("refuses %s with a message and creates nothing", async (typed, message) => {
  const template = actions(["authors"]);
  const flow = createSharedPartial(app, template, {});
  const modal = await prompt();

  nameField(modal).type(typed);
  expect(modal.contentEl.textContent).toContain(message(typed));

  // Create is refused, so the prompt stays up for a correction.
  button(modal, m.partial_new_action()).click();
  expect(template.createPartial).not.toHaveBeenCalled();
  expect(modal.isOpen).toBe(true);

  modal.onClose();
  await expect(flow).resolves.toBeNull();
});

it("leaves the workspace alone when the caller opens nothing", async () => {
  const template = actions();
  const flow = createSharedPartial(app, template, {
    name: "authors",
    source: "{{ zt.authors }}",
    language: "eta",
    open: false,
  });
  const modal = await prompt();
  button(modal, m.partial_new_action()).click();
  modal.onClose();

  await expect(flow).resolves.toBe("authors");
  expect(template.createPartial).toHaveBeenCalledWith("authors", {
    source: "{{ zt.authors }}",
    language: "eta",
  });
  expect(openTemplateWorkbench).not.toHaveBeenCalled();
});

it("answers null when the reader dismisses the prompt", async () => {
  const template = actions();
  const flow = createSharedPartial(app, template, {});
  const modal = await prompt();
  modal.onClose();

  await expect(flow).resolves.toBeNull();
  expect(template.createPartial).not.toHaveBeenCalled();
});
