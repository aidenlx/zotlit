import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { verifyAnnotationDrag } from "./annotation-drag.ts";
import { verifyAnnotationInsert } from "./annotation-insert.ts";
import { prepareRunWindow } from "./background-throttling.ts";
import { reachable } from "./e2e-run-fixture.ts";
import {
  annotationAttachment,
  annotationItem,
  copiedAnnotation,
  e2eFixture,
  e2eVaultPath,
  runVaultScript,
  workspaceRoot,
} from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { createFixtureNote } from "./e2e-run-note-helpers.ts";
import { EFFECT_MODULE } from "./effect-module.ts";
import {
  verifyMultiPdfExcerptBatch,
  verifyReaderBackedExcerpts,
  verifySavedEditDisplay,
} from "./excerpt-acceptance.ts";
import { verifyExcerptRefresh } from "./excerpt-refresh.ts";
import { verifyExcerptRendering } from "./excerpt-rendering.ts";
import { useListingProfile } from "./listing-profile.ts";
import {
  clearNotices,
  obEval,
  obEvalUntil,
  WINDOW_DOCUMENTS,
} from "./obsidian-cli.ts";
import { PAGE } from "./page-gestures.ts";
import { clearVault, e2eVaultDir } from "./vault-script.ts";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  // #1795: the real Refresh gesture re-arms the converted display layer.
  it("refreshes a displayed excerpt after an unavailable read", async () => {
    await verifyExcerptRefresh(run.vaultId);
  }, 120000);

  it("renders the deterministic PDF matrix and reuses its cache", async () => {
    await verifyExcerptRendering(run.vaultId);
  }, 120000);

  // The reader-backed path against the Fixture's own Attachment: its
  // Annotations, its Item's literature note, and Obsidian's PDF reader holding
  // the same file the excerpt resolves from.
  it("crops from an open reader's document, reuses it for a note import, and falls back when it closes", async () => {
    await verifyReaderBackedExcerpts(run.vaultId);
  }, 180000);

  // The saved-edit case's write only lands in a Paired Run, and this is not one.
  // What every run can show is the subject that case asks about: the repository
  // indexes its verified database sources by Attachment, so an Annotation's own
  // key answers `read-only`/`server-changed` wherever the Attachment it belongs
  // to is writable — the answer the case used to skip on. The capability itself
  // is stubbed here, so the key the case asks with is the whole observation.
  it("asks the Fixture Attachment's Capability, not its Annotation's, before a saved edit", async () => {
    await obEval(
      run.vaultId,
      `(()=>{
        const {Effect}=${EFFECT_MODULE};
        const repository=app.plugins.plugins.zotlit.services.annotationRepository;
        app.__zotlitCapabilitySubjects=[];
        app.__zotlitCapabilityFor=repository.capabilityFor;
        repository.capabilityFor=key=>{app.__zotlitCapabilitySubjects.push(key);return Effect.succeed({kind:'read-only',reason:'stubbed'});};
        return true;
      })()`,
    );
    const skips: string[] = [];
    let asked: string[] = [];
    try {
      await verifySavedEditDisplay(run.vaultId, {
        skip: (note) => void skips.push(note ?? ""),
      });
      asked = JSON.parse(
        await obEval(
          run.vaultId,
          "JSON.stringify(app.__zotlitCapabilitySubjects)",
        ),
      ) as string[];
    } finally {
      await obEval(
        run.vaultId,
        `(()=>{
          app.plugins.plugins.zotlit.services.annotationRepository.capabilityFor=app.__zotlitCapabilityFor;
          delete app.__zotlitCapabilityFor;
          delete app.__zotlitCapabilitySubjects;
          return true;
        })()`,
      );
    }
    expect(
      skips,
      "a non-writable Attachment stops the saved-edit case before its assertions",
    ).toHaveLength(1);
    expect(
      asked,
      "the Capability is the Attachment's: an Annotation's key answers read-only/server-changed for every writable Attachment",
    ).toEqual([annotationAttachment.key]);
  }, 120000);

  // #1184's multi-PDF batch: several of the Fixture's own PDFs, each asked for
  // its own excerpts, cold and then warm. The Node harness behind the
  // measurements record models PDF work; this case is the app's own answer.
  it("measures a multi-PDF excerpt batch cold and warm", async () => {
    const rougier = join(e2eVaultPath, "attachments/rougier-2014.pdf");
    const generated = join(
      e2eVaultPath,
      "attachments/excerpt-acceptance/excerpt-rendering.pdf",
    );
    const researchInterfaces = join(
      e2eFixture.dataDir,
      "storage/CNPDF26A/research-interfaces.pdf",
    );
    const sakimas = join(
      e2eFixture.dataDir,
      "storage/PDFSTR22/sakimas-song.pdf",
    );
    // Four of the Fixture's PDFs, two excerpts each, grouped so the second of
    // each pair is a repeated same-PDF excerpt: what one resident document
    // serves. The rects are inside every page the Fixture ships.
    await verifyMultiPdfExcerptBatch(run.vaultId, [
      {
        attachmentKey: "RGRPDF24",
        pdfPath: rougier,
        pageIndex: 0,
        rect: [58, 538, 211, 578],
      },
      {
        attachmentKey: "RGRPDF24",
        pdfPath: rougier,
        pageIndex: 0,
        rect: [265.833, 611.202, 374.503, 620.019],
      },
      {
        attachmentKey: "EXCERPT1",
        pdfPath: generated,
        pageIndex: 0,
        rect: [70, 90, 190, 200],
      },
      {
        attachmentKey: "EXCERPT1",
        pdfPath: generated,
        pageIndex: 4,
        rect: [50, 350, 400, 740],
      },
      {
        attachmentKey: "PDFSTR22",
        pdfPath: sakimas,
        pageIndex: 0,
        rect: [80, 80, 280, 200],
      },
      {
        attachmentKey: "PDFSTR22",
        pdfPath: sakimas,
        pageIndex: 1,
        rect: [80, 80, 280, 200],
      },
      {
        attachmentKey: "CNPDF26A",
        pdfPath: researchInterfaces,
        pageIndex: 0,
        rect: [72, 96, 300, 200],
      },
      {
        attachmentKey: "CNPDF26A",
        pdfPath: researchInterfaces,
        pageIndex: 1,
        rect: [72, 96, 300, 200],
      },
    ]);
  }, 180000);

  it.each(["main", "popout"] as const)(
    "inserts a captured annotation safely in a %s editor",
    async (host) => {
      await verifyAnnotationInsert(run.vaultId, host);
    },
    120000,
  );

  it("closes the annotation sidebar while its worker read is pending", async () => {
    const result = await obEval(
      run.vaultId,
      `(async()=>{
        await using cleanup=new AsyncDisposableStack();
        const pending=[];
        const started=Promise.withResolvers();
        const post=Worker.prototype.postMessage;
        const release=()=>{
          Worker.prototype.postMessage=post;
          for(const [worker,args] of pending.splice(0))post.apply(worker,args);
        };
        cleanup.defer(release);
        Worker.prototype.postMessage=function(...args){
          const request=args[0]?.[1];
          if(request?.tag==='AnnotViewAttachments'&&request.payload.key===${JSON.stringify(annotationItem.key)}){
            pending.push([this,args]);started.resolve();return;
          }
          return post.apply(this,args);
        };
        const leaf=cleanup.adopt(app.workspace.getRightLeaf(true),leaf=>leaf.detach());
        await leaf.setViewState({type:'zotero-annotation-view',state:{followMode:'pinned',pinnedItemKey:${JSON.stringify(annotationItem.key)}}});
        await started.promise;
        let settled=false;
        const reading=leaf.view.read.then(()=>{settled=true;});
        await Promise.resolve();
        if(settled)throw new Error('View read settled before its attachments loaded');
        leaf.detach();
        const repository=app.plugins.plugins.zotlit.services.annotationRepository;
        const changed=Object.getOwnPropertyDescriptor(repository,'annotationsChanged'),read=repository.read;
        const afterClose={subscriptions:0,reads:0};
        cleanup.defer(()=>{Object.defineProperty(repository,'annotationsChanged',changed);repository.read=read;});
        Object.defineProperty(repository,'annotationsChanged',{get(){afterClose.subscriptions++;return changed.value;},configurable:true,enumerable:true});
        repository.read=function(...args){afterClose.reads++;return read.apply(this,args);};
        release();
        await reading;
        return JSON.stringify(afterClose);
      })()`,
    );
    expect(JSON.parse(result)).toEqual({ subscriptions: 0, reads: 0 });
  });

  it("copies an Annotation's citation after the database read, through Electron when the web clipboard refuses", async () => {
    const citation = `[@${annotationItem.citationKey}, {p. ${copiedAnnotation.pageLabel}}]`;
    // Electron's clipboard here is the run's in-memory one (prepareRunWindow).
    const copy = (refuse: boolean) =>
      obEval(
        run.vaultId,
        `(async()=>{${PAGE}
          await using cleanup=new AsyncDisposableStack();
          const leaf=cleanup.adopt(app.workspace.getRightLeaf(true),leaf=>leaf.detach());
          await leaf.setViewState({type:'zotero-annotation-view',state:{followMode:'pinned',pinnedItemKey:${JSON.stringify(annotationItem.key)}}});
          const view=leaf.view;await view.read;
          const button=await until('Annotation card menu missing',()=>view.contentEl.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(copiedAnnotation.key)}] [aria-label=${JSON.stringify(run.m.annot_view_more_tooltip())}]'),5000);
          const clipboard=require('electron').clipboard;
          const write=navigator.clipboard.writeText;
          cleanup.defer(()=>{navigator.clipboard.writeText=write;});
          clipboard.writeText('');
          if(${refuse})navigator.clipboard.writeText=()=>Promise.reject(new Error('Clipboard write refused'));
          button.scrollIntoView({block:'center',behavior:'instant'});
          await stands(button,'card More options');
          press(button,'card More options');
          const item=await until('Copy citation missing from the card menu',()=>Array.from(activeDocument.querySelectorAll('.menu .menu-item')).find(e=>e.textContent.trim()===${JSON.stringify(run.m.annot_view_menu_copy_citation())}),2500);
          press(item,'Copy citation');
          let text='';
          await until('citation on the clipboard',()=>(text=clipboard.readText())===${JSON.stringify(citation)},5000).catch(()=>{});
          return text;
        })()`,
      );
    expect(await copy(false)).toBe(citation);
    expect(await copy(true)).toBe(citation);
  });

  it.each([
    ["main", "main"],
    ["main", "popout"],
    ["popout", "main"],
    ["popout", "popout"],
  ] as const)(
    "drags a captured annotation from a %s view into a %s editor",
    async (sourceHost, targetHost) => {
      await verifyAnnotationDrag(run.vaultId, sourceHost, targetHost);
    },
    120000,
  );

  it("creates durable image and ink excerpts with PDF readers closed", async () => {
    const path = e2eVaultDir(workspaceRoot, "excerpt-note-vault");
    await clearVault(runVaultScript, path);
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await runVaultScript(["remove", path, "--purge"]);
    });
    const opened = await runVaultScript([
      "open",
      path,
      "--vault-case",
      "fresh",
    ]);
    const id = opened.stdout.trim().split("\n")[0]!.trim();
    await prepareRunWindow(id);
    // No Zotero process runs on this suite's Fixture.
    expect(
      await obEval(
        id,
        "(()=>{for(const leaf of app.workspace.getLeavesOfType('pdf'))leaf.detach();return String(app.workspace.getLeavesOfType('pdf').length);})()",
      ),
    ).toBe("0");
    // The default Profile shows Annotations in a Query Block; a Profile that
    // lists them in the note renders their excerpts.
    await useListingProfile(id);
    const result = await createFixtureNote(id, 46);
    expect(result.outcome).toBe("created");
    if (result.outcome !== "created")
      throw new Error("Excerpt note was not created");
    const markdown = await readFile(join(path, result.path), "utf8");
    const files: string[] = JSON.parse(
      await obEval(
        id,
        "JSON.stringify(app.vault.getFiles().filter(f=>f.name.startsWith('zotlit-excerpt-')).map(f=>f.path))",
      ),
    );
    expect(files).toHaveLength(3);
    const targets = new Set(
      markdown
        .split("![[")
        .slice(1)
        .map((part) => part.split("]]")[0]!)
        .filter((target) => target.startsWith("zotlit-excerpt-")),
    );
    expect(targets).toEqual(
      new Set(files.map((file) => file.split("/").at(-1)!)),
    );
    const initialImages = new Map<string, Buffer>();
    for (const file of files) {
      const bytes = await readFile(join(path, file));
      initialImages.set(file, bytes);
      // ADR 0053: a newly generated Excerpt Image is lossless WebP, so the
      // durable asset is a RIFF/WEBP container carrying the VP8L chunk.
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
      expect(bytes.includes("VP8L", 12, "latin1")).toBe(true);
      expect(bytes.length).toBeGreaterThan(1000);
    }
    expect(
      JSON.parse(
        await obEval(
          id,
          `(async()=>{const services=app.plugins.plugins.zotlit.services;const file=app.vault.getFileByPath(${JSON.stringify(result.path)});if(!file)throw new Error('Created note missing');const updated=await services.noteFeature.overwriteNote(file,${JSON.stringify(result.indexedKey)});return JSON.stringify({diagnostic:updated.diagnostic??null});})()`,
        ),
      ),
    ).toEqual({ diagnostic: null });
    const overwritten = await readFile(join(path, result.path), "utf8");
    expect(overwritten).toContain("zotlit-excerpt-");
    for (const [file, initial] of initialImages)
      expect(await readFile(join(path, file))).toEqual(initial);

    const frozenImport = JSON.parse(
      await obEval(
        id,
        `(async()=>{const result=await app.plugins.plugins.zotlit.services.batchImport.runBatchImport('note',[13]);return JSON.stringify(result);})()`,
      ),
    ) as { outcome: string; write?: string };
    expect(frozenImport).toMatchObject({ outcome: "single", write: "created" });
    expect(
      await obEvalUntil(
        id,
        "String(app.plugins.plugins.zotlit.services.bridge.runSync(app.plugins.plugins.zotlit.services.noteIndex.getImportedNoteByNoteKey('NNNNAAAA')).length)",
        { expected: "1" },
      ),
    ).toBe(true);
    const importedPath = await obEval(
      id,
      "app.plugins.plugins.zotlit.services.bridge.runSync(app.plugins.plugins.zotlit.services.noteIndex.getImportedNoteByNoteKey('NNNNAAAA'))[0].path",
    );
    const frozenMarkdown = await readFile(join(path, importedPath), "utf8");
    expect(frozenMarkdown).toContain("Saved snapshot");
    expect(frozenMarkdown).not.toContain("zotlit-excerpt-");
    const frozenTargets = frozenMarkdown
      .split("![[")
      .slice(1)
      .map((part) => part.split("]]", 1)[0]!);
    expect(frozenTargets).toHaveLength(3);
    const frozenBytes = await Promise.all(
      frozenTargets.map((target) => readFile(join(path, target))),
    );

    const liveImport = JSON.parse(
      await obEval(
        id,
        `(async()=>{const services=app.plugins.plugins.zotlit.services;services.bridge.runSync(services.settings.updateDefaultLiteratureNoteProfileBindings({'note.import-annotations-as-template':true}));const file=app.vault.getFileByPath(${JSON.stringify(importedPath)});if(!file)throw new Error('Imported Note missing');return JSON.stringify(await services.batchImport.reimportNoteByKey('NNNNAAAA',file));})()`,
      ),
    ) as { outcome: string };
    expect(liveImport).toEqual({ outcome: "overwritten" });
    const liveMarkdown = await readFile(join(path, importedPath), "utf8");
    expect(liveMarkdown).toContain("Saved snapshot");
    expect(liveMarkdown.match(/zotlit-excerpt-/g)).toHaveLength(2);
    const liveTargets = liveMarkdown
      .split("![[")
      .slice(1)
      .map((part) => part.split("]]", 1)[0]!);
    expect(liveTargets).toHaveLength(3);
    const liveBytes = await Promise.all(
      liveTargets.map((target) => readFile(join(path, target))),
    );
    expect(
      liveBytes.some((bytes) =>
        frozenBytes.every((frozen) => !bytes.equals(frozen)),
      ),
    ).toBe(true);

    await clearNotices(id);
    const sourcePdf = join(path, "attachments/rougier-2014.pdf");
    const unavailablePdf = `${sourcePdf}.unavailable`;
    await rename(sourcePdf, unavailablePdf);
    try {
      expect(
        JSON.parse(
          await obEval(
            id,
            `(async()=>{const services=app.plugins.plugins.zotlit.services;const file=app.vault.getFileByPath(${JSON.stringify(importedPath)});return JSON.stringify(await services.batchImport.reimportNoteByKey('NNNNAAAA',file));})()`,
          ),
        ),
      ).toEqual({ outcome: "overwritten" });
    } finally {
      await rename(unavailablePdf, sourcePdf);
    }
    // The reimport pools its excerpt outcomes into one summary notice.
    const summaryNotices = `JSON.stringify([...${WINDOW_DOCUMENTS}].flatMap(doc=>[...doc.querySelectorAll('.notice')]).map(node=>node.textContent).filter(text=>text.includes('Excerpt images:')))`;
    const pooledSummary = JSON.stringify([
      "Excerpt images: 0 from Zotero with uncertain freshness, 2 with unchecked PDF freshness, 0 unavailable, 0 kept from the note and not refreshed.",
    ]);
    await obEvalUntil(id, summaryNotices, { expected: pooledSummary });
    expect(await obEval(id, summaryNotices)).toBe(pooledSummary);
    expect(
      JSON.parse(
        await obEval(
          id,
          `(async()=>{const services=app.plugins.plugins.zotlit.services;const file=app.vault.getFileByPath(${JSON.stringify(importedPath)});return JSON.stringify(await services.batchImport.reimportNoteByKey('NNNNAAAA',file));})()`,
        ),
      ),
    ).toEqual({ outcome: "overwritten" });

    expect(
      await obEval(id, "String(app.workspace.getLeavesOfType('pdf').length)"),
    ).toBe("0");
  });
});
