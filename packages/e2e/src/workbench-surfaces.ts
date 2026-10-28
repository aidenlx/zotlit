import { obRun } from "./obsidian-cli.ts";

/**
 * Waits for `wait`; when it fails, adds the vault's Template Workbench
 * surfaces to the error, so the failure shows which leaves opened and where.
 */
export async function withWorkbenchSurfaces<T>(
  vaultId: string,
  wait: Promise<T>,
): Promise<T> {
  try {
    return await wait;
  } catch (error) {
    const surfaces = await obRun(
      vaultId,
      ({ page }) => JSON.stringify(page.workbenchSurfaces()),
      undefined,
    ).catch((reason: unknown) => `unreadable: ${String(reason)}`);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nTemplate Workbench surfaces: ${surfaces}`,
      { cause: error },
    );
  }
}
