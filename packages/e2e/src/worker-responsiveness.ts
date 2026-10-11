import { obEval } from "./obsidian-cli.ts";

/** Measure the real worker's task queue independently of sequential RPC calls. */
export async function measureWorkerResponsiveness<T>(
  vault: string,
  measure: () => Promise<T>,
): Promise<{ value: T; gaps: number[] }> {
  await obEval(
    vault,
    `(async()=>{
      const debuggerClient=require('@electron/remote').getCurrentWebContents().debugger;
      const attached=debuggerClient.isAttached();
      if(!attached)debuggerClient.attach('1.3');
      const targets=[];
      const found=Promise.withResolvers();
      const listener=(_event,method,params)=>{
        if(method==='Target.attachedToTarget'&&params.targetInfo.title==='zotlit-zotero-reads'){targets.push(params.sessionId);found.resolve();}
      };
      debuggerClient.on('message',listener);
      try{
        await debuggerClient.sendCommand('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true});
        let timer;
        try{await Promise.race([found.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ZoteroReads worker did not attach')),3000);})]);}finally{clearTimeout(timer);}
        if(targets.length!==1)throw Error('Expected one ZoteroReads worker; got '+targets.length);
        const session=targets[0];
        const installed=await debuggerClient.sendCommand('Runtime.evaluate',{expression:
          'globalThis.__zotlitTestTimer={gaps:[],previous:performance.now()};__zotlitTestTimer.id=setInterval(()=>{const now=performance.now();__zotlitTestTimer.gaps.push(now-__zotlitTestTimer.previous);__zotlitTestTimer.previous=now;},50);'
        },session);
        if(installed.exceptionDetails)throw Error('Worker timer probe did not start');
        globalThis.__zotlitWorkerProbe={debuggerClient,attached,listener,session};
        return true;
      }catch(error){
        await debuggerClient.sendCommand('Target.setAutoAttach',{autoAttach:false,waitForDebuggerOnStart:false,flatten:true});
        debuggerClient.removeListener('message',listener);
        if(!attached)debuggerClient.detach();
        throw error;
      }
    })()`,
  );
  let gaps: number[] = [];
  let value: T;
  try {
    value = await measure();
  } finally {
    gaps = JSON.parse(
      await obEval(
        vault,
        `(async()=>{
          const {debuggerClient,attached,listener,session}=globalThis.__zotlitWorkerProbe;
          try{
            const reply=await debuggerClient.sendCommand('Runtime.evaluate',{expression:
              '(()=>{clearInterval(__zotlitTestTimer.id);const gaps=__zotlitTestTimer.gaps;delete globalThis.__zotlitTestTimer;return JSON.stringify(gaps);})()',returnByValue:true
            },session);
            if(reply.exceptionDetails)throw Error('Worker timer probe failed');
            return reply.result.value;
          }finally{
            await debuggerClient.sendCommand('Target.setAutoAttach',{autoAttach:false,waitForDebuggerOnStart:false,flatten:true});
            debuggerClient.removeListener('message',listener);
            if(!attached)debuggerClient.detach();
            delete globalThis.__zotlitWorkerProbe;
          }
        })()`,
      ),
    ) as number[];
  }
  return { value, gaps };
}
