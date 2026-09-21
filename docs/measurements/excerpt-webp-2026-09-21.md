# Excerpt image encoding measurement

Run date: 2026-09-21.

Runtime: Obsidian 1.14.2, Electron 43.7.1, Chromium 150.0.7871.250,
Node.js 24.21.0, macOS. The run used the live Obsidian renderer through its
CLI `eval` command.

The four 640 × 360 canvases contain representative text, equation, ink, and
image-heavy crops. Each canvas includes deterministic black/white samples with
alpha values 32, 96, 160, 224, and 255. PNG and WebP were encoded from the
same canvas. WebP pixels were decoded with WebCodecs `ImageDecoder` and
compared byte-for-byte as RGBA, including the translucent samples.

| crop | PNG bytes | WebP bytes | PNG encode (ms) | WebP encode (ms) |
| --- | ---: | ---: | ---: | ---: |
| text | 74039 | 8142 | 5.399999976158142 | 3.700000047683716 |
| equation | 13424 | 13116 | 1.300000011920929 | 2.800000011920929 |
| ink | 18301 | 2948 | 3.699999988079071 | 2 |
| image-heavy | 9289 | 4662 | 3.200000047683716 | 3.199999988079071 |

These values are one local run. They describe this corpus and runtime only;
they do not establish a universal size or speed advantage for WebP.
