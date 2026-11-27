import { imageHosts } from "@/lib/encounter-activity";

export const IMAGE_TYPES = new Set(["image/png","image/jpeg","image/webp","image/gif","image/avif"]);
export function allowedImage(value: string | null): URL | null {
  if (!value || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && !url.username && !url.password && imageHosts.has(url.hostname) ? url : null;
  } catch { return null; }
}
export function allowedReference(parts: string[]): URL | null {
  if (!parts.length || parts.length > 5 || !parts.every(p => /^[a-zA-Z0-9_-]+(?:\.json)?$/.test(p)) || !parts.at(-1)?.endsWith(".json")) return null;
  return new URL(parts.join("/"), "https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/");
}
export async function fetchBounded(url: URL, allowedTypes: Set<string>, limit: number) {
  const res = await fetch(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000), headers: { Accept: [...allowedTypes].join(", ") } });
  const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!res.ok || !allowedTypes.has(type) || !res.body || Number(res.headers.get("content-length")) > limit) throw new Error("Unsupported response");
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("Response too large"); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return { output, type };
}
export function safeHeaders(type: string) {
  return { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "private, no-store" };
}
