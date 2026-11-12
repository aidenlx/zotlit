# Brief: planned-camera lesson recordings

**Worktree:** `/Users/aidenlx/worktrees/zotlit-v2/docs-learn-recordings`, branch `docs/learn-recordings` (made from `docs/site-v3`). Work only there.

## Goal

The `/learn` lessons get new clips that work like a Screen Studio export.
- **Camera:** each clip opens on the whole Obsidian window. The camera then zooms in to where the action happens (a click, typing) and eases between shots. The clip ends framed on the result that the step's check line describes, at a size you can read.
- **Pointer:** at the end of a clip, the drawn pointer stays at or near the last action. The owner said: "when you record it, you should not put the cursor back to the edges when the video ends."

The site shows these clips in a checklist lesson about 700 px wide, beside the reader's own Obsidian. A second agent builds that site on another branch. The only thing it needs from you is the file contract below.

## Facts already established

- `packages/e2e/src/docs-walks/docs-walk.ts` records a CDP screencast of the 1440×860-point window. The raw PNG frames are **2880×1720**, double size: for example `/Users/aidenlx/worktrees/zotlit-v2/prototype-lesson-shell/.scratch/docs-walks/connect-zotero-to-obsidian/step-3.frames/`.
- `encodeClip` today scales the frames down to 1440 wide. So the camera can be baked in at encode time: crop each 2× frame to the view, then scale the crop to 1440×860. A 2× zoom then stays sharp.
- Every action in a clip goes through the drawn-pointer API (`point`, `pointAt`, `park`, `type`, `keys`) in `startRecording`. That is where to log the camera events. Each frame's `t` uses the clock `(performance.timeOrigin + performance.now()) / 1000`.
- The walks end most clips with `pointer.park(b.right - 14, b.bottom - 24)` or a similar pane-corner park. Those are the "edges" the owner rejects. Run `rg -n "\.park\(" packages/e2e/src/docs-walks/` to find them.
- Read `packages/e2e/AGENTS.md`, section "Docs walks": how to run a walk, the Desktop Slot, `DOCS_WALK_RECORD=1`, `recordZotero`, and LFS.

## What to build

1. **Event log.** In the recorder, log each pointer action with its time, on the frames' clock, and its geometry in CSS px:
   - `point` and `pointAt`: the point, plus the element's rect when there is one.
   - `park`: the point.
   - `type`: the input's rect.
   - `keys`: the focused element's or caret's rect, where you can get it.

   Also add `look(target, options?)` to `DocsWalkPointer`. It marks a region for the camera to frame without moving the pointer, for example the result a step's check line names. Write the events beside the frames (`camera.json`).

2. **Planner.** Write a pure function from events to a camera track (keyframes of a view rect in CSS px over time). Unit-test it under `packages/e2e/src/**/*.test.ts`; `pnpm --filter @zotlit/e2e test` runs them. Starting values (tune them by looking at the results):
   - Open on the whole window, held for at least about 0.7 s.
   - On a click or typing, frame the action at about 2× (a view of about 720×430). Clamp the view inside the window and keep the 1440:860 ratio.
   - Arrive about 150 ms before the click. Ease about 600 ms in-out.
   - While the following actions fall inside the central part of the current view, stay. When the next target is near and the zoom is the same, pan. Zoom out only when the next target is far away or needs a wider view.
   - On `look`, fit its rect with padding, with zoom between 1× and 2×.
   - Hold the last shot to the end of the clip, which is the clip's rest on the result.
   - A hand-written track file, `src/docs-walks/<slug>.camera/<name>.json`, replaces the planned track for that clip, so a bad plan can be corrected by hand.

3. **Encode.** Crop every frame to its view at the frame's real scale (frame width ÷ 1440), scale to 1440×860 with lanczos, and keep the real frame timing (the existing concat timing). Use `sharp` if the workspace has it; otherwise use ffmpeg.
   - Keep the outputs `step-<n>.webm` (VP9) and `step-<n>.mp4` (H.264).
   - Also write **`step-<n>.poster.webp`**: the final baked frame, 1440×860, quality about 82. **This is the contract with the site agent.** The site uses it as the clip's poster and as the still for reduced motion.

4. **Walks.** For the six lesson walks (not `landing.walk.ts`):
   - Remove every end-of-clip park to a pane edge or corner. The pointer stays at the last action. If it would cover the text the check names, move it by no more than about 40 px, toward empty space.
   - End each recorded step with `look(...)` on the element or elements the step's check names. The check text is in `apps/docs/content/learn/<slug>.mdx`, inside `<Check>`.
   - A mid-clip park that clears a typing target can stay if it stays near the target.

5. **Zotero-window clips.** `recordZotero` uses `screencapture -v`. Keep those clips unzoomed this round, still write their poster (the last frame), and list which clips they are.

6. **Record again.** Record all six lesson walks with `DOCS_WALK_RECORD=1`. Run one walk per run:
   - Build the dev bundles first (`pnpm exec turbo run build:dev --filter=@zotlit/obsidian --filter=@zotlit/zotero`).
   - Exit 75 means another run holds a slot. Wait and retry.
   - Only the Obsidian and Zotero windows may appear in a clip.
   - Keep the step `.webp` composites as they are, unless a capture is needed.

## Check before you commit

- Look at every poster and at least three sampled frames of each clip with the Read tool. The camera must never show outside the window, and the rest frame must show the check's subject at a readable size.
- If a plan is wrong, write a hand override file rather than lowering the planner for everyone.
- Check file sizes: report them, and flag any clip over about 1.5 MB.
- Run `pnpm --filter @zotlit/e2e typecheck`, `pnpm --filter @zotlit/e2e test`, `pnpm lint` and `pnpm format`.
- Update the "Docs walks" section of `packages/e2e/AGENTS.md` in a few lines: the camera plan, `look`, the override files, and the poster. Follow its existing style.

## Git

- Commit on `docs/learn-recordings` with conventional messages about the change, with no AI attribution. The media are Git LFS; check that `.gitattributes` covers `apps/docs/public/img/learn`.
- Push: `git -C <worktree> lfs push origin docs/learn-recordings`, then `git -C <worktree> push --no-verify -u origin docs/learn-recordings`. Never push to main or next, and never force-push.
- Run single `git -C <worktree> …` commands. Compound shell commands with git are refused.

## Report

Write the report in ASD-STE100 Simplified Technical English and keep it short:
- the commits;
- the per-clip sizes;
- which clips you could not plan well, and why;
- what you checked by eye.
