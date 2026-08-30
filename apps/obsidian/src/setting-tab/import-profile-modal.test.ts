// @vitest-environment happy-dom
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ButtonComponent, Modal, SuggestModal, TextComponent } from "obsidian";
import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import * as nativeDialog from "@/lib/require";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import type { PreparedProfileImport } from "@/services/profile/service";

import { ImportProfileModal, createProfileImporter } from "./profiles";
import type { ImportProfileDeps, ProfileDialogServices } from "./profiles";

const id = "Ry4Ua8Nv2Mx6" as ProfileId;
function observeButtons() {
  using stack = new DisposableStack();
  const labels = stack.use(
    vi.spyOn(ButtonComponent.prototype, "setButtonText"),
  );
  const clicks = stack.use(vi.spyOn(ButtonComponent.prototype, "onClick"));
  const cleanup = stack.move();
  return {
    click(label: string) {
      const instance =
        labels.mock.instances[
          labels.mock.calls.findIndex(([text]) => text === label)
        ];
      return clicks.mock.calls[clicks.mock.instances.indexOf(instance)]![0](
        {} as MouseEvent,
      );
    },
    labels: () => labels.mock.calls.map(([label]) => label),
    [Symbol.dispose]: () => cleanup.dispose(),
  };
}
function fixture(kind: "fresh" | "replace" = "fresh") {
  const save = vi.fn(async () => ({
    id,
    label: "Shared",
    path: "templates/zotlit-profile.shared.md",
    document: "zotlit-profile.shared.md",
    bindings: {},
  }));
  const plan = {
    kind,
    held: {
      label: "Held",
      version: "1.0.0",
      literatureNotes: 2,
      importedNotes: 1,
    },
    manifest: {
      id,
      name: "Shared",
      version: "2.0.0",
      author: "Research group",
      description: "Reading notes",
      folder: "Sender",
      citationStyle: "missing-style",
      partials: [{ name: "summary" }],
    },
    source: "Shared source",
    path: "templates/zotlit-profile.shared.md",
    profile: {
      ...profileReader().resolveProfile("default")!,
      bindings: {
        ...profileReader().resolveProfile("default")!.bindings,
        "citation.references-style": "missing-style",
      },
    },
    import: save,
  } as unknown as PreparedProfileImport;
  const prepareImport = vi.fn<ImportProfileDeps["profile"]["prepareImport"]>(
    async () => plan,
  );
  const deps = {
    app: {},
    profile: { ...profileReader(), prepareImport },
    template: { prepareLiteratureNoteTemplateSource: () => ({}) },
    noteFeature: {
      prepareProfileNote: () => ({
        path: "Reading/Paper.md",
        properties: { "zotlit-profile": "Shared (Ry4Ua8Nv2Mx6)" },
        body: "Recipient item",
      }),
    },
  } as unknown as ImportProfileDeps;
  const modal = new ImportProfileModal(deps, {
    source: "IMPORTED SOURCE",
    plan,
    data: { note: {} as never, filename: {} },
    styles: [],
  });
  modal.contentEl = document.createElement("div");
  modal.modalEl = document.createElement("div");
  return { modal, prepareImport, save, deps, plan };
}

