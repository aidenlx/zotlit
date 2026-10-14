// The listing Profile: the default Profile with a static annotation listing in
// place of its Query Block, for cases that check Annotations rendered into the
// note body.
import { obEval, obEvalUntil } from "./obsidian-cli.ts";

/**
 * In-app source of a function from a Profile source to its listing Profile
 * source. It throws where the source has no Query Block.
 */
export const LIST_ANNOTATIONS_JS = `(source)=>{const listed=source.replace(/## Annotations\\n\\n\`\`\`zotquery\\n[\\s\\S]*?\`\`\`\\n/,'{% for annotation in zt.annotations %}\\n{% render_annotation annotation %}\\n{% endfor %}\\n');if(listed===source)throw new Error('Default Profile has no Query Block');return listed;}`;

/**
 * Write the listing Profile as the default Profile's document, and wait until
 * the default Profile reads it.
 *
 * @param restore whether to restore the default Profile first, for a vault
 *   where a case before this one customized it.
 */
export async function useListingProfile(
  vaultId: string,
  { restore = false }: { restore?: boolean } = {},
): Promise<void> {
  await obEval(
    vaultId,
    `(async()=>{const profile=app.plugins.plugins.zotlit.services.profile;${restore ? "await profile.restoreDefault();" : ""}const listed=(${LIST_ANNOTATIONS_JS})(profile.getBuiltInSource());const path=profile.defaultDocumentPath;const folder=path.slice(0,path.lastIndexOf('/'));if(folder&&!app.vault.getFolderByPath(folder))await app.vault.createFolder(folder);await app.vault.create(path,listed);return true;})()`,
  );
  const ready = await obEvalUntil(
    vaultId,
    "String(!!app.plugins.plugins.zotlit.services.profile.resolveProfile('default')?.document)",
    { expected: "true" },
  );
  if (!ready) throw new Error("The default Profile did not read its document");
}
