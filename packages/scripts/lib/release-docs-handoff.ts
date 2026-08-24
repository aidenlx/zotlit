// Stable Obsidian release handoff before the release mutation continuation.

import { prerelease } from "semver";

export interface ReleaseDocsHandoffAdapter {
  confirm(prompt: {
    message: string;
    initialValue: boolean;
  }): Promise<boolean> | boolean;
  handoff(command: string): Promise<void> | void;
}

export async function runReleaseWithDocsHandoff({
  targets,
  adapter,
  continueRelease,
}: {
  targets: readonly { app: "obsidian" | "zotero"; version: string }[];
  adapter: ReleaseDocsHandoffAdapter;
  continueRelease: () => Promise<void> | void;
}): Promise<void> {
  const stableObsidian = targets.find(
    ({ app, version }) => app === "obsidian" && prerelease(version) === null,
  );
  if (stableObsidian !== undefined) {
    const handoffAccepted = await adapter.confirm({
      message: "Scan documentation availability before this stable release?",
      initialValue: true,
    });
    if (handoffAccepted) {
      await adapter.handoff(`pnpm docs:availability ${stableObsidian.version}`);
      return;
    }
  }

  await continueRelease();
}
