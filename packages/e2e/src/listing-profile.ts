// The listing Profile: the default Profile with a static annotation listing in
// a Managed Block in place of its Query Block, for cases that check
// Annotations rendered into the note body and refilled on update.
import { obRun, obRunUntil } from "./obsidian-cli.ts";

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
      const { bridge, profileService: profile } = zotlit.services;
      if (restore) await bridge.runPromise(profile.restoreDefault);
      const listed = page.listAnnotations(
        bridge.runSync(profile.getBuiltInSource),
      );
      const path = bridge.runSync(profile.defaultDocumentPath);
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
      !!zotlit.services.bridge.runSync(
        zotlit.services.profileService.resolveProfile("default"),
      )?.document,
    undefined,
    { what: "The default Profile did not read its document" },
  );
}
