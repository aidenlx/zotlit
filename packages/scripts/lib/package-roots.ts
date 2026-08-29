import { findWorkspaceDir } from "@pnpm/find-workspace-dir";
import { findPackageJSON } from "node:module";
import { dirname } from "node:path";

export function getPackageRoot(callerModulePath: string): string {
  const packageJsonPath = findPackageJSON("./", callerModulePath);
  if (!packageJsonPath)
    throw new Error(`Could not find package.json above ${callerModulePath}.`);
  return dirname(packageJsonPath);
}

export async function getWorkspaceRoot(cwd: string): Promise<string> {
  const workspaceRoot = await findWorkspaceDir(cwd);
  if (!workspaceRoot)
    throw new Error("Could not find the pnpm workspace root.");
  return workspaceRoot;
}
