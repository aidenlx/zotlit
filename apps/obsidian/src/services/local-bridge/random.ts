// The one source of randomness the Local Bridge draws on: a Connection code, a
// session credential, and the installation id are all hex of this shape.

/** `bytes` bytes from the platform CSPRNG, hex encoded. */
export function randomHex(bytes: number): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return [...values].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
