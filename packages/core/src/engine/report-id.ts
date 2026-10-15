/** FNV-1a 32-bit over UTF-16 code units, seeded so two passes give 64 bits. */
function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic id derived from the report's inputs, so the same scan always gets the same id. */
export function reportIdFor(parts: readonly string[]): string {
  const joined = parts.join("|");
  const a = fnv1a(joined, 0x811c9dc5).toString(16).padStart(8, "0");
  const b = fnv1a(joined, 0x9747b28c).toString(16).padStart(8, "0");
  return `r-${a}${b}`;
}
