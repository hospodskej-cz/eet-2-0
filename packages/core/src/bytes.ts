/** Small byte helpers built on web platform APIs only (Node 22+, Bun, Deno). */

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Web Crypto wants an `ArrayBuffer`-backed view; copies only when `bytes` sits on another buffer. */
export function bufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer
    ? (bytes as Uint8Array<ArrayBuffer>)
    : new Uint8Array(bytes);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bufferSource(bytes))));
}

/** Accepts a certificate as DER bytes or as PEM text/bytes and returns DER. */
export function certificateToDer(input: Uint8Array | string): Uint8Array {
  const text = typeof input === "string" ? input : new TextDecoder("latin1").decode(input);
  const pem = text.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/);
  if (pem?.[1] !== undefined) return base64ToBytes(pem[1].replace(/\s+/g, ""));
  if (typeof input === "string") throw new TypeError("string input is not a PEM certificate");
  return input;
}
