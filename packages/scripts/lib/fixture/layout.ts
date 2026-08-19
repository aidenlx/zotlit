// Host-native paths for one built Fixture.

import { join } from "node:path";

export const FIXTURE_PLUGIN_ID = "zotlit";

/** Every path a maintainer or a test needs from a built Fixture. */
export interface FixtureLayout {
  /** The whole disposable tree — `discardFixture` removes exactly this. */
  root: string;
  /** Stands in for a Zotero data directory; holds `zotero.sqlite`. */
  dataDir: string;
  databasePath: string;
  /** Host-native files referenced by `linked_file` Attachment rows. */
  linkedFilesDir: string;
  /** Stands in for a Zotero profile directory; its `prefs.js` names `dataDir`. */
  profileDir: string;
  vaultDir: string;
  pluginDir: string;
  pluginDataPath: string;
}

/** Where the Fixture lives, under the workspace scratch area (git-ignored). */
export function getFixtureRoot(workspaceRoot: string): string {
  return join(workspaceRoot, "tmp", "acceptance-fixture");
}

export function getFixtureLayout(root: string): FixtureLayout {
  const dataDir = join(root, "zotero-data");
  const vaultDir = join(root, "zt-fixture-vault");
  const pluginDir = join(vaultDir, ".obsidian", "plugins", FIXTURE_PLUGIN_ID);
  return {
    root,
    dataDir,
    databasePath: join(dataDir, "zotero.sqlite"),
    linkedFilesDir: join(root, "linked-files"),
    profileDir: join(root, "zotero-profile"),
    vaultDir,
    pluginDir,
    pluginDataPath: join(pluginDir, "data.json"),
  };
}
