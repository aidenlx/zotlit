# Ink is stored as Zotero smooths it, and one stroke is one Annotation

The ink tool in Obsidian's PDF reader stores each Ink Stroke as the points Zotero's own reader would store for the same hand movement: two Chaikin passes that keep the first and last points, then a filter that drops every point under one PDF point from the last kept one, rounded to three decimals. Every renderer draws the stored points as straight segments with round caps and joins; nothing is curved at render time, and pressure is never used. One Ink Stroke makes one ink Annotation, created through the Zotero Local API with its own Page Label and Sort Index.

Zotero's reader, its canvas renderer, its Excerpt Image renderer, and its PDF export all draw ink as straight segments between the stored points. A curve drawn in ZotLit from sparse points would look different in Zotero, and sparse points would weaken Zotero's vertex-based eraser. The smoothing therefore has to be in the stored points, and it has to be Zotero's, so that the two applications show the same ink and point density.

## Considered Options

- **Curves at render time over sparse stored points** (rejected): the approach of pdf.js and tldraw. ZotLit would show a smooth stroke, and Zotero would show a chain of straight chords over the same points.
- **A different smoother or a simplifier** (rejected): a streamline or a point-reduction pass changes the density Zotero's eraser and merge expect, and the two applications drift apart.
- **Zotero's smoothing, stored; straight segments drawn** (chosen): a port of Zotero's `smoothPath` runs on every published frame and at release, so the stroke the user sees while drawing is the stroke that is saved.
- **Append a stroke to the previous ink Annotation, as Zotero does** (rejected): the append is a position update that drops the Annotation's Excerpt Image, and it makes each position larger. One create per stroke is simpler, and the user merges strokes in Zotero when wanted.

## Consequences

- The Live Stroke and the saved mark use one path builder, so the handoff at release does not change the shape. ZotLit shows the smoothed path while drawing, where Zotero shows raw points until pointer-up.
- A stroke whose rounded position would pass the sixty-five-thousand-character ceiling ends there: the finished part is created as its own Annotation, and the stroke continues with the pointer and the tool held, as a new part that begins at the finished part's last point and takes the next sample, so the two Annotations meet. The new part is measured afresh. The length is measured in full only near the ceiling, because one more sample adds at most seven smoothed points.
- The width is one value per Annotation, chosen from a short set of Zotero's own width steps (0.4, 1, 2, 3, 5, 8, and 12 points) before the press, and fixed for the stroke. Colour is fixed at the press too.
- Handwriting one word gives several Annotations.
