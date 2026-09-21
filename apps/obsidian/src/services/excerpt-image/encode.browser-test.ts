// Runs in a disposable Electron renderer: the canvas encoding path, an
// independent decode of its output, and the PNG/WebP size and timing comparison.
import { encodeExcerptImage } from "./encode";
import { usableExcerptWebp } from "./webp";

interface CropMeasurement {
  crop: string;
  width: number;
  height: number;
  pngBytes: number;
  webpBytes: number;
  pngMs: number;
  webpMs: number;
}

export interface EncodeReport {
  passed: string[];
  userAgent: string;
  imageDecoder: boolean;
  measurements: CropMeasurement[];
  /** Reported, not asserted: how the canvas round-trip compares to the source. */
  oracle: {
    /** Opaque source: pixels compared with the source render buffer. */
    opaque: Comparison;
    /** Translucent source: the same comparison, plus its alpha samples. */
    translucent: Comparison;
    /** WebCodecs decode of the opaque payload, when the host provides one. */
    webcodecs: { opaque: Comparison; translucent: Comparison } | undefined;
    /** Worst channel step of a lossy payload, to show the oracle discriminates. */
    lossyStep: number;
  };
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return element;
}

function context(
  element: HTMLCanvasElement,
  alpha: boolean,
): CanvasRenderingContext2D {
  const found = element.getContext("2d", { alpha });
  if (!found) throw new Error("Canvas context unavailable");
  return found;
}

async function toBlob(
  element: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) =>
    element.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error(`Encoding failed: ${type}`)),
      type,
      quality,
    ),
  );
}

