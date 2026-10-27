// The listing Profile: the default Profile with a static annotation listing in
// a Managed Block in place of its Query Block, for cases that check
// Annotations rendered into the note body and refilled on update.
import { obRun, obRunUntil } from "./obsidian-cli.ts";

/**
 * In-app source of a function from a Profile source to its listing Profile
 * source. It throws where the source has no Query Block.
 */

export const LIST_ANNOTATIONS_JS = `(source)=>{const listed=source.replace(/## Annotations\\n\\n\`\`\`zotquery\\n[\\s\\S]*?\`\`\`\\n/,'{% managed %}\\n{% for annotation in zt.annotations %}\\n{% render_annotation annotation %}\\n{% endfor %}\\n{% endmanaged %}\\n');if(listed===source)throw new Error('Default Profile has no Query Block');return listed;}`;

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
  await obRun(
    vaultId,
    async ({ app, zotlit, page }, { restore }) => {
      const profile = zotlit.services.profile;
      if (restore) await profile.restoreDefault();
      const listed = page.listAnnotations(profile.getBuiltInSource());
      const path = profile.defaultDocumentPath;
      const folder = path.slice(0, path.lastIndexOf("/"));
      if (folder && !app.vault.getFolderByPath(folder))
        await app.vault.createFolder(folder);
      await app.vault.create(path, listed);
    },
    { restore },
  );
  await obRunUntil(
    vaultId,
    ({ zotlit }) =>
      !!zotlit.services.profile.resolveProfile("default")?.document,
    undefined,
    { what: "The default Profile did not read its document" },
  );
}
