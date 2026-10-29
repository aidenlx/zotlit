# Brief: ZotLit landing page prototype, round 4 ("desk at your side, restyled")

Folder: `apps/docs/.scratch/prototype-desk-r4/`. Open `prototype-desk-r4.html`; the bottom
bar switches between the two style takes (arrow keys or `#A` / `#B`).

## Verdict on round 3

> the style should be more modern and academic, current look like toy. use B, the deck is
> larger when in main page, shrink when used as ToC / also follow /better-ui

Round 3's variant B ("Desk at your side") is the structure. Round 4 keeps it and changes two
things: the style, and how the desk moves from the hero into the contents column.

## Structure (both takes)

- **Hero.** The approved copy on the left and right, then the desk as **Figure 1** at the
  full content width (1240 px). Numbered markers sit on the eight objects. The caption
  ("Figure 1. Your research desk, seen from above...") has a key under it: the eight jobs as
  buttons with the object icon, number and name. Pointing at a key row rings its object on
  the desk and fades the others; selecting it scrolls to the job.
- **Shrink into the contents column (≥1024 px, motion on).** As the hero desk scrolls past
  the top of the viewport, a fixed copy of it shrinks to the right and moves into the
  sticky column beside the job sections. The scroll position drives it directly: scroll
  back and it grows back. The width reaches the column size in the first 55% of the way, so
  the shrinking desk never covers the page that scrolls up under it. The numbered markers
  fade out on the way; the ring on the job in view and the fade on the others fade in. The
  contents list fades in with the same progress.
- **Docked.** A 300 px desk at the top of the sticky column, with the job in view ringed
  and the others faded, and under it a "Contents" list of the eight jobs (number + name; the
  current one on a raised row) and an Install ZotLit link. Selecting a desk object or a list
  row jumps to the job.
- **Motion off or reduced motion.** No moving copy. The hero desk stays in place, and the
  docked desk and the contents list cross-fade in (150 ms) when the job column reaches the
  top.
- **Under 1024 px.** The hero desk and its key (one column on phones). Once the figure has
  scrolled away, a bar of the eight object icons slides in at the top, with the current job
  marked and its name under the icons.
- **Job sections.** Number "03 / 08", heading in the display face, one outcome line, the
  demos with their captions, then the parts list ("In this job", two columns at ≥1280 px).
- **Setup.** "Set up your desk": the three install steps in one raised card, what you need,
  the optional Zotero add-ons, privacy and licence.

## The two style takes

| | A · Journal | B · Lab |
| --- | --- | --- |
| Feel | A printed journal: warm paper, serif headings | A research tool: cool slate, one sans face |
| Display | Newsreader 400, tracking -0.012em | Inter 600, tracking -0.032em |
| Text / labels | Source Sans 3 / IBM Plex Mono | Inter / JetBrains Mono |
| Ground / ink | #f7f5f0 / #1b2029 | #f5f7fa / #0f1729 |
| Desk | Cloth and wood tones (blue-grey books, oxblood, green notebook) | One slate-blue family |

Both have their own dark palettes for the page and the desk.

## What changed from the toy look

- Display faces: Newsreader or Inter in place of Young Serif.
- Surfaces: a 1 px shadow ring (better-ui values) on a transparent border in place of the
  flat 5 px offset shadow.
- The desk drawing: 1 px hairline edges in place of 1.5 px, soft blurred object shadows,
  muted desaturated colours, no drop-in, no hover lift, no idle highlighter loop.
- Callouts: small numbered markers and a figure key in place of floating name tags.
- Motion: one staged hero entrance (title, copy, actions, figure; 100 ms apart; opacity,
  4 px blur, 12 px rise; 300 ms ease-out), state changes at 150 ms on opacity or colour,
  buttons press to 0.96, movement only under `prefers-reduced-motion: no-preference`, and
  no transitions during a colour-scheme switch.

## Build

The page is generated: `build/page-r4.jsx` holds the shared `R4_Page({ v })`;
`variant-A.jsx` and `variant-B.jsx` only pick the style key; `build/head-r4.html` holds the
tokens. To rebuild:

```
python3 build/build_base.py
cp base.html prototype-desk-r4.html
python3 <prototype skill>/assemble.py prototype-desk-r4.html variant-A.jsx variant-B.jsx
```

## Known limits

- A demo shows its first frame until it reaches the middle of the viewport (the kit's
  one-loop-at-a-time rule).
- The docked desk is 300 px wide, so its objects are small; the contents list carries the
  names.
- The prototype switcher bar covers part of the page bottom; it is prototype chrome only.
