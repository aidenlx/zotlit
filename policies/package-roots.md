# Package and workspace roots

- In package-root files such as `vite.config.ts`, use `import.meta.dirname` as `packageRoot`.
- In package-owned scripts one directory below the root, set `packageRoot` with `resolve(import.meta.dirname, "..")`; this also works with `node script.js`.
- In deeper modules, use `getPackageRoot(import.meta.filename)` from `@zotlit/scripts/package-roots`; it works with any runner (`node`, Vitest, IDE test runs), with or without a package-manager run-script.
- Find `workspaceRoot` with `getWorkspaceRoot(cwd)` from `@zotlit/scripts/package-roots`, normally passing `import.meta.dirname` as `cwd`.
- Name roots `packageRoot` and `workspaceRoot`, and name the manifest path `packageJsonPath`.
