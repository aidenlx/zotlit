// Real Obsidian acceptance for generated excerpt-rendering PDFs.

import { expect } from "vitest";

import {
  EXCERPT_RENDERING_CASES,
  EXCERPT_RENDERING_PDFS,
  EXCERPT_RENDERING_VAULT_DIR,
} from "@zotlit/scripts/fixture";

import { cli, obEval, obEvalUntil } from "./obsidian-cli.ts";

interface ProcessMemory {
  private: number;
  residentSet?: number;
  shared?: number;
}

interface PixelResult {
  kind: string;
  provenance?: string;
  bytes?: number;
  sha256?: string;
  width?: number;
  height?: number;
  samples?: number[][];
  released?: boolean;
}

interface RenderingResult {
  coldMs: number;
  warmMs: number;
  rerenderMs: number;
  cold: PixelResult[];
  warm: PixelResult[];
  rerender: PixelResult;
  minimized: PixelResult[];
  failures: { name: string; kind: string }[];
  pdfLeaves: { before: number; after: number };
  electron: {
    before: { minimized: boolean; visible: boolean };
    during: { minimized: boolean; visible: boolean };
    after: { minimized: boolean; visible: boolean };
  };
}

interface SemanticImage {
  width: number;
  height: number;
  foreground: number;
  quadrants: number[];
  annotationColor?: number;
  foregroundBox: number[] | null;
  annotationBox?: number[] | null;
}

type RendererPhase = "pdf-reading" | "document-loading" | "page-rendering";

interface ProbeResult {
  outcome: { kind?: string; name?: string };
  before: ProcessMemory;
  after: ProcessMemory | null;
  snapshot: {
    phase: string;
    jobActive: boolean;
    fileOpen: boolean;
    documentOpen: boolean;
    renderTaskActive: boolean;
    canvas: { width: number; height: number } | null;
    lastCanvas: { width: number; height: number } | null;
    worker: string | null;
  };
  toBlobRestored: boolean;
}

const relativePdf = `${EXCERPT_RENDERING_VAULT_DIR}/excerpt-rendering.pdf`;
const excerptRequestBuilder = `(entry,index,pdfPath)=>({annotation:{key:'EXCERPT'+String(index).padStart(2,'0'),parentKey:'EXCERPT1',type:entry.type,color:'#ff0000',comment:null,text:null,pageLabel:String(entry.pageIndex+1),tags:[],version:null,position:entry.type==='image'?{kind:'pdf-rects',pageIndex:entry.pageIndex,rects:[entry.rect]}:{kind:'pdf-ink',pageIndex:entry.pageIndex,width:entry.width,paths:entry.paths}},source:{kind:'zotero-local-api',serverID:'excerpt-acceptance'},sourceScope:'excerpt-acceptance',attachmentKey:'EXCERPT1',libraryID:1,pdfPath,zoteroPngPath:null})`;

function requestScript(index: number): string {
  return `(()=>{const entry=${JSON.stringify(EXCERPT_RENDERING_CASES[index])};const relative=${JSON.stringify(relativePdf)};const file=app.vault.getAbstractFileByPath(relative);if(!file)throw new Error('Excerpt acceptance PDF missing from Fixture Vault');return (${excerptRequestBuilder})(entry,${index},app.vault.adapter.getFullPath(relative));})()`;
}

function identity(result: PixelResult): Omit<PixelResult, "released"> {
  const { released: _released, ...value } = result;
  return value;
}

async function waitForPlugin(vaultId: string): Promise<void> {
  expect(
    await obEvalUntil(
      vaultId,
      "String(!!app.plugins.plugins.zotlit?.services?.excerptImage)",
      { expected: "true", tries: 80 },
    ),
  ).toBe(true);
}

async function resolveDigest(
  vaultId: string,
  index: number,
): Promise<PixelResult> {
  return JSON.parse(
    await obEval(
      vaultId,
      `(async()=>{const outcome=await app.plugins.plugins.zotlit.services.excerptImage.resolve(${requestScript(index)});return JSON.stringify(outcome.kind==='available'?{kind:outcome.kind,provenance:outcome.provenance,bytes:outcome.bytes.length,sha256:require('crypto').createHash('sha256').update(outcome.bytes).digest('hex')}:{kind:outcome.kind});})()`,
    ),
  ) as PixelResult;
}

