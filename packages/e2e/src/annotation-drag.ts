// Real Annotation View drag insertion across main and pop-out windows.
import { expect } from "vitest";

import { obEval, obEvalUntil } from "./obsidian-cli.ts";

export async function verifyAnnotationDrag(
  vaultId: string,
  sourceHost: "main" | "popout",
  targetHost: "main" | "popout",
) {
  const state = "app.__zotlitDragTrial";
  try {
    await obEval(
      vaultId,
      `(async()=>{
      const s=app.__zotlitDragTrial={layout:app.workspace.getLayout(),mainWin:app.workspace.rootSplit.containerEl.win};
      const services=app.plugins.plugins.zotlit.services;s.services=services;
      s.original=services.noteFeature.prepareAnnotationInsert;
      s.link=app.fileManager.generateMarkdownLink;
      app.fileManager.generateMarkdownLink=function(file,...args){if(file.name?.startsWith('zotlit-excerpt-')&&!app.vault.getFileByPath(file.path))throw new Error('Excerpt link rendered before vault registration');return s.link.call(this,file,...args);};
      s.importEnabled=services.settings.current['attachment.import'];services.settings.update({'attachment.import':true});
      const file=app.vault.getFileByPath('Drag-${sourceHost}-${targetHost}.md')??await app.vault.create('Drag-${sourceHost}-${targetHost}.md','LEFT RIGHT');s.file=file;
      s.targetLeaf=app.workspace.getLeaf('tab');await s.targetLeaf.openFile(file);${targetHost === "popout" ? "app.workspace.moveLeafToPopout(s.targetLeaf);" : ""}
      s.editor=s.targetLeaf.view.editor;s.editor.setValue('LEFT RIGHT');
      s.viewLeaf=app.workspace.getRightLeaf(false);await s.viewLeaf.setViewState({type:'zotero-annotation-view',state:{followMode:'pinned',pinnedItemKey:'RUGIER24'}});${sourceHost === "popout" ? "app.workspace.moveLeafToPopout(s.viewLeaf);" : ""}
      s.view=s.viewLeaf.view;await s.view.read;app.workspace.setActiveLeaf(s.viewLeaf,{focus:true});
      s.prepareCalls=0;s.finished=0;s.gate=new Promise(resolve=>s.release=resolve);
      services.noteFeature.prepareAnnotationInsert=async options=>{s.prepareCalls++;s.options=options;await s.gate;try{return await s.original(options);}finally{s.finished++;}};
      return true;
    })()`,
    );
    expect(
      await obEvalUntil(
        vaultId,
        `String(!!${state}.view.contentEl.querySelector('[data-zotero-annotation-key="FDRFQ7C2"] [draggable]'))`,
        { expected: "true" },
      ),
    ).toBe(true);
    // The unrelated drop enters through CodeMirror's DOM input handler. The
    // tagged drop enters at Obsidian's editor-drop event, the plugin's public
    // consumer boundary, so core focus handling cannot activate the target.
    const native = JSON.parse(
      await obEval(
        vaultId,
        `(()=>{const s=${state};const card=s.view.contentEl.querySelector('[data-zotero-annotation-key="FDRFQ7C2"]');
      s.button=card.querySelector('[draggable]');
      s.sourceWin=s.button.ownerDocument.defaultView;s.targetWin=s.editor.cm.dom.ownerDocument.defaultView;
      s.transfer=new s.sourceWin.DataTransfer();
      const start=new s.sourceWin.DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:s.transfer});
      s.assetsBeforeStart=app.vault.getFiles().filter(f=>f.name.startsWith('zotlit-excerpt-')).length;
      s.button.dispatchEvent(start);s.assetsAfterStart=app.vault.getFiles().filter(f=>f.name.startsWith('zotlit-excerpt-')).length;s.prepareCallsAfterStart=s.prepareCalls;s.activeAtStart=app.workspace.activeLeaf===s.viewLeaf;
      s.nativeAssetsBefore=app.vault.getFiles().filter(f=>f.name.startsWith('zotlit-excerpt-')).length;
      const rect=s.editor.cm.coordsAtPos(0);if(!rect)throw new Error('Native drop coordinates unavailable');s.nativeCoords={x:Math.floor(rect.left+1),y:Math.floor((rect.top+rect.bottom)/2)};
      s.nativePosition=s.editor.cm.posAtCoords(s.nativeCoords);s.nativeTransfer=new s.targetWin.DataTransfer();s.nativeTransfer.setData('text/plain','NATIVE');
      const nativeDrop=new s.targetWin.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:s.nativeTransfer,clientX:s.nativeCoords.x,clientY:s.nativeCoords.y});
      s.editor.cm.contentDOM.dispatchEvent(nativeDrop);
      const result={value:s.editor.getValue(),position:s.nativePosition,prepareCalls:s.prepareCalls,assetCount:app.vault.getFiles().filter(f=>f.name.startsWith('zotlit-excerpt-')).length,assetsBefore:s.nativeAssetsBefore};
      s.editor.undo();result.afterUndo=s.editor.getValue();s.sourceWin.focus();app.workspace.setActiveLeaf(s.viewLeaf,{focus:true});return JSON.stringify(result);
    })()`,
      ),
    ) as {
      value: string;
      position: number;
      prepareCalls: number;
      assetCount: number;
      assetsBefore: number;
      afterUndo: string;
    };
    const nativeBaseline = "LEFT RIGHT";
    expect(native.value).toBe(
      `${nativeBaseline.slice(0, native.position)}NATIVE${nativeBaseline.slice(native.position)}`,
    );
    expect(native.prepareCalls).toBe(0);
    expect(native.assetCount).toBe(native.assetsBefore);
    expect(native.afterUndo).toBe("LEFT RIGHT");
    await obEval(
      vaultId,
      `(()=>{const s=${state};s.sourceWin.focus();app.workspace.setActiveLeaf(s.viewLeaf,{focus:true});return true;
    })()`,
    );
    await obEval(
      vaultId,
      `(()=>{const s=${state};
      const original=s.editor.cm.posAtCoords.bind(s.editor.cm);s.posAtCoords=original;
      s.coordinateCalls=[];s.editor.cm.posAtCoords=coords=>{const position=original(coords);s.coordinateCalls.push({coords,position});return position;};
      const rect=s.editor.cm.coordsAtPos(5);if(!rect)throw new Error('Drop coordinates unavailable');s.expectedCoords={x:Math.floor(rect.left+1),y:Math.floor((rect.top+rect.bottom)/2)};
      s.directPosition=original(s.expectedCoords);
      const drop=new s.targetWin.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:s.transfer,clientX:s.expectedCoords.x,clientY:s.expectedCoords.y});
      app.workspace.trigger('editor-drop',drop,s.editor,s.targetLeaf.view);s.dropPrevented=drop.defaultPrevented;return true;
    })()`,
    );
    expect(
      await obEvalUntil(vaultId, `String(${state}.prepareCalls===1)`, {
        expected: "true",
      }),
    ).toBe(true);
    const capture = JSON.parse(
      await obEval(
        vaultId,
        `JSON.stringify({sourceMain:${state}.sourceWin===${state}.mainWin,targetMain:${state}.targetWin===${state}.mainWin,separate:${state}.sourceWin!==${state}.targetWin,noAsset:${state}.assetsAfterStart===${state}.assetsBeforeStart,prepareCallsAfterStart:${state}.prepareCallsAfterStart,activeAtStart:${state}.activeAtStart,activeAfterCapture:app.workspace.activeLeaf===${state}.viewLeaf,targetInactive:app.workspace.activeLeaf!==${state}.targetLeaf,dropPrevented:${state}.dropPrevented,calls:${state}.coordinateCalls,expected:${state}.expectedCoords,directPosition:${state}.directPosition,notePath:${state}.options.notePath})`,
      ),
    ) as {
      sourceMain: boolean;
      targetMain: boolean;
      separate: boolean;
      noAsset: boolean;
      prepareCallsAfterStart: number;
      activeAtStart: boolean;
      activeAfterCapture: boolean;
      targetInactive: boolean;
      dropPrevented: boolean;
      calls: { coords: { x: number; y: number }; position: number }[];
      expected: { x: number; y: number };
      directPosition: number;
      notePath: string;
    };
    expect(capture).toMatchObject({
      sourceMain: sourceHost === "main",
      targetMain: targetHost === "main",
      separate: sourceHost !== targetHost || sourceHost === "popout",
      noAsset: true,
      prepareCallsAfterStart: 0,
      activeAtStart: true,
      activeAfterCapture: true,
      targetInactive: true,
      dropPrevented: true,
      expected: capture.expected,
      notePath: `Drag-${sourceHost}-${targetHost}.md`,
    });
    expect(capture.directPosition).toBeGreaterThanOrEqual(0);
    expect(capture.directPosition).toBeLessThanOrEqual("LEFT RIGHT".length);
    expect(capture.calls).toContainEqual({
      coords: capture.expected,
      position: capture.directPosition,
    });
    await obEval(
      vaultId,
      `${state}.editor.cm.dispatch({changes:{from:0,insert:'user '}});${state}.release();true`,
    );
    expect(
      await obEvalUntil(vaultId, `String(${state}.finished===1)`, {
        expected: "true",
      }),
    ).toBe(true);
    expect(
      await obEval(
        vaultId,
        `String(app.workspace.activeLeaf===${state}.viewLeaf&&app.workspace.activeLeaf!==${state}.targetLeaf)`,
      ),
    ).toBe("true");
    const text = JSON.parse(
      await obEval(vaultId, `JSON.stringify(${state}.editor.getValue())`),
    ) as string;
    expect(text).toContain("![[zotlit-excerpt-");
    expect(text.split("FDRFQ7C2")).toHaveLength(2);
    expect(text.indexOf("> [!note]")).toBe(
      "user ".length + capture.directPosition,
    );
    const suffix = "LEFT RIGHT".slice(capture.directPosition);
    if (suffix) expect(text.endsWith(suffix)).toBe(true);
    expect(
      await obEvalUntil(
        vaultId,
        `String(Array.from(${state}.editor.cm.dom.querySelectorAll('img')).some(img=>img.src.includes('zotlit-excerpt-')&&img.complete&&img.naturalWidth>0))`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(vaultId, `${state}.editor.undo();true`);
    expect(await obEval(vaultId, `${state}.editor.getValue()`)).toBe(
      "user LEFT RIGHT",
    );
  } finally {
    await obEval(
      vaultId,
      `(async()=>{const s=${state};if(!s)return true;try{s.release?.();if(s.original)s.services.noteFeature.prepareAnnotationInsert=s.original;if(s.link)app.fileManager.generateMarkdownLink=s.link;if(s.editor?.cm&&s.posAtCoords)s.editor.cm.posAtCoords=s.posAtCoords;if(s.importEnabled!==undefined)s.services.settings.update({'attachment.import':s.importEnabled});}finally{try{if(s.layout)await app.workspace.changeLayout(s.layout);}finally{delete app.__zotlitDragTrial;}}return true;})()`,
    );
  }
}
