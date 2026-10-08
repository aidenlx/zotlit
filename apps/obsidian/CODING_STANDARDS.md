# Coding standards

Review-only policy index for apps/obsidian. Load these during standards review. Apply the root standards too; local exceptions have the scope stated below. Keep implementation context in `AGENTS.md`.

Record each meaningful agent mistake in the relevant policy on its first occurrence, through `/retro`
or a direct edit. State the expected behavior and what the reviewer must check.

## Policies

- [CLI text](policies/cli-text.md)
- [File operations](policies/file-ops.md)
- [Hover popovers](policies/hover-popover.md)
- [Local storage](policies/local-storage.md)
- [Pop-out windows](policies/popout-windows.md)
- [Tailwind-first](policies/tailwind-first.md)
- [Theme hooks](policies/theme-hooks.md)
- [Tooltips](policies/tooltips.md)
- [UI seams](policies/ui-seams.md)

## UI roots

Mark each plugin UI root (`ItemView.contentEl`, modal `contentEl`, settings pane) with `class="zt-root"` — that scope enables the Tailwind preflight so semantic HTML and border utilities render clean. See the skill's **Scoped preflight** section.

## Logging

Import `getLogger` from `@/lib/log` — wraps LogTape with parent category `["zotlit", "obsidian"]`:

```ts
import { getLogger } from "@/lib/log";
const logger = getLogger("settings");
```

`LoggingService` owns `configure()` — don't call it anywhere else. The ZoteroReads worker has its own LogTape instance: `zotero-reads/worker.ts` configures it to forward records to the renderer at the plugin's log level.

## View state and menus

View/modal state uses a zustand **vanilla store + React context, one per instance** — not the global `create()` hook, not signals. Follow `src/views/annot-view/store.ts`.

Menus and popovers are Obsidian's own `Menu` and popover primitives, built imperatively and shown from the gesture that opens them — inside a Preact tree as much as in vanilla DOM. `src/views/annot-view` is the pattern: `presentation.ts` answers which entries exist, `menus.ts` fills a `Menu` from them, `actions.tsx` shows it, and the component calls the action; `pane-menu.ts` puts the same entries in the pane menu. A menu opened from a control is anchored under it with `showMenuAtButton` from `src/lib/menu.ts`, which keeps a keyboard-activated control and a popout host both correct; `showAtMouseEvent` is for a right-click. Obsidian owns placement, viewport clamping, theme, and chrome ([ADR 0044](docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md)).