async function disposeRenderProbe(vaultId: string): Promise<void> {
  const state = await obEval(
    vaultId,
    `(()=>{const state=app.__zotlitExcerptProbe;if(!state)return 'absent';state.controller.abort();state.diagnostics.release();void state.completion.catch(()=>{state.settled=true;});return 'active';})()`,
  );
  if (state === "absent") return;
  expect(
    await obEvalUntil(
      vaultId,
      "String(app.__zotlitExcerptProbe?.settled&&!app.__zotlitExcerptProbe?.diagnostics.snapshot().jobActive)",
      { expected: "true", tries: 80 },
    ),
  ).toBe(true);
  const released = JSON.parse(
    await obEval(
      vaultId,
      `(()=>{const state=app.__zotlitExcerptProbe;if(!state)return JSON.stringify({snapshot:{phase:'idle',jobActive:false,fileOpen:false,renderTaskActive:false,canvas:null,lastCanvas:null},toBlobRestored:true});const snapshot=state.diagnostics.snapshot();const value={snapshot,toBlobRestored:HTMLCanvasElement.prototype.toBlob===state.originalToBlob};delete app.__zotlitExcerptProbe;return JSON.stringify(value);})()`,
    ),
  ) as Pick<ProbeResult, "snapshot" | "toBlobRestored">;
  expect(released.toBlobRestored).toBe(true);
  expect(released.snapshot).toMatchObject({
    phase: "idle",
    jobActive: false,
    fileOpen: false,
    renderTaskActive: false,
    canvas: null,
  });
  if (released.snapshot.lastCanvas)
    expect(released.snapshot.lastCanvas).toEqual({ width: 0, height: 0 });
}

async function startRenderProbe(
  vaultId: string,
  index: number,
  phase: RendererPhase,
): Promise<
  AsyncDisposable & {
    abort(): Promise<void>;
    release(): Promise<void>;
    result(): Promise<ProbeResult>;
    retry(): Promise<PixelResult>;
    snapshot(): Promise<ProbeResult["snapshot"]>;
  }
> {
  await using stack = new AsyncDisposableStack();
  stack.defer(() => disposeRenderProbe(vaultId));
  if ((await obEval(vaultId, "String(!!app.__zotlitExcerptProbe)")) === "true")
    await disposeRenderProbe(vaultId);
  await obEval(
    vaultId,
    `(async()=>{if(app.__zotlitExcerptProbe)throw new Error('Excerpt probe already active');const service=app.plugins.plugins.zotlit.services.excerptImage;const diagnostics=service.rendererDiagnostics;if(!diagnostics)throw new Error('Excerpt renderer diagnostics unavailable');diagnostics.hold(${JSON.stringify(phase)});const request=${requestScript(index)};request.sourceScope+=':probe:'+${JSON.stringify(phase)}+':'+performance.now();const state={settled:false,outcome:null,originalToBlob:HTMLCanvasElement.prototype.toBlob,controller:new AbortController(),diagnostics,service,request,before:await process.getProcessMemoryInfo(),after:null,completion:null};app.__zotlitExcerptProbe=state;state.completion=service.resolve(request,state.controller.signal).then(value=>{state.outcome={kind:value.kind};},error=>{state.outcome={name:error?.name??String(error)};}).finally(async()=>{state.after=await process.getProcessMemoryInfo().catch(()=>null);state.settled=true;});void state.completion;return true;})()`,
  );
  expect(
    await obEvalUntil(
      vaultId,
      `String(app.__zotlitExcerptProbe?.diagnostics.snapshot().phase===${JSON.stringify(phase)})`,
      { expected: "true", tries: 80 },
    ),
  ).toBe(true);
  const ownership = stack.move();
  return {
    abort: async () => {
      await obEval(vaultId, "app.__zotlitExcerptProbe.controller.abort();true");
    },
    release: async () => {
      await obEval(
        vaultId,
        "app.__zotlitExcerptProbe.diagnostics.release();true",
      );
    },
    snapshot: async () =>
      JSON.parse(
        await obEval(
          vaultId,
          "JSON.stringify(app.__zotlitExcerptProbe.diagnostics.snapshot())",
        ),
      ),
    retry: async () =>
      JSON.parse(
        await obEval(
          vaultId,
          `(async()=>{const state=app.__zotlitExcerptProbe;state.diagnostics.release();const outcome=await state.service.resolve(state.request);return JSON.stringify(outcome.kind==='available'?{kind:outcome.kind,provenance:outcome.provenance,bytes:outcome.bytes.length,sha256:require('crypto').createHash('sha256').update(outcome.bytes).digest('hex')}:{kind:outcome.kind});})()`,
        ),
      ),
    result: async () => {
      expect(
        await obEvalUntil(
          vaultId,
          "String(app.__zotlitExcerptProbe?.settled&&!app.__zotlitExcerptProbe?.diagnostics.snapshot().jobActive)",
          { expected: "true", tries: 80 },
        ),
      ).toBe(true);
      return JSON.parse(
        await obEval(
          vaultId,
          `(()=>{const state=app.__zotlitExcerptProbe;return JSON.stringify({outcome:state.outcome,before:state.before,after:state.after,snapshot:state.diagnostics.snapshot(),toBlobRestored:HTMLCanvasElement.prototype.toBlob===state.originalToBlob});})()`,
        ),
      );
    },
    [Symbol.asyncDispose]: () => ownership.disposeAsync(),
  };
}

