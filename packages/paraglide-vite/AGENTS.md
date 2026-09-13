# @zotlit/paraglide-vite

## Commands

Run `build` / `test` / `lint` through Turbo (see root AGENTS.md).

## Compilation lifecycle

Read [src/index.ts](src/index.ts) before changing generation. Await initial compilation in Vite configuration: framework plugins can resolve generated imports before `buildStart`. Keep compiler output hashes and input tracking local to each plugin instance. Vite owns filesystem watching and hot updates.

[src/index.test.ts](src/index.test.ts) exercises real Vite startup and filesystem watching. On macOS, run with filesystem watcher access; sandboxed watchers can start successfully and deliver no events.
