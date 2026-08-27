import { describe, expect, it, vi } from "vitest";

import { exportLiteratureNotePack } from "@zotlit/templates/literature-note-pack";
import type { LiteratureNotePackInstallRecord } from "@zotlit/templates/literature-note-pack";

import type { Settings } from "@/services/settings/schema";
import { DEFAULT_TEMPLATES } from "@/services/template/defaults";

import { LiteratureNotePackService } from "./pack";

const DOCUMENT = `---
id: example.books
name: Books
version: 1.0.0
author: Example
description: Book notes
contract: 2
filename: "{{ zt.citationKey }}"
---
# {{ zt.title }}

{% managed %}{% render "summary" with zt as zt %}{% endmanaged %}
`;

const PACK = exportLiteratureNotePack(DOCUMENT, [
  {
    name: "summary",
    language: "liquid",
    source: "Pack summary: {{ zt.title }}",
  },
]);

function makeHarness() {
  interface TestFile {
    path: string;
    source: string;
  }
  const files = new Map<string, TestFile>([
    [
      "templates/zotlit-summary.liquid.md",
      {
        path: "templates/zotlit-summary.liquid.md",
        source: "User summary",
      },
    ],
  ]);
  const state: Pick<
    Settings,
    "note.template-pack-installs" | "template.folder"
  > = {
    "note.template-pack-installs": [] as LiteratureNotePackInstallRecord[],
    "template.folder": "templates",
  };
  const update = vi.fn(
    (patch: Pick<Settings, "note.template-pack-installs">) =>
      void Object.assign(state, patch),
  );
  const flush = vi.fn(async () => {});
  const trashFile = vi.fn(async (file: { path: string }) => {
    files.delete(file.path);
  });
  const create = vi.fn(async (path: string, source: string) => {
    const file = { path, source };
    files.set(path, file);
    return file;
  });
  const modify = vi.fn(async (file: TestFile, source: string) => {
    file.source = source;
  });
  const renderSource = vi.fn(() => ({
    create: "# Preview\nsummary",
    update: "summary",
  }));
  const exportPack = vi.fn(async () => PACK);
  const service = new LiteratureNotePackService({
    app: {
      vault: {
        getFileByPath: (path: string) => files.get(path) ?? null,
        cachedRead: async (file: TestFile) => file.source,
        create,
        modify,
      },
      fileManager: { trashFile },
    },
    settings: {
      loaded: Promise.resolve(state),
      update,
      flush,
    },
    template: {
      ready: Promise.resolve(),
      exportLiteratureNotePack: exportPack,
      renderLiteratureNoteTemplateSource: renderSource,
    },
  });
  return {
    create,
    exportPack,
    files,
    flush,
    modify,
    renderSource,
    service,
    state,
    trashFile,
    update,
  };
}

describe("LiteratureNotePackService", () => {
  it("exports one shared document through the template operation", async () => {
    const harness = makeHarness();

    await expect(harness.service.export("books.md")).resolves.toBe(PACK);
    expect(harness.exportPack).toHaveBeenCalledWith("books.md");
  });

  it("previews against item data without writing files or records", async () => {
    const harness = makeHarness();
    const paths = [...harness.files.keys()];

    const preview = await harness.service.preview(PACK, { title: "Paper" });

    expect(preview).toEqual({
      create: "# Preview\nsummary",
      update: "summary",
    });
    expect(harness.renderSource).toHaveBeenCalledWith(PACK, { title: "Paper" });
    expect([...harness.files.keys()]).toEqual(paths);
    expect(harness.update).not.toHaveBeenCalled();
  });

  it("diffs effective files and requires a per-file overwrite approval", async () => {
    const harness = makeHarness();

    expect(await harness.service.diff("books.md", PACK)).toMatchObject({
      accepted: false,
      files: [
        { key: "document:books.md", previous: "absent", verdict: "apply" },
        {
          key: "partial:summary:liquid",
          previous: "user-file",
          verdict: "refuse",
        },
      ],
    });
    expect(
      await harness.service.diff("books.md", PACK, {
        overwrite: ["partial:summary:liquid"],
      }),
    ).toMatchObject({ accepted: true });
  });

  it("diffs an absent template file against its effective built-in source", async () => {
    const harness = makeHarness();
    const pack = exportLiteratureNotePack(
      DOCUMENT.replace('render "summary"', 'render "filename"'),
      [
        {
          name: "filename",
          language: "liquid",
          source: DEFAULT_TEMPLATES.filename,
        },
      ],
    );

    expect(await harness.service.diff("built-in.md", pack)).toMatchObject({
      files: [
        { key: "document:built-in.md", verdict: "apply" },
        {
          key: "partial:filename:liquid",
          previous: "built-in",
          verdict: "unchanged",
        },
      ],
    });
  });

  it("applies with a plugin-side exact replacement record", async () => {
    const harness = makeHarness();

    const record = await harness.service.apply("books.md", PACK, {
      overwrite: ["partial:summary:liquid"],
    });

    expect(harness.files.get("templates/books.md")?.source).toBe(PACK);
    expect(
      harness.files.get("templates/zotlit-summary.liquid.md")?.source,
    ).toBe("Pack summary: {{ zt.title }}");
    expect(record.files).toMatchObject([
      { previous: { kind: "absent" } },
      { previous: { kind: "user-file", source: "User summary" } },
    ]);
    expect(harness.state["note.template-pack-installs"]).toEqual([record]);
    expect(harness.flush).toHaveBeenCalledOnce();
  });

  it("reverts exact user bytes and trashes files whose prior state was absent", async () => {
    const harness = makeHarness();
    await harness.service.apply("books.md", PACK, {
      overwrite: ["partial:summary:liquid"],
    });

    const result = await harness.service.revert("example.books");

    expect(result).toEqual({
      restored: ["templates/zotlit-summary.liquid.md"],
      trashed: ["templates/books.md"],
    });
    expect(
      harness.files.get("templates/zotlit-summary.liquid.md")?.source,
    ).toBe("User summary");
    expect(harness.files.has("templates/books.md")).toBe(false);
    expect(harness.state["note.template-pack-installs"]).toEqual([]);
    expect(harness.trashFile).toHaveBeenCalledOnce();
  });
});