it("opens fresh consent with metadata, recipient preview, editable bindings and one-file effects", async () => {
  using buttons = observeButtons();
  using text = vi.spyOn(TextComponent.prototype, "onChange");
  const f = fixture();
  f.modal.onOpen();
  expect(f.modal.contentEl.querySelector("textarea")).toBeNull();
  expect(buttons.labels()).toEqual([
    m.profile_import_cancel(),
    m.profile_import_confirm(),
  ]);
  await vi.waitFor(() =>
    expect(f.modal.contentEl.textContent).toContain("Recipient item"),
  );
  expect(f.modal.contentEl.textContent).toContain("Research group");
  expect(f.modal.contentEl.textContent).toContain("Recipient item");
  expect(f.modal.contentEl.textContent).toContain("Shared (Ry4Ua8Nv2Mx6)");
  expect(f.modal.contentEl.textContent).toContain(
    m.profile_import_partials({ names: "summary" }),
  );
  expect(f.modal.contentEl.textContent).toContain(
    m.profile_import_missing_style({ style: "missing-style" }),
  );
  await vi.waitFor(() =>
    expect(f.prepareImport).toHaveBeenCalledWith("IMPORTED SOURCE", {
      citationStyle: null,
    }),
  );
  text.mock.calls[0]![0]("Reading");
  await vi.waitFor(() =>
    expect(f.prepareImport).toHaveBeenLastCalledWith("IMPORTED SOURCE", {
      folder: "Reading",
      citationStyle: null,
    }),
  );
  expect(f.save).not.toHaveBeenCalled();
  buttons.click(m.profile_import_confirm());
  await expect(f.modal.result).resolves.toMatchObject({ id });
  expect(f.save).toHaveBeenCalledOnce();
});

it("shows only Replace and Cancel for a held ID, naming version and separate note counts", async () => {
  using buttons = observeButtons();
  using title = vi.spyOn(Modal.prototype, "setTitle");
  const f = fixture("replace");
  f.modal.onOpen();
  await vi.waitFor(() =>
    expect(title).toHaveBeenLastCalledWith(
      m.profile_import_replace_title({ label: "Held" }),
    ),
  );
  expect(f.modal.contentEl.textContent).toContain(
    m.profile_import_replace_effects({
      version: "1.0.0",
      literature: 2,
      imported: 1,
    }),
  );
  expect(f.modal.contentEl.querySelector("textarea")).toBeNull();
  expect(f.modal.contentEl.textContent).not.toContain(
    m.profile_import_none_changed(),
  );
  expect(f.save).not.toHaveBeenCalled();
  buttons.click(m.profile_import_replace());
  await expect(f.modal.result).resolves.toMatchObject({ id });
  expect(f.save).toHaveBeenCalledOnce();
});

async function importerFixture(kind: "fresh" | "replace" = "fresh") {
  await using stack = new AsyncDisposableStack();
  const folder = await mkdtemp(join(tmpdir(), "zotlit-profile-source-"));
  stack.defer(() => rm(folder, { recursive: true, force: true }));
  const filePath = join(folder, "profile.md");
  await writeFile(filePath, "FILE SOURCE");
  const f = fixture(kind);
  const clipboard = stack.use(
    vi
      .spyOn(navigator.clipboard, "readText")
      .mockResolvedValue("CLIPBOARD SOURCE"),
  );
  const showOpenDialog = vi.fn(async () => ({
    canceled: false,
    filePaths: [filePath],
  }));
  stack.use(
    vi
      .spyOn(nativeDialog, "requireDialog")
      .mockReturnValue({ showOpenDialog } as unknown as ReturnType<
        typeof nativeDialog.requireDialog
      >),
  );
  const releaseRead = vi.fn();
  const acquireRead = vi.fn(async () => ({
    client: {},
    [Symbol.dispose]: releaseRead,
  }));
  const opened = stack.use(
    vi
      .spyOn(Modal.prototype, "open")
      .mockImplementation(function (this: Modal) {
        this.contentEl = document.createElement("div");
      }),
  );
  const suggestions = stack.use(vi.spyOn(SuggestModal.prototype, "open"));
  const run = createProfileImporter({
    ...f.deps,
    db: { acquireRead },
    libraryScope: {
      ready: Promise.resolve(),
      resolveWith: () => ({ available: [] }),
    },
    zoteroPref: { dataDir: null },
  } as unknown as ProfileDialogServices);
  const cleanup = stack.move();
  return {
    ...f,
    run,
    clipboard,
    showOpenDialog,
    acquireRead,
    releaseRead,
    opened,
    suggestions,
    [Symbol.asyncDispose]: () => cleanup.disposeAsync(),
  };
}