export async function verifyExcerptRendering(vaultId: string): Promise<void> {
  const code = `(async()=>{
    const service=app.plugins.plugins.zotlit.services.excerptImage;
    const pdfLeavesBefore=app.workspace.getLeavesOfType('pdf').length;
    const cases=${JSON.stringify(EXCERPT_RENDERING_CASES)};
    const pdfs=${JSON.stringify(EXCERPT_RENDERING_PDFS)};
    const relative=${JSON.stringify(relativePdf)};
    const file=app.vault.getAbstractFileByPath(relative);
    if(!file)throw new Error('Excerpt acceptance PDF missing from Fixture Vault');
    const pdfPath=app.vault.adapter.getFullPath(relative);
    const request=(entry,index)=>(${excerptRequestBuilder})(entry,index,pdfPath);
    const summarize=async(outcome,entry)=>{
      if(outcome.kind!=='available')return {kind:outcome.kind};
      const bitmap=await createImageBitmap(new Blob([outcome.bytes],{type:'image/png'}));let canvas;let value;
      try{canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');if(!context)throw new Error('Acceptance canvas unavailable');context.drawImage(bitmap,0,0);const samples=entry.expected.samples.map(([x,y])=>Array.from(context.getImageData(x,y,1,1).data));value={kind:outcome.kind,provenance:outcome.provenance,bytes:outcome.bytes.length,sha256:require('crypto').createHash('sha256').update(outcome.bytes).digest('hex'),width:bitmap.width,height:bitmap.height,samples};}finally{if(canvas){canvas.width=0;canvas.height=0;}bitmap.close();}
      return {...value,released:canvas.width===0&&canvas.height===0};
    };
    await service.clear();const coldStart=performance.now();const cold=[];for(const [index,entry] of cases.entries())cold.push(await summarize(await service.resolve(request(entry,index)),entry));const coldMs=performance.now()-coldStart;
    const warmStart=performance.now();const warm=[];for(const [index,entry] of cases.entries())warm.push(await summarize(await service.resolve(request(entry,index)),entry));const warmMs=performance.now()-warmStart;
    await service.clear();const rerenderStart=performance.now();const rerender=await summarize(await service.resolve(request(cases[0],0)),cases[0]);const rerenderMs=performance.now()-rerenderStart;
    const failures=[];for(const fixture of pdfs.filter(({outcome})=>outcome!=='renderable')){const name=fixture.asset.split('/').at(-1);const path=app.vault.adapter.getFullPath(${JSON.stringify(EXCERPT_RENDERING_VAULT_DIR)}+'/'+name);const input={...request(cases[0],90+failures.length),attachmentKey:'FAIL'+failures.length,pdfPath:path};failures.push({name,kind:(await service.resolve(input)).kind});}
    const electronWindow=require('@electron/remote').getCurrentWindow();const state=()=>({minimized:electronWindow.isMinimized(),visible:electronWindow.isVisible()});const before=state();const waitFor=(check,action)=>new Promise((resolve,reject)=>{const deadline=setTimeout(()=>{clearInterval(interval);reject(new Error('Electron window state did not settle'));},5000);const interval=setInterval(()=>{if(!check())return;clearTimeout(deadline);clearInterval(interval);resolve();},25);action();});let during,after;const minimized=[];try{if(!before.minimized)await waitFor(()=>electronWindow.isMinimized(),()=>electronWindow.minimize());during=state();await service.clear();for(const [index,entry] of cases.entries())minimized.push(await summarize(await service.resolve(request(entry,index)),entry));}finally{if(!before.minimized)await waitFor(()=>!electronWindow.isMinimized(),()=>electronWindow.restore());after=state();}
    return JSON.stringify({coldMs,warmMs,rerenderMs,cold,warm,rerender,minimized,failures,pdfLeaves:{before:pdfLeavesBefore,after:app.workspace.getLeavesOfType('pdf').length},electron:{before,during,after}});
  })()`;
  const result = JSON.parse(await obEval(vaultId, code)) as RenderingResult;

  expect(result.cold).toHaveLength(EXCERPT_RENDERING_CASES.length);
  expect(
    result.cold.every(({ kind, bytes }) => kind === "available" && !!bytes),
  ).toBe(true);
  expect(result.cold.every(({ sha256 }) => typeof sha256 === "string")).toBe(
    true,
  );
  expect(
    result.cold.map(({ width, height, samples }) => ({
      width,
      height,
      samples,
    })),
  ).toEqual(
    EXCERPT_RENDERING_CASES.map(({ expected }) => ({
      width: expected.width,
      height: expected.height,
      samples: expected.samples.map((sample) => sample.slice(2)),
    })),
  );
  for (const [index, warm] of result.warm.entries()) {
    expect(warm.provenance).toBe("cache");
    expect(identity(warm)).toEqual({
      ...identity(result.cold[index]!),
      provenance: "cache",
    });
  }
  expect(result.rerender).toMatchObject({
    kind: "available",
    provenance: "rendered",
    sha256: result.cold[0]!.sha256,
    width: result.cold[0]!.width,
    height: result.cold[0]!.height,
    samples: result.cold[0]!.samples,
  });
  expect(result.failures).toEqual([
    { name: "corrupt.pdf", kind: "unavailable" },
    { name: "encrypted.pdf", kind: "unavailable" },
  ]);
  expect(result.coldMs).toBeGreaterThan(0);
  expect(result.warmMs).toBeGreaterThan(0);
  expect(result.rerenderMs).toBeGreaterThan(0);
  expect(result.pdfLeaves).toEqual({ before: 0, after: 0 });
  expect(result.electron).toMatchObject({
    before: { minimized: false, visible: true },
    during: { minimized: true },
    after: { minimized: false, visible: true },
  });
  expect(result.minimized.map(identity)).toEqual(
    result.cold.map((entry) => ({
      ...identity(entry),
      provenance: "rendered",
    })),
  );
  const memoryCases = EXCERPT_RENDERING_CASES.map((entry, index) => ({
    entry,
    index,
  })).filter(({ entry }) => entry.measureMemory);
  expect(memoryCases.map(({ entry }) => entry.id)).toEqual([
    "maximum-pixels",
    "maximum-dimension",
  ]);
  for (const { entry, index } of memoryCases) {
    await using probe = await startRenderProbe(
      vaultId,
      index,
      "page-rendering",
    );
    const active = await probe.snapshot();
    expect(active.jobActive).toBe(true);
    expect(active.renderTaskActive).toBe(true);
    expect(active.canvas).toEqual({
      width: entry.expected.width,
      height: entry.expected.height,
    });
    expect(active.canvas!.width * active.canvas!.height).toBeLessThanOrEqual(
      16_777_216,
    );
    expect(
      Math.max(active.canvas!.width, active.canvas!.height),
    ).toBeLessThanOrEqual(8192);
    const during = JSON.parse(
      await obEval(
        vaultId,
        "process.getProcessMemoryInfo().then(JSON.stringify)",
      ),
    ) as ProcessMemory;
    await probe.release();
    const measured = await probe.result();
    expect(measured.outcome).toEqual({ kind: "available" });
    expect(measured.snapshot).toMatchObject({
      phase: "idle",
      jobActive: false,
      renderTaskActive: false,
      canvas: null,
      lastCanvas: { width: 0, height: 0 },
    });
    expect(measured.toBlobRestored).toBe(true);
    expect(measured.after).not.toBeNull();
    for (const memory of [measured.before, during, measured.after!]) {
      expect(memory.private).toBeGreaterThan(0);
      expect(Object.values(memory).every(Number.isFinite)).toBe(true);
      expect(Object.values(memory).every((value) => value >= 0)).toBe(true);
    }
    console.info("Production renderer memory evidence", {
      id: entry.id,
      canvas: active.canvas,
      before: measured.before,
      during,
      after: measured.after,
    });
  }

  await cli([`vault=${vaultId}`, "plugin:reload", "id=zotlit"]);
  await waitForPlugin(vaultId);
  expect(await resolveDigest(vaultId, 0)).toMatchObject({
    provenance: "cache",
    sha256: result.cold[0]!.sha256,
  });

  for (const phase of ["document-loading", "page-rendering"] as const) {
    await using probe = await startRenderProbe(vaultId, 0, phase);
    const workerReady =
      phase !== "document-loading" ||
      (await obEvalUntil(
        vaultId,
        "app.__zotlitExcerptProbe.diagnostics.snapshot().worker",
        { expected: "web-worker", tries: 80 },
      ));
    const active = await probe.snapshot();
    expect(active.jobActive).toBe(true);
    expect(workerReady, JSON.stringify(active)).toBe(true);
    if (phase === "document-loading") expect(active.worker).toBe("web-worker");
    if (phase === "page-rendering") {
      expect(active.renderTaskActive).toBe(true);
      expect(active.canvas).not.toBeNull();
    }
    await probe.abort();
    const cancelled = await probe.result();
    expect(cancelled.outcome).toEqual({ name: "AbortError" });
    expect(cancelled.snapshot).toMatchObject({
      phase: "idle",
      jobActive: false,
      fileOpen: false,
      documentOpen: false,
      renderTaskActive: false,
      canvas: null,
    });
    if (phase === "page-rendering")
      expect(cancelled.snapshot.lastCanvas).toEqual({ width: 0, height: 0 });
    expect(cancelled.toBlobRestored).toBe(true);
    expect(await probe.retry()).toMatchObject({
      kind: "available",
      provenance: "rendered",
    });
  }

  await using reloadProbe = await startRenderProbe(
    vaultId,
    1,
    "page-rendering",
  );
  try {
    await obEval(
      vaultId,
      "(async()=>{await app.plugins.disablePlugin('zotlit');await app.__zotlitExcerptProbe.service[Symbol.asyncDispose]();return true;})()",
    );
    const reloaded = await reloadProbe.result();
    expect(reloaded.outcome).toEqual({ name: "AbortError" });
    expect(reloaded.snapshot).toMatchObject({
      phase: "idle",
      jobActive: false,
      fileOpen: false,
      documentOpen: false,
      renderTaskActive: false,
      canvas: null,
      lastCanvas: { width: 0, height: 0 },
    });
    expect(reloaded.toBlobRestored).toBe(true);
  } finally {
    await obEval(
      vaultId,
      "(async()=>{await app.plugins.enablePlugin('zotlit');return true;})()",
    );
    await waitForPlugin(vaultId);
  }
  expect(await resolveDigest(vaultId, 1)).toMatchObject({
    kind: "available",
    provenance: "cache",
  });

  console.info("Excerpt rendering evidence", result);
}