/** Deterministic content, so a re-run on the same runtime reproduces every number. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Crops in the shapes the renderer produces: text, equations, ink, and images. */
function crop(kind: "text" | "equation" | "ink" | "image"): HTMLCanvasElement {
  const next = random(0x1183);
  if (kind === "text") {
    const element = canvas(1200, 160);
    const paint = context(element, false);
    paint.fillStyle = "#ffffff";
    paint.fillRect(0, 0, 1200, 160);
    paint.fillStyle = "#111111";
    paint.font = "11px serif";
    const sentences = [
      "The quick brown fox jumps over the lazy dog while annotations accumulate",
      "Zotero stores highlights, notes, and ink strokes per attachment and page",
      "Excerpt crops render at four times the PDF scale before they are encoded",
      "Lossless WebP keeps the glyph edges that make small text readable",
    ];
    for (let line = 0; line < 14; line++) {
      const sentence = sentences[line % sentences.length]!;
      const y = 14 + line * 11;
      for (let x = 10; x < 1180; x += paint.measureText(sentence).width + 14)
        paint.fillText(sentence, x, y);
    }
    return element;
  }
  if (kind === "equation") {
    const element = canvas(720, 200);
    const paint = context(element, true);
    paint.fillStyle = "#000000";
    paint.font = "34px serif";
    paint.fillText("∫₀^∞ e^(−x²) dx = √π⁄2", 16, 70);
    paint.font = "20px serif";
    paint.fillText("Σₙ₌₁^N 1/n² → π²/6", 16, 120);
    paint.fillText("∂²u/∂t² = c²∇²u", 16, 165);
    return element;
  }
  if (kind === "ink") {
    const element = canvas(900, 300);
    const paint = context(element, true);
    paint.strokeStyle = "#e02020";
    paint.lineCap = "round";
    for (let stroke = 0; stroke < 4; stroke++) {
      paint.lineWidth = 3 + stroke;
      paint.beginPath();
      paint.moveTo(30, 60 + stroke * 60);
      for (let x = 30; x < 860; x += 12)
        paint.lineTo(x, 60 + stroke * 60 + Math.sin(x / 40 + stroke) * 30);
      paint.stroke();
    }
    return element;
  }
  const element = canvas(600, 400);
  const paint = context(element, false);
  const sky = paint.createLinearGradient(0, 0, 0, 400);
  sky.addColorStop(0, "#2a4d8f");
  sky.addColorStop(1, "#c9d6e8");
  paint.fillStyle = sky;
  paint.fillRect(0, 0, 600, 400);
  for (let blob = 0; blob < 60; blob++) {
    const x = next() * 600;
    const y = next() * 400;
    const radius = 10 + next() * 70;
    const shade = Math.floor(next() * 256);
    const glow = paint.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(
      0,
      `rgba(${shade}, ${255 - shade}, ${Math.floor(next() * 256)}, 0.7)`,
    );
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    paint.fillStyle = glow;
    paint.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  for (let grain = 0; grain < 8000; grain++) {
    const shade = Math.floor(next() * 256);
    paint.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
    paint.fillRect(next() * 600, next() * 400, 1, 1);
  }
  return element;
}

async function measure(
  kind: "text" | "equation" | "ink" | "image",
): Promise<CropMeasurement> {
  const element = crop(kind);
  const signal = new AbortController().signal;
  let pngBytes = 0;
  let webpBytes = 0;
  let pngMs = Number.POSITIVE_INFINITY;
  let webpMs = Number.POSITIVE_INFINITY;
  for (let run = 0; run < 5; run++) {
    let started = performance.now();
    const png = await toBlob(element, "image/png");
    pngMs = Math.min(pngMs, performance.now() - started);
    pngBytes = png.size;
    started = performance.now();
    const webp = await encodeExcerptImage(element, signal);
    webpMs = Math.min(webpMs, performance.now() - started);
    webpBytes = webp.bytes.byteLength;
    check(
      webp.format.format === "webp" && usableExcerptWebp(webp.bytes),
      `Lossless WebP encoding failed for the ${kind} crop`,
    );
  }
  return {
    crop: kind,
    width: element.width,
    height: element.height,
    pngBytes,
    webpBytes,
    pngMs: Math.round(pngMs * 100) / 100,
    webpMs: Math.round(webpMs * 100) / 100,
  };
}

export interface Comparison {
  pixels: number;
  exact: number;
  alpha: number;
  maxDelta: number;
}

/** Byte differences between two RGBA buffers, and the worst channel delta. */
function compare(
  expected: Uint8ClampedArray,
  actual: Uint8ClampedArray,
): Comparison {
  const comparison: Comparison = {
    pixels: expected.length / 4,
    exact: 0,
    alpha: 0,
    maxDelta: 0,
  };
  for (let pixel = 0; pixel < comparison.pixels; pixel++) {
    let delta = 0;
    for (const channel of [0, 1, 2, 3])
      delta = Math.max(
        delta,
        Math.abs(actual[pixel * 4 + channel]! - expected[pixel * 4 + channel]!),
      );
    if (delta === 0) comparison.exact++;
    if (actual[pixel * 4 + 3] !== expected[pixel * 4 + 3]) comparison.alpha++;
    comparison.maxDelta = Math.max(comparison.maxDelta, delta);
  }
  return comparison;
}

/** Draws the payload back through a canvas: the decoder this host provides. */
async function decode(bytes: Uint8Array, type: string) {
  const bitmap = await createImageBitmap(
    new Blob([bytes as unknown as BlobPart], { type }),
  );
  const element = canvas(bitmap.width, bitmap.height);
  const paint = context(element, true);
  paint.drawImage(bitmap, 0, 0);
  const data = paint.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const decoded = { width: bitmap.width, height: bitmap.height, data };
  bitmap.close();
  return decoded;
}

interface VideoFrame {
  displayWidth: number;
  displayHeight: number;
  allocationSize(options: { format: string }): number;
  copyTo(
    destination: Uint8ClampedArray,
    options: { format: string },
  ): Promise<void>;
  close(): void;
}

interface BrowserImageDecoder {
  decode(): Promise<{ image: VideoFrame }>;
  close(): void;
}

/** WebCodecs decodes the file's own samples, without the canvas premultiplied step. */
async function decodeWithImageDecoder(
  bytes: Uint8Array,
  premultiplyAlpha: "none" | "premultiply",
) {
  const decoder = new (
    window as unknown as {
      ImageDecoder: new (
        options: Record<string, unknown>,
      ) => BrowserImageDecoder;
    }
  ).ImageDecoder({
    data: bytes,
    type: "image/webp",
    colorSpaceConversion: "none",
    premultiplyAlpha,
  });
  try {
    const { image } = await decoder.decode();
    const data = new Uint8ClampedArray(
      image.allocationSize({ format: "RGBA" }),
    );
    await image.copyTo(data, { format: "RGBA" });
    const decoded = {
      width: image.displayWidth,
      height: image.displayHeight,
      data,
    };
    image.close();
    return decoded;
  } finally {
    decoder.close();
  }
}

/**
 * Decodes one encoded payload and compares it with the source render buffer and
 * with the lossless PNG of the same canvas. The canvas round-trip is the only
 * decoder this host offers: `drawImage` premultiplies, so translucent samples are
 * compared with that step accounted for instead of being compared loosely.
 */
async function probe(translucent: boolean) {
  const width = 37;
  const height = 23;
  const source = canvas(width, height);
  const sourceContext = context(source, true);
  const pattern = sourceContext.createImageData(width, height);
  for (let pixel = 0; pixel < width * height; pixel++) {
    pattern.data[pixel * 4] = (pixel * 37) % 256;
    pattern.data[pixel * 4 + 1] = (pixel * 101) % 256;
    pattern.data[pixel * 4 + 2] = (pixel * 211) % 256;
    pattern.data[pixel * 4 + 3] = translucent
      ? [0, 17, 128, 200, 254, 255][pixel % 6]!
      : 255;
  }
  sourceContext.putImageData(pattern, 0, 0);
  const reference = sourceContext.getImageData(0, 0, width, height).data;
  const encoded = await encodeExcerptImage(
    source,
    new AbortController().signal,
  );
  check(
    encoded.format.format === "webp",
    "The host canvas did not produce lossless WebP",
  );
  const png = new Uint8Array(
    await (await toBlob(source, "image/png")).arrayBuffer(),
  );
  const lossy = new Uint8Array(
    await (await toBlob(source, "image/webp", 0.9)).arrayBuffer(),
  );
  const webp = await decode(encoded.bytes, "image/webp");
  const pngDecoded = await decode(png, "image/png");
  const lossyDecoded = await decode(lossy, "image/webp");
  check(
    webp.width === width && webp.height === height,
    `Decoded WebP is ${webp.width}x${webp.height}, not ${width}x${height}`,
  );
  const independent =
    typeof (window as { ImageDecoder?: unknown }).ImageDecoder === "function"
      ? compare(
          reference,
          (await decodeWithImageDecoder(encoded.bytes, "none")).data,
        )
      : undefined;
  return {
    againstSource: compare(reference, webp.data),
    againstPng: compare(pngDecoded.data, webp.data),
    independent,
    lossyStep: compare(reference, lossyDecoded.data).maxDelta,
  };
}

/**
 * Lossless proof. Generated crops are drawn on an opaque canvas, so their pixels
 * must decode byte for byte. A translucent source stays a supported input: its
 * alpha samples must survive exactly and its colors may move only by the 8-bit
 * step the canvas loses when it unpremultiplies for the WebP encoder, which a
 * lossy payload exceeds by two orders of magnitude.
 */
async function oracle(): Promise<EncodeReport["oracle"]> {
  const opaque = await probe(false);
  const translucent = await probe(true);
  const webcodecs =
    opaque.independent && translucent.independent
      ? { opaque: opaque.independent, translucent: translucent.independent }
      : undefined;
  const lossyStep = Math.max(opaque.lossyStep, translucent.lossyStep);
  // The decoder this host provides proves the payload itself: WebCodecs reads the
  // samples the file holds, so both patterns must match the source render buffer
  // exactly, translucent alpha included.
  for (const [pattern, comparison] of Object.entries(webcodecs ?? {}))
    check(
      comparison.exact === comparison.pixels && comparison.maxDelta === 0,
      `WebCodecs decode differs from the ${pattern} source render: ${JSON.stringify(comparison)}`,
    );
  // Drawing the payload back through a canvas premultiplies it first, so opaque
  // pixels must still match byte for byte and translucent colors may move only by
  // the 8-bit step the canvas loses, which a lossy payload exceeds by far.
  check(
    opaque.againstSource.exact === opaque.againstSource.pixels,
    `Canvas decode differs from the opaque source render: ${JSON.stringify(opaque.againstSource)}`,
  );
  check(
    opaque.againstPng.exact === opaque.againstPng.pixels,
    `WebP decode differs from the lossless PNG decode: ${JSON.stringify(opaque.againstPng)}`,
  );
  check(
    translucent.againstSource.alpha === 0,
    `Translucent alpha samples changed: ${JSON.stringify(translucent.againstSource)}`,
  );
  check(
    translucent.againstSource.maxDelta <= 2,
    `Translucent colors moved past the canvas 8-bit step: ${JSON.stringify(translucent.againstSource)}`,
  );
  check(
    lossyStep > translucent.againstSource.maxDelta,
    `A lossy payload is indistinguishable from the lossless one at step ${lossyStep}`,
  );
  return {
    opaque: opaque.againstSource,
    translucent: translucent.againstSource,
    webcodecs,
    lossyStep,
  };
}

/** Display reads the bytes through the MIME type the format metadata reports. */
async function assertDisplays(image: { bytes: Uint8Array; mimeType: string }) {
  const url = URL.createObjectURL(
    new Blob([image.bytes as unknown as BlobPart], { type: image.mimeType }),
  );
  try {
    const element = new Image();
    await new Promise<void>((resolve, reject) => {
      element.onload = () => resolve();
      element.onerror = () =>
        reject(new Error("Image element rejected the URL"));
      element.src = url;
      if (element.complete && element.naturalWidth) resolve();
    });
    check(
      element.naturalWidth > 0 && element.naturalHeight > 0,
      "Displayed excerpt has no natural size",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function run(): Promise<EncodeReport> {
  const passed: string[] = [];
  const signal = new AbortController().signal;
  const pattern = canvas(64, 48);
  const patternContext = context(pattern, true);
  for (let y = 0; y < 48; y++)
    for (let x = 0; x < 64; x++) {
      patternContext.fillStyle = `rgba(${x * 4}, ${y * 5}, ${(x * y) % 256}, ${
        ((x + y) % 5) / 4
      })`;
      patternContext.fillRect(x, y, 1, 1);
    }
  const encoded = await encodeExcerptImage(pattern, signal);
  check(
    encoded.format.format === "webp",
    "Canvas did not encode lossless WebP",
  );
  check(encoded.format.mimeType === "image/webp", "WebP MIME type is wrong");
  check(encoded.format.extension === "webp", "WebP extension is wrong");
  check(
    usableExcerptWebp(encoded.bytes, { width: 64, height: 48 }),
    "Encoded payload is not a lossless WebP of the canvas dimensions",
  );
  const lossy = new Uint8Array(
    await (await toBlob(pattern, "image/webp", 0.9)).arrayBuffer(),
  );
  check(
    !usableExcerptWebp(lossy),
    "The validator accepted a lossy WebP payload",
  );
  await assertDisplays({
    bytes: encoded.bytes,
    mimeType: encoded.format.mimeType,
  });
  passed.push("canvas lossless WebP capability and lossy rejection");

  const counts = await oracle();
  passed.push("lossless pixels for opaque and translucent source pixels");

  const measurements: CropMeasurement[] = [];
  for (const kind of ["text", "equation", "ink", "image"] as const)
    measurements.push(await measure(kind));
  passed.push("text, equation, ink, and image crop measurements");

  return {
    passed,
    userAgent: navigator.userAgent,
    imageDecoder:
      typeof (window as { ImageDecoder?: unknown }).ImageDecoder === "function",
    measurements,
    oracle: counts,
  };
}