it("offers two source suggestions and reads only after native close-before-choice selection", async () => {
  await using f = await importerFixture();
  const pending = f.run();
  await vi.waitFor(() => expect(f.suggestions).toHaveBeenCalledOnce());
  expect(f.clipboard).not.toHaveBeenCalled();
  expect(f.showOpenDialog).not.toHaveBeenCalled();
  expect(f.acquireRead).not.toHaveBeenCalled();
  expect(f.opened).not.toHaveBeenCalled();
  const picker = f.suggestions.mock.instances[0] as SuggestModal<
    "clipboard" | "file"
  >;
  const options = await picker.getSuggestions("");
  expect(options).toEqual(["clipboard", "file"]);
  expect(
    options.map((option) => {
      const row = document.createElement("div");
      picker.renderSuggestion(option, row);
      return row.textContent;
    }),
  ).toEqual([m.profile_import_clipboard(), m.profile_import_file()]);
  picker.onClose();
  picker.onChooseSuggestion("clipboard", {} as MouseEvent);
  await vi.waitFor(() => expect(f.opened).toHaveBeenCalledOnce());
  expect(f.clipboard).toHaveBeenCalledOnce();
  expect(f.prepareImport).toHaveBeenCalledWith("CLIPBOARD SOURCE", {});
  expect(f.acquireRead).toHaveBeenCalledOnce();
  expect(f.releaseRead).toHaveBeenCalledOnce();
  expect(f.opened.mock.instances[0]).toBeInstanceOf(ImportProfileModal);
  (f.opened.mock.instances[0] as ImportProfileModal).onClose();
  await expect(pending).resolves.toBeUndefined();
  expect(f.save).not.toHaveBeenCalled();
});

it("cancels the source suggester without reading or opening consent", async () => {
  await using f = await importerFixture();
  const pending = f.run();
  await vi.waitFor(() => expect(f.suggestions).toHaveBeenCalledOnce());
  (f.suggestions.mock.instances[0] as SuggestModal<unknown>).onClose();
  await expect(pending).resolves.toBeUndefined();
  expect(f.clipboard).not.toHaveBeenCalled();
  expect(f.showOpenDialog).not.toHaveBeenCalled();
  expect(f.acquireRead).not.toHaveBeenCalled();
  expect(f.opened).not.toHaveBeenCalled();
});

it.each(["clipboard", "file"] as const)(
  "opens consent directly for the menu's %s source",
  async (source) => {
    await using f = await importerFixture("replace");
    const pending = f.run({ source });
    await vi.waitFor(() => expect(f.opened).toHaveBeenCalledOnce());
    expect(f.suggestions).not.toHaveBeenCalled();
    expect(f.acquireRead).not.toHaveBeenCalled();
    expect(f.prepareImport).toHaveBeenCalledWith(
      source === "clipboard" ? "CLIPBOARD SOURCE" : "FILE SOURCE",
      {},
    );
    if (source === "file") expect(f.showOpenDialog).toHaveBeenCalledOnce();
    (f.opened.mock.instances[0] as ImportProfileModal).onClose();
    await expect(pending).resolves.toBeUndefined();
    expect(f.save).not.toHaveBeenCalled();
  },
);

it.each(["empty", "read-error", "file-cancel"] as const)(
  "opens no consent for %s and allows retry through the entry",
  async (failure) => {
    await using f = await importerFixture();
    const source = failure === "file-cancel" ? "file" : "clipboard";
    if (failure === "empty") f.clipboard.mockResolvedValueOnce(" \n");
    else if (failure === "read-error")
      f.clipboard.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    else
      f.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await expect(f.run({ source })).resolves.toBeUndefined();
    expect(f.prepareImport).not.toHaveBeenCalled();
    expect(f.acquireRead).not.toHaveBeenCalled();
    expect(f.opened).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    const retry = f.run({ source });
    await vi.waitFor(() => expect(f.opened).toHaveBeenCalledOnce());
    (f.opened.mock.instances[0] as ImportProfileModal).onClose();
    await expect(retry).resolves.toBeUndefined();
  },
);
