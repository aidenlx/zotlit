---
name: docs-screenshot
description: Make a screenshot or illustration for the docs site, changelog, or blog — stage the scene in the running apps, capture the windows, and compose them over a wallpaper. Use when a docs page needs a new or updated image.
---

# Docs screenshot

A docs image is a **composition**: one or more captures, each a layer framed as a macOS window or a callout, over a wallpaper. It matches the CleanShot X style of the images under `apps/docs/public/img/`.

## Steps

1. **Plan the shot.** Name the one thing the reader must see, then pick the layers that show it: a whole window, two windows side by side, a window with a zoomed callout. Done when you can write the image's alt text in one sentence.

2. **Stage the scene** on real data that the apps made. Open the demo Vault Case — `pnpm fixture open --vault-case demo --local-api` — and read [`docs/fixture.md`](../../../docs/fixture.md) for what it holds. When the shot needs data the Fixture lacks, create it in Zotero with Zotero's own tools, then add the resulting rows to the Fixture Spec, so the next rebuild reproduces the scene. Drive the apps with `/obsidian-debug` and `/zotero-rdp-debug`. Done when every element in the planned shot is on screen with realistic content — no test titles, no placeholder text.

3. **Capture each layer** as a PNG in `.scratch/`:
   - Obsidian: `obsidian-cli.ts vault=<id> dev:screenshot path=<abs>` gives the window content at 2×, without a frame. Frame it with the default layer options.
   - A capture that already has its own window frame: set `lights`, `border`, and `shadow` to `false`.
   - `screencapture` returns a black image when the terminal lacks Screen Recording permission. Use the app's own capture, or ask the user to grant the permission.

   Done when each capture shows its planned state. Look at each capture, and confirm through the DOM when a capture may be stale.

4. **Compose** with the script beside this file:

   ```bash
   node .agents/skills/docs-screenshot/compose.mjs <out.webp> <capture.png | layout.json>
   ```

   A single capture becomes one centred window. For any other arrangement, write a layout file in `.scratch/` — layers with position, scale, crop, and chrome options. `compose.mjs --help` prints the layout shape.

5. **Place** the `.webp` under `apps/docs/public/img/<collection>/`, and reference it with a root-relative `/img/...` path and alt text that says what the reader sees. The rules for images are in [`apps/docs/AGENTS.md`](../../../apps/docs/AGENTS.md) → Images.

6. **Verify.** Look at the final image at full size, then run `pnpm exec turbo run build --filter=@zotlit/docs`. Done when the image shows the planned message and the build passes.

## Wallpaper

`wallpaper.webp` is the macOS Tahoe Light wallpaper, cropped to 16:10 at 3840×2400. It is the default backdrop for every image, so the docs images stay consistent. Set `"wallpaper"` in a layout file to use a different image for one composition.
