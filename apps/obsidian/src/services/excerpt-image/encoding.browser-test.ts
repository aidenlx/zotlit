// Reproducible Chromium benchmark and pixel-equality acceptance utility.

import { encodeLosslessWebp } from "./encoder";
import { decodeWebpPixels } from "./webp-decode";

type Kind = "text" | "equation" | "ink" | "image-heavy";

const cases: readonly { kind: Kind; width: number; height: number }[] = [
  { kind: "text", width: 640, height: 360 },
  { kind: "equation", width: 640, height: 360 },
  { kind: "ink", width: 640, height: 360 },
  { kind: "image-heavy", width: 640, height: 360 },
];

function drawCase(options: {
  context: CanvasRenderingContext2D;
  kind: Kind;
  width: number;
  height: number;
}): ImageData {
  const { context, kind, width, height } = options;
  const image = context.createImageData(width, height);
  const alpha = [32, 96, 160, 224, 255] as const;
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = 255;
    image.data[index + 1] = 255;
    image.data[index + 2] = 255;
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  context.fillStyle = "#18212f";
  if (kind === "text") {
    context.font = "24px sans-serif";
    for (let y = 40; y < height; y += 42)
      context.fillText("Lossless excerpt text with small glyphs", 24, y);
  } else if (kind === "equation") {
    context.font = "30px serif";
    context.fillText("∫ f(x) dx = α + β · e⁻ˣ", 32, 100);
    context.strokeStyle = "#18212f";
    context.lineWidth = 2;
    for (let y = 140; y < height; y += 28) {
      context.beginPath();
      context.moveTo(24, y);
      context.lineTo(width - 24, y);
      context.stroke();
    }
  } else if (kind === "ink") {
    context.strokeStyle = "#d23f31";
    context.lineWidth = 4;
    for (let row = 0; row < 9; row++) {
      context.beginPath();
      context.moveTo(24, 24 + row * 36);
      for (let x = 40; x < width - 24; x += 24)
        context.lineTo(x, 24 + row * 36 + ((x / 24 + row) % 3) * 8);
      context.stroke();
    }
  } else {
    for (let y = 0; y < height; y += 4)
      for (let x = 0; x < width; x += 4) {
        context.fillStyle = `rgb(${(x * 13 + y) % 256} ${(y * 7 + x) % 256} ${(x + y * 3) % 256})`;
        context.fillRect(x, y, 4, 4);
      }
  }
  // Add varied translucent black/white samples after each drawing case. The
  // endpoint colors avoid premultiplication rounding while still testing the
  // exact alpha bytes through the native encoder and WebCodecs decoder.
  const source = context.getImageData(0, 0, width, height);
  let sample = 0;
  for (let y = 0; y < height; y += 37)
    for (let x = 0; x < width; x += 53) {
      const index = (y * width + x) * 4;
      const value = sample % 2 === 0 ? 0 : 255;
      source.data[index] = value;
      source.data[index + 1] = value;
      source.data[index + 2] = value;
      source.data[index + 3] = alpha[sample % alpha.length]!;
      sample++;
    }
  context.putImageData(source, 0, 0);
  return source;
}

async function blobBytes(
  canvas: HTMLCanvasElement,
  type: string,
): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error("encoding failed")),
      type,
    ),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

export async function run(): Promise<
  {
    kind: Kind;
    width: number;
    height: number;
    pngBytes: number;
    webpBytes: number;
    pngMs: number;
    webpMs: number;
  }[]
> {
  const results = [];
  for (const { kind, width, height } of cases) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Canvas unavailable");
    const source = drawCase({ context, kind, width, height });
    const pngStarted = performance.now();
    const png = await blobBytes(canvas, "image/png");
    const pngMs = performance.now() - pngStarted;
    const webpStarted = performance.now();
    const webp = await encodeLosslessWebp(canvas);
    const webpMs = performance.now() - webpStarted;
    const decoded = await decodeWebpPixels(webp.bytes);
    const sourcePixels = new Uint8Array(source.data);
    const different = decoded.data.findIndex(
      (pixel, index) => pixel !== sourcePixels[index],
    );
    if (decoded.width !== width || decoded.height !== height || different >= 0)
      throw new Error(
        `WebP pixels changed for ${kind}: ${JSON.stringify({
          different,
          source:
            different >= 0
              ? Array.from(sourcePixels.slice(different, different + 4))
              : null,
          decoded:
            different >= 0
              ? Array.from(decoded.data.slice(different, different + 4))
              : null,
        })}`,
      );
    results.push({
      kind,
      width,
      height,
      pngBytes: png.byteLength,
      webpBytes: webp.bytes.byteLength,
      pngMs,
      webpMs,
    });
  }
  return results;
}
