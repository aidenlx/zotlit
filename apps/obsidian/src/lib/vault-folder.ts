// Folder creation over the Vault tag, for Effect code that writes into a folder.
import { Effect } from "effect";
import { TFile, TFolder } from "obsidian";

import { Vault } from "@/lib/obsidian-vault";
import { VaultFolderBlockedError } from "@/lib/vault-errors";

/**
 * Make sure the folder at the normalized vault path `path` exists: the vault
 * root and a folder already there succeed, a file there fails with
 * {@link VaultFolderBlockedError}, and otherwise the folder is created.
 */
export const ensureVaultFolder = Effect.fnUntraced(function* (path: string) {
  if (path === "/") return;
  const vault = yield* Vault;
  const existing = yield* vault.getAbstractFileByPath(path);
  if (existing instanceof TFolder) return;
  if (existing instanceof TFile)
    return yield* new VaultFolderBlockedError({ path });
  yield* vault.createFolder(path);
});