/** Compare PDF.js output with independent PNGs produced by Zotero's worker. */
export async function verifyZoteroExcerptParity(
  vaultId: string,
): Promise<void> {
  const keys = ["FDRFQ7C2", "TYY6Z6ZF", "4PE492KU"];
  const result = JSON.parse(
    await obEval(
      vaultId,
      `(async()=>{const services=app.plugins.plugins.zotlit.services;await services.annotationRepository.ready;await services.db.refresh();const list=await services.annotationRepository.read('RGRPDF24');if(!list)throw new Error('Fixture annotations unavailable');const pdfPath=app.vault.adapter.getFullPath('attachments/rougier-2014.pdf');const summarize=async(bytes,color)=>{const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));let canvas;try{canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');if(!context)throw new Error('Parity canvas unavailable');context.drawImage(bitmap,0,0);const data=context.getImageData(0,0,bitmap.width,bitmap.height).data;const counts=[0,0,0,0];let foreground=0;let annotationColor=0;const foregroundBounds=[bitmap.width,bitmap.height,-1,-1];const annotationBounds=[bitmap.width,bitmap.height,-1,-1];const mark=(bounds,x,y)=>{bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);};const normalized=bounds=>bounds[2]<0?null:[bounds[0]/bitmap.width,bounds[1]/bitmap.height,(bounds[2]+1)/bitmap.width,(bounds[3]+1)/bitmap.height];const rgb=color?color.match(/[0-9a-f]{2}/gi).map(value=>parseInt(value,16)):null;for(let y=0;y<bitmap.height;y++)for(let x=0;x<bitmap.width;x++){const offset=(y*bitmap.width+x)*4;const marked=data[offset]<245||data[offset+1]<245||data[offset+2]<245;if(marked){foreground++;mark(foregroundBounds,x,y);counts[(y>=bitmap.height/2?2:0)+(x>=bitmap.width/2?1:0)]++;}if(rgb&&Math.abs(data[offset]-rgb[0])<48&&Math.abs(data[offset+1]-rgb[1])<48&&Math.abs(data[offset+2]-rgb[2])<48){annotationColor++;mark(annotationBounds,x,y);}}return {width:bitmap.width,height:bitmap.height,foreground:foreground/(bitmap.width*bitmap.height),quadrants:counts.map(value=>foreground?value/foreground:0),annotationColor:rgb?annotationColor/(bitmap.width*bitmap.height):undefined,foregroundBox:normalized(foregroundBounds),annotationBox:rgb?normalized(annotationBounds):undefined};}finally{if(canvas){canvas.width=0;canvas.height=0;}bitmap.close();}};await services.excerptImage.clear();const output=[];for(const key of ${JSON.stringify(keys)}){const annotation=list.annotations.find(value=>value.key===key);if(!annotation)throw new Error('Missing Fixture annotation '+key);const fallback=require('path').join(services.zoteroPref.dataDir,'cache','library',key+'.png');const request={annotation,source:list.source,sourceScope:services.zoteroPref.dataDir,attachmentKey:'RGRPDF24',libraryID:1,pdfPath,zoteroPngPath:fallback};const outcome=await services.excerptImage.resolve(request);if(outcome.kind!=='available'||outcome.provenance!=='rendered')throw new Error('PDF render unavailable for '+key);const reference=await require('fs').promises.readFile(fallback);output.push({key,type:annotation.type,rendered:await summarize(outcome.bytes,annotation.type==='ink'?annotation.color:null),zotero:await summarize(reference,annotation.type==='ink'?annotation.color:null)});}return JSON.stringify(output);})()`,
    ),
  ) as {
    key: string;
    type: string;
    rendered: SemanticImage;
    zotero: SemanticImage;
  }[];

  expect(result.map(({ key }) => key)).toEqual(keys);
  for (const { type, rendered, zotero } of result) {
    const dimensionTolerance = type === "ink" ? 8 : 0;
    expect(Math.abs(rendered.width - zotero.width)).toBeLessThanOrEqual(
      dimensionTolerance,
    );
    expect(Math.abs(rendered.height - zotero.height)).toBeLessThanOrEqual(
      dimensionTolerance,
    );
    expect(Math.abs(rendered.foreground - zotero.foreground)).toBeLessThan(
      0.05,
    );
    for (let index = 0; index < 4; index++)
      expect(
        Math.abs(rendered.quadrants[index]! - zotero.quadrants[index]!),
      ).toBeLessThan(0.08);
    expect(rendered.foregroundBox).not.toBeNull();
    expect(zotero.foregroundBox).not.toBeNull();
    for (let index = 0; index < 4; index++)
      expect(
        Math.abs(
          rendered.foregroundBox![index]! - zotero.foregroundBox![index]!,
        ),
      ).toBeLessThan(0.03);
    if (type === "ink") {
      expect(rendered.annotationColor).toBeGreaterThan(0);
      expect(zotero.annotationColor).toBeGreaterThan(0);
      expect(rendered.annotationBox).not.toBeNull();
      expect(zotero.annotationBox).not.toBeNull();
      for (let index = 0; index < 4; index++)
        expect(
          Math.abs(
            rendered.annotationBox![index]! - zotero.annotationBox![index]!,
          ),
        ).toBeLessThan(0.04);
    }
  }
  console.info("Zotero excerpt parity evidence", result);
}
