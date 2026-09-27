#!/usr/bin/env node
// Compose app captures into one docs screenshot: each capture is a layer, optionally
// framed as a macOS window, placed over a wallpaper.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import sharp from "sharp";

const USAGE = `usage: node .agents/skills/docs-screenshot/compose.mjs <out.webp|out.png> <capture.png | layout.json>

A capture.png becomes one window layer, centred with a margin.
A layout.json composes any number of layers:

  {
    "wallpaper": "bg.png",               // default: wallpaper.webp beside this script
    "canvas": { "width": 3460, "height": 2176 },
                                         // default: the layers' bounding box plus "margin"
    "margin": 0.072,                     // share of the bounding-box width, per side
    "layers": [                          // drawn in order, last on top
      {
        "src": "obsidian.png",           // paths resolve from the layout file
        "x": 0, "y": 0,                  // top-left, in canvas px after scaling
        "width": 3024,                   // scaled width, aspect kept (default: natural)
        "crop": { "left": 0, "top": 0, "width": 800, "height": 600 },
                                         // source px, applied before chrome
        "radius": 22,                    // source px; 0 for square corners
        "lights": true,                  // traffic lights at 2x macOS window offsets
        "border": true,                  // hairline window border
        "shadow": true                   // soft drop shadow
      }
    ]
  }

out.webp is encoded with cwebp at the highest quality under ${524288} bytes;
out.png is lossless.`;

// @fumari/image-size reads at most this many bytes, and a WebP must fit whole
// or the docs build fails with "Failed obtain image size".
const MAX_WEBP_BYTES = 524288;
const SHADOW_PAD = 120;

const [out, input] = process.argv.slice(2);
if (!out || !input || out === "--help") {
  console.error(USAGE);
  process.exit(out === "--help" ? 0 : 1);
}

const layout =
  extname(input) === ".json"
    ? { ...JSON.parse(readFileSync(input, "utf8")), base: dirname(resolve(input)) }
    : { layers: [{ src: input }], base: process.cwd() };
const from = (path) => resolve(layout.base, path);

const layers = await Promise.all(layout.layers.map((spec) => renderLayer(spec)));

let { canvas } = layout;
if (!canvas) {
  const minX = Math.min(...layers.map((l) => l.x));
  const minY = Math.min(...layers.map((l) => l.y));
  const maxX = Math.max(...layers.map((l) => l.x + l.width));
  const maxY = Math.max(...layers.map((l) => l.y + l.height));
  const margin = Math.round((maxX - minX) * (layout.margin ?? 0.072));
  for (const l of layers) {
    l.x += margin - minX;
    l.y += margin - minY;
  }
  canvas = { width: maxX - minX + margin * 2, height: maxY - minY + margin * 2 };
}

const composed = sharp(layout.wallpaper ? from(layout.wallpaper) : join(import.meta.dirname, "wallpaper.webp"))
  .resize(canvas.width, canvas.height, { fit: "cover" })
  .composite(
    layers.flatMap((l) => [
      ...(l.shadow ? [{ input: l.shadow, left: l.x - SHADOW_PAD, top: l.y - SHADOW_PAD + 24 }] : []),
      { input: l.image, left: l.x, top: l.y },
    ]),
  )
  .removeAlpha()
  .png();

if (extname(out) === ".webp") {
  const work = mkdtempSync(join(tmpdir(), "docs-screenshot-"));
  try {
    const src = join(work, "composed.png");
    await composed.toFile(src);
    for (let q = 90; ; q -= 2) {
      execFileSync("cwebp", ["-quiet", "-q", String(q), src, "-o", out]);
      const size = statSync(out).size;
      if (size <= MAX_WEBP_BYTES) {
        console.log(`${out}: ${canvas.width}x${canvas.height}, q${q}, ${size} bytes`);
        break;
      }
      if (q <= 50) throw new Error(`${out} is ${size} bytes at q50, over ${MAX_WEBP_BYTES}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
} else {
  await composed.toFile(out);
  console.log(`${out}: ${canvas.width}x${canvas.height}`);
}

/** Crop, frame, and scale one capture; returns its image, shadow, and placement. */
async function renderLayer({
  src,
  x = 0,
  y = 0,
  width,
  crop,
  radius = 22,
  lights = true,
  border = true,
  shadow = true,
}) {
  let image = sharp(from(src));
  if (crop) image = sharp(await image.extract(crop).png().toBuffer());
  const { width: W, height: H } = await image.metadata();

  const framed = await image
    .composite([
      { input: chrome(W, H, { radius, lights, border }) },
      { input: svg(W, H, `<rect width="${W}" height="${H}" rx="${radius}" ry="${radius}"/>`), blend: "dest-in" },
    ])
    .png()
    .toBuffer();

  const scale = (width ?? W) / W;
  const w = Math.round(W * scale);
  const h = Math.round(H * scale);
  const r = radius * scale;
  return {
    x,
    y,
    width: w,
    height: h,
    image: scale === 1 ? framed : await sharp(framed).resize(w, h).png().toBuffer(),
    shadow: shadow
      ? await sharp(
          svg(
            w + SHADOW_PAD * 2,
            h + SHADOW_PAD * 2,
            `<rect x="${SHADOW_PAD}" y="${SHADOW_PAD}" width="${w}" height="${h}" rx="${r}" fill="rgba(0,0,0,0.45)"/>`,
          ),
        )
          .blur(36)
          .png()
          .toBuffer()
      : undefined,
  };
}

/** Traffic lights and the hairline window border, in source px. */
function chrome(W, H, { radius, lights, border }) {
  return svg(
    W,
    H,
    (lights
      ? `<circle cx="39" cy="39" r="12" fill="#ff5f57" stroke="#e0443e" stroke-width="1"/>
      <circle cx="81" cy="39" r="12" fill="#febc2e" stroke="#dea123" stroke-width="1"/>
      <circle cx="123" cy="39" r="12" fill="#28c840" stroke="#1aab29" stroke-width="1"/>`
      : "") +
      (border
        ? `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="${radius}" ry="${radius}" fill="none" stroke="rgba(0,0,0,0.22)" stroke-width="2"/>`
        : ""),
  );
}

function svg(W, H, body) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`);
}
