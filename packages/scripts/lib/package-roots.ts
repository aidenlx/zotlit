import { findWorkspaceDir } from "@pnpm/find-workspace-dir";
import { dirname } from "node:path";

export function getPackageRoot(): string {
  const packageJsonPath = process.env.npm_package_json;
  if (!packageJsonPath) throw new Error("npm_package_json is not set.");
  return dirname(packageJsonPath);
}

export async function getWorkspaceRoot(cwd: string): Promise<string> {
  const workspaceRoot = await findWorkspaceDir(cwd);
  if (!workspaceRoot)
    throw new Error("Could not find the pnpm workspace root.");
  return workspaceRoot;
}
