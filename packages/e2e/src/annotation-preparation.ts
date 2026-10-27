// Hold the captured-card preparation before it writes an excerpt, including
// when importing is disabled. The display's image resolver is a different
// consumer, so it must remain free to paint while this user action waits.
import { createRequire } from "node:module";
import { join } from "node:path";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

/** Installs a reversible probe; the eval caller supplies its trial `s` and `services`. */
export async function annotationPreparationProbe(): Promise<string> {
  const root = await getWorkspaceRoot(import.meta.dirname);
  const load = createRequire(join(root, "apps/obsidian/package.json"));
  const effectPath = load.resolve("effect/Effect");
  return `
    const Effect=require(${JSON.stringify(effectPath)});
    const context=await services.runtime.context();
    s.preparation=context.mapUnsafe.get('zotlit/excerpt-image/ExcerptPreparation');
    if(!s.preparation)throw new Error('ExcerptPreparation service missing');
    s.originalPreparation=s.preparation.forCard;
    s.preparation.forCard=options=>Effect.gen(function*(){
      s.started=true;s.prepareCalls++;s.options=options;
      yield* Effect.promise((_signal)=>s.gate);
      return yield* s.originalPreparation.call(s.preparation,options);
    }).pipe(Effect.ensuring(Effect.sync(()=>{s.finished++;})));
  `;
}

/** Starts a new held gesture; interruption still completes its probe before release. */
export const resetAnnotationPreparation = `
  s.started=false;s.prepareCalls=0;s.finished=0;s.options=null;
  s.gate=new Promise(resolve=>s.release=resolve);
`;

export const restoreAnnotationPreparation = `
  s.release?.();
  if(s.originalPreparation)s.preparation.forCard=s.originalPreparation;
`;
