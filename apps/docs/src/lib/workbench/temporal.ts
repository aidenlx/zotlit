// Temporal for the runtimes that do not carry it yet, in the page and in the
// render Worker. The polyfill is a lazy import so a browser that ships Temporal
// never downloads it.

export async function ensureTemporal(): Promise<void> {
  if (globalThis.Temporal !== undefined) return;
  const { Temporal } = await import("@js-temporal/polyfill");
  globalThis.Temporal = Temporal as unknown as typeof globalThis.Temporal;
}
