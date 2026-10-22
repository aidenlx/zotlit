import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prepareRunWindow } from "./background-throttling.ts";
import { reachable, runVaultScript, workspaceRoot } from "./e2e-run-fixture.ts";
import { obJson } from "./obsidian-cli.ts";
import { clearVault, e2eVaultDir } from "./vault-script.ts";
import { reloadWindow } from "./window-reload.ts";

describe.skipIf(!reachable)("Window reload", () => {
  const vaultPath = e2eVaultDir(workspaceRoot, "window-reload-vault");
  let vaultId = "";

  beforeAll(async () => {
    await clearVault(runVaultScript, vaultPath);
    const created = await runVaultScript(["create", vaultPath]);
    vaultId = created.stdout.trim().split("\n")[0]!.trim();
    await prepareRunWindow(vaultId);
  }, 180000);

  afterAll(async () => {
    await runVaultScript(["remove", vaultPath, "--purge"]);
  }, 120000);

  it("loads ZotLit in startup order, where its rename handlers run before the metadata cache moves the path", async () => {
    const recorder = `const until=async(what,ok)=>{const end=Date.now()+10000;while(!ok()){if(Date.now()>end)throw new Error('Timed out: '+what);await new Promise(r=>setTimeout(r,20));}};
      const listed=()=>[...(app.vault._.rename??[])];
      const rename=async(from,to)=>{
        const file=app.vault.getFileByPath(from);
        await until('cache of '+from,()=>app.metadataCache.getFileCache(file));
        const entries=listed();const fns=entries.map(e=>e.fn);const cached=new Map();
        entries.forEach((entry,i)=>{entry.fn=function(target,...rest){cached.set(entry,app.metadataCache.getFileCache(target)!==null);return fns[i].call(this,target,...rest);};});
        try{await app.vault.rename(file,to);await until('rename dispatch',()=>cached.size===entries.length);}
        finally{entries.forEach((entry,i)=>{entry.fn=fns[i];});}
        return cached;
      };`;
    const toggled = await obJson<{ sources: string[]; cached: boolean[] }>(
      vaultId,
      `(async()=>{${recorder}
        await app.vault.create('startup-order.md','# Startup order\\n');
        await app.plugins.disablePlugin('zotlit');
        const unloaded=new Set(listed());
        await app.plugins.enablePlugin('zotlit');
        const added=listed().filter(e=>!unloaded.has(e));
        const cached=await rename('startup-order.md','startup-order-moved.md');
        window.__ztListenersBeforeReload=new Set(listed());
        return JSON.stringify({sources:added.map(e=>String(e.fn)),cached:added.map(e=>cached.get(e))});
      })()`,
    );
    expect(toggled.cached.length).toBeGreaterThan(0);
    expect(toggled.cached).not.toContain(false);

    await reloadWindow(vaultId);
    const startup = await obJson<boolean[]>(
      vaultId,
      `(async()=>{${recorder}
        const sources=new Set(${JSON.stringify(toggled.sources)});
        const cached=await rename('startup-order-moved.md','startup-order.md');
        const before=window.__ztListenersBeforeReload??new Set();
        return JSON.stringify(listed().filter(e=>!before.has(e)&&sources.has(String(e.fn))).map(e=>cached.get(e)));
      })()`,
    );
    expect(startup).toContain(false);
  }, 120000);
});
