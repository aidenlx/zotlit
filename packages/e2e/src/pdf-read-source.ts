// A retained PDF binding must keep the source that resolved its Attachment.
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";

import { obRun } from "./obsidian-cli.ts";
import { waitFor } from "./obsidian-cli.ts";
import { zoteroFetch } from "./paired-zotero.ts";

export async function verifyPdfReadSource(
  vaultId: string,
  {
    vaultPath,
    api,
    cleanup,
  }: { vaultPath: string; api: string; cleanup: AsyncDisposableStack },
): Promise<void> {
  const saved = await obRun(
    vaultId,
    async ({ zotlit }) => {
      return {
        dataDir: zotlit.services.zoteroPref.dataDir,
        override: zotlit.services.zoteroPref.dataDirOverride,
        log: {
          "log.level": zotlit.services.bridge.runSync(
            zotlit.services.settings.current,
          )["log.level"],
          "log.to-file": zotlit.services.bridge.runSync(
            zotlit.services.settings.current,
          )["log.to-file"],
        },
      };
    },
    undefined,
  );
  const oldDir = await mkdtemp(join(vaultPath, "../read-source-"));
  const oldPdf = "old-source.pdf";
  cleanup.defer(async () => {
    await obRun(
      vaultId,
      async ({ app, zotlit }, { override, log }) => {
        app.workspace.getLeavesOfType("pdf").forEach((l) => l.detach());
        zotlit.services.zoteroPref.setDataDir(override);
        zotlit.services.bridge.runSync(zotlit.services.settings.update(log));
        await zotlit.services.bridge.runPromise(zotlit.services.settings.flush);
        const file = app.vault.getFileByPath("old-source.pdf")!;
        if (file) await app.vault.delete(file);
      },
      { override: saved.override, log: saved.log },
    );
    await rm(oldDir, { recursive: true, force: true });
  });
  {
    await copyFile(
      join(saved.dataDir, "zotero.sqlite"),
      join(oldDir, "zotero.sqlite"),
    );
    await copyFile(
      join(saved.dataDir, "zotero.sqlite-wal"),
      join(oldDir, "zotero.sqlite-wal"),
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    using old = new DatabaseSync(join(oldDir, "zotero.sqlite"));
    old
      .prepare(
        "UPDATE settings SET value=? WHERE setting='localAPI' AND key='serverID'",
      )
      .run("OLDSOURCE123");
    old
      .prepare(
        "UPDATE itemAttachments SET path=? WHERE itemID=(SELECT itemID FROM items WHERE key='RGRPDF24')",
      )
      .run(join(vaultPath, oldPdf));
  }
  await obRun(
    vaultId,
    async ({ app, zotlit }, { oldDir }) => {
      app.workspace.getLeavesOfType("pdf").forEach((l) => l.detach());
      zotlit.services.bridge.runSync(
        zotlit.services.settings.update({
          "log.level": "trace",
          "log.to-file": true,
        }),
      );
      await zotlit.services.bridge.runPromise(zotlit.services.settings.flush);
      const oldServices = zotlit.services;
      await app.plugins.disablePlugin("zotlit");
      await oldServices.pdfAnnotationEditor[Symbol.asyncDispose]();
      for (let i = 0; i < 200 && !oldServices.bridge.closed(); i++)
        await new Promise((r) => setTimeout(r, 25));
      if (!oldServices.bridge.closed())
        throw new Error("The ZotLit services did not close");
      await app.plugins.enablePlugin("zotlit");
      await app.vault.copy(
        app.vault.getFileByPath("attachments/rougier-2014.pdf")!,
        "old-source.pdf",
      );
      zotlit.services.zoteroPref.setDataDir(oldDir);
    },
    { oldDir },
  );
  const read = async () => {
    const reply = await zoteroFetch(api, "users/0/items/RGRPDF24");
    expect(reply.status).toBe(200);
    return (await reply.json()) as {
      version: number;
      data: { lastRead?: number };
    };
  };
  expect(
    await waitFor(
      async () =>
        (await obRun(
          vaultId,
          async ({ zotlit }, { pdfPath }) => {
            return String(
              zotlit.services.bridge.runSync(
                zotlit.services.attachmentResolver.resolve(pdfPath),
              ).kind === "resolved",
            );
          },
          { pdfPath: join(vaultPath, oldPdf) },
        )) === "true",
    ),
  ).toBe(true);
  const before = await read();
  await obRun(
    vaultId,
    async ({ app }) => {
      await app.workspace
        .getLeaf("tab")
        .openFile(app.vault.getFileByPath("old-source.pdf")!);
    },
    undefined,
  );
  expect(
    await waitFor(
      async () =>
        (await obRun(
          vaultId,
          async ({ zotlit }) => {
            return String(
              zotlit.services.pdfAnnotationEditor.bindings.find(
                (b) => b.filePath === "old-source.pdf",
              )?.session?.target?.attachmentKey === "RGRPDF24",
            );
          },
          undefined,
        )) === "true",
    ),
  ).toBe(true);
  await obRun(
    vaultId,
    async ({ zotlit }, { dataDir }) => {
      zotlit.services.zoteroPref.setDataDir(dataDir);
      await zotlit.services.bridge.runPromise(
        zotlit.services.zoteroLocalApi.probe,
      );
    },
    { dataDir: saved.dataDir },
  );
  expect(
    await waitFor(
      async () =>
        (await obRun(
          vaultId,
          async ({ zotlit }, { pdfPath }) => {
            return String(
              zotlit.services.bridge.runSync(
                zotlit.services.attachmentResolver.resolve(pdfPath),
              ).kind === "unresolved",
            );
          },
          { pdfPath: join(vaultPath, oldPdf) },
        )) === "true",
    ),
  ).toBe(true);
  expect(
    await waitFor(
      async () =>
        Math.floor(Temporal.Now.instant().epochMilliseconds / 1000) >
        (before.data.lastRead ?? 0),
    ),
  ).toBe(true);
  // Keep the client alive while the close write would finish. This catches a
  // retained binding adopting the newly selected database's identity.
  await obRun(
    vaultId,
    async ({ app }) => {
      app.workspace.getLeavesOfType("pdf").forEach((l) => l.detach());
    },
    undefined,
  );
  // The trace records the completed write-back decision. Keep Zotero and the
  // client alive until it lands, then check the external record.
  let outcome:
    | { message: string; properties: { reason?: string; outcome?: string } }
    | null
    | undefined;
  expect(
    await waitFor(async () => {
      outcome = await obRun(
        vaultId,
        async ({ app }) => {
          const records = (
            await app.vault.adapter.read(
              `${
                (app.plugins.plugins.zotlit as import("obsidian").Plugin)
                  .manifest.dir
              }/zotlit.log.jsonl`,
            )
          )
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line));
          const close = records.findLastIndex(
            (record) =>
              record.message === "PDF read accepted" &&
              record.properties.event === "close",
          );
          return close < 0
            ? null
            : (records
                .slice(close + 1)
                .find((record) =>
                  record.message.startsWith("Read write-back"),
                ) ?? null);
        },
        undefined,
      );
      return !!outcome;
    }),
  ).toBe(true);
  expect(outcome).toMatchObject({
    message: "Read write-back skipped",
    properties: { reason: "resolved source differs" },
  });
  expect((await read()).data.lastRead).toBe(before.data.lastRead);
  expect((await read()).version).toBe(before.version);
}
