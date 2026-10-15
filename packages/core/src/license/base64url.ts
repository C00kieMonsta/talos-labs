const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const VALUES: ReadonlyMap<string, number> = new Map(Array.from(ALPHABET, (char, index) => [char, index]));

/** Decodes unpadded or padded base64url. Returns null on any bad character or length. */
export function decodeBase64Url(input: string): Uint8Array | null {
  let end = input.length;
  while (end > 0 && input[end - 1] === "=") {
    end -= 1;
  }
  const body = input.slice(0, end);
  if (body.length % 4 === 1) {
    return null;
  }
  const out = new Uint8Array(Math.floor((body.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let offset = 0;
  for (const char of body) {
    const value = VALUES.get(char);
    if (value === undefined) {
      return null;
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[offset] = (buffer >> bits) & 0xff;
      offset += 1;
    }
  }
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) {
    return null;
  }
  return out;
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += ALPHABET[(buffer >> bits) & 0x3f];
    }
  }
  if (bits > 0) {
    out += ALPHABET[(buffer << (6 - bits)) & 0x3f];
  }
  return out;
}

/** Strict UTF-8 decoder. Returns null on malformed input. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i] ?? 0;
    let codePoint: number;
    let extra: number;
    if (b0 < 0x80) {
      codePoint = b0;
      extra = 0;
    } else if (b0 >= 0xc2 && b0 <= 0xdf) {
      codePoint = b0 & 0x1f;
      extra = 1;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      codePoint = b0 & 0x0f;
      extra = 2;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      codePoint = b0 & 0x07;
      extra = 3;
    } else {
      return null;
    }
    for (let k = 1; k <= extra; k += 1) {
      const b = bytes[i + k];
      if (b === undefined || (b & 0xc0) !== 0x80) {
        return null;
      }
      codePoint = (codePoint << 6) | (b & 0x3f);
    }
    if (
      (extra === 2 && codePoint < 0x800) ||
      (extra === 3 && (codePoint < 0x10000 || codePoint > 0x10ffff)) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return null;
    }
    out += String.fromCodePoint(codePoint);
    i += extra + 1;
  }
  return out;
}

export function encodeUtf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}
