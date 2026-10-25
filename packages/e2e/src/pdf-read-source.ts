// A retained PDF binding must keep the source that resolved its Attachment.
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";

import { obEval, obJson, waitFor } from "./obsidian-cli.ts";
import { zoteroFetch } from "./paired-zotero.ts";

export async function verifyPdfReadSource(
  vaultId: string,
  {
    vaultPath,
    api,
    cleanup,
  }: { vaultPath: string; api: string; cleanup: AsyncDisposableStack },
): Promise<void> {
  const services = "app.plugins.plugins.zotlit.services";
  const saved = await obJson<{
    dataDir: string;
    override: string | null;
    log: Record<string, unknown>;
  }>(
    vaultId,
    `JSON.stringify({dataDir:${services}.zoteroPref.dataDir,override:${services}.zoteroPref.dataDirOverride,log:{'log.level':${services}.settings.current['log.level'],'log.to-file':${services}.settings.current['log.to-file']}})`,
  );
  const oldDir = await mkdtemp(join(vaultPath, "../read-source-"));
  const oldPdf = "old-source.pdf";
  cleanup.defer(async () => {
    await obEval(
      vaultId,
      `(async()=>{app.workspace.getLeavesOfType('pdf').forEach(l=>l.detach());await ${services}.zoteroPref.setDataDir(${JSON.stringify(saved.override)});${services}.settings.update(${JSON.stringify(saved.log)});await ${services}.settings.flush();const file=app.vault.getFileByPath('${oldPdf}');if(file)await app.vault.delete(file);return true;})()`,
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
  await obEval(
    vaultId,
    `(async()=>{app.workspace.getLeavesOfType('pdf').forEach(l=>l.detach());${services}.settings.update({'log.level':'trace','log.to-file':true});await ${services}.settings.flush();const oldServices=app.plugins.plugins.zotlit.services;await app.plugins.disablePlugin('zotlit');await oldServices.pdfAnnotationEditor[Symbol.asyncDispose]();await oldServices.useLedger[Symbol.asyncDispose]();await oldServices.zoteroLocalApi[Symbol.asyncDispose]();await app.plugins.enablePlugin('zotlit');await ${services}.log.ready;await app.vault.copy(app.vault.getFileByPath('attachments/rougier-2014.pdf'),'${oldPdf}');await ${services}.zoteroPref.setDataDir(${JSON.stringify(oldDir)});return true;})()`,
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
        (await obEval(
          vaultId,
          `String(${services}.bridge.runSync(${services}.attachmentResolver.resolve(${JSON.stringify(join(vaultPath, oldPdf))})).kind==='resolved')`,
        )) === "true",
    ),
  ).toBe(true);
  const before = await read();
  await obEval(
    vaultId,
    `(async()=>{await app.workspace.getLeaf('tab').openFile(app.vault.getFileByPath('${oldPdf}'));return true;})()`,
  );
  expect(
    await waitFor(
      async () =>
        (await obEval(
          vaultId,
          `String(${services}.pdfAnnotationEditor.bindings.find((b)=>b.filePath==='${oldPdf}')?.session?.target?.attachmentKey==='RGRPDF24')`,
        )) === "true",
    ),
  ).toBe(true);
  await obEval(
    vaultId,
    `(async()=>{await ${services}.zoteroPref.setDataDir(${JSON.stringify(saved.dataDir)});await ${services}.zoteroLocalApi.probe();return true;})()`,
  );
  expect(
    await waitFor(
      async () =>
        (await obEval(
          vaultId,
          `String(${services}.bridge.runSync(${services}.attachmentResolver.resolve(${JSON.stringify(join(vaultPath, oldPdf))})).kind==='unresolved')`,
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
  await obEval(
    vaultId,
    "app.workspace.getLeavesOfType('pdf').forEach(l=>l.detach());true",
  );
  // The trace records the completed write-back decision. Keep Zotero and the
  // client alive until it lands, then check the external record.
  let outcome:
    | { message: string; properties: { reason?: string; outcome?: string } }
    | undefined;
  expect(
    await waitFor(async () => {
      outcome = await obJson(
        vaultId,
        `(async()=>{const records=(await app.vault.adapter.read(app.plugins.plugins.zotlit.manifest.dir+'/zotlit.log.jsonl')).split('\\n').filter(Boolean).map(line=>JSON.parse(line));const close=records.findLastIndex(record=>record.message==='PDF read accepted'&&record.properties.event==='close');return JSON.stringify(close<0?null:records.slice(close+1).find(record=>record.message.startsWith('Read write-back'))??null);})()`,
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
