/**
 * Reads the JSON a model has streamed so far and returns the value it describes, with every
 * unfinished container closed and every unfinished key, literal or escape dropped. A partial
 * string stays as text, so the UI can show words as they arrive. Returns null when the prefix
 * cannot be the start of a JSON document, or when nothing usable has arrived yet.
 */

const END = Symbol("end");
const INVALID = Symbol("invalid");
type Outcome = unknown | typeof END | typeof INVALID;

const MAX_DEPTH = 64;
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
const NUMBER_CHARS = /[-+0-9.eE]/;
const NUMBER = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?$/;

class Reader {
  pos = 0;

  constructor(private readonly s: string) {}

  get atEnd(): boolean {
    return this.pos >= this.s.length;
  }

  /** A truncated token consumes the rest of the input, so the caller sees the end and closes up. */
  private truncated(): typeof END {
    this.pos = this.s.length;
    return END;
  }

  peek(): string {
    return this.s[this.pos] ?? "";
  }

  skipWs(): void {
    while (!this.atEnd && /\s/.test(this.peek())) this.pos += 1;
  }

  value(depth: number): Outcome {
    this.skipWs();
    if (this.atEnd) return END;
    if (depth > MAX_DEPTH) return INVALID;
    const c = this.peek();
    if (c === "{") return this.object(depth);
    if (c === "[") return this.array(depth);
    if (c === '"') return this.string().text;
    if (c === "t") return this.literal("true", true);
    if (c === "f") return this.literal("false", false);
    if (c === "n") return this.literal("null", null);
    if (c === "-" || (c >= "0" && c <= "9")) return this.number();
    return INVALID;
  }

  private literal(word: string, value: unknown): Outcome {
    const rest = this.s.slice(this.pos, this.pos + word.length);
    if (rest === word) {
      this.pos += word.length;
      return value;
    }
    return word.startsWith(rest) && this.pos + rest.length >= this.s.length ? this.truncated() : INVALID;
  }

  private number(): Outcome {
    const start = this.pos;
    while (!this.atEnd && NUMBER_CHARS.test(this.peek())) this.pos += 1;
    const text = this.s.slice(start, this.pos);
    if (NUMBER.test(text)) return Number(text);
    // Only a prefix that could still grow into a number is a truncation.
    return this.atEnd && /^-?[0-9]*\.?[0-9]*([eE][-+]?[0-9]*)?$/.test(text) ? this.truncated() : INVALID;
  }

  /** complete is false when the input ended inside the string (or inside an escape, which is dropped). */
  string(): { text: string; complete: boolean } {
    this.pos += 1;
    let text = "";
    while (!this.atEnd) {
      const c = this.peek();
      if (c === '"') {
        this.pos += 1;
        return { text, complete: true };
      }
      if (c === "\\") {
        const e = this.s[this.pos + 1];
        if (e === undefined) break;
        if (e === "u") {
          const hex = this.s.slice(this.pos + 2, this.pos + 6);
          if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) break;
          text += String.fromCharCode(Number.parseInt(hex, 16));
          this.pos += 6;
          continue;
        }
        const simple = SIMPLE_ESCAPES[e];
        if (simple === undefined) break;
        text += simple;
        this.pos += 2;
        continue;
      }
      text += c;
      this.pos += 1;
    }
    this.truncated();
    return { text, complete: false };
  }

  private object(depth: number): Outcome {
    this.pos += 1;
    const out: Record<string, unknown> = {};
    let expect: "key_or_close" | "key" | "comma_or_close" = "key_or_close";
    for (;;) {
      this.skipWs();
      if (this.atEnd) return out;
      const c = this.peek();
      if (c === "}" && expect !== "key") {
        this.pos += 1;
        return out;
      }
      if (c === "," && expect === "comma_or_close") {
        this.pos += 1;
        expect = "key";
        continue;
      }
      if (expect === "comma_or_close" || c !== '"') return INVALID;
      const key = this.string();
      if (!key.complete) return out;
      this.skipWs();
      if (this.atEnd) return out;
      if (this.peek() !== ":") return INVALID;
      this.pos += 1;
      const v = this.value(depth + 1);
      if (v === END) return out;
      if (v === INVALID) return INVALID;
      out[key.text] = v;
      expect = "comma_or_close";
    }
  }

  private array(depth: number): Outcome {
    this.pos += 1;
    const out: unknown[] = [];
    let expect: "value_or_close" | "value" | "comma_or_close" = "value_or_close";
    for (;;) {
      this.skipWs();
      if (this.atEnd) return out;
      const c = this.peek();
      if (c === "]" && expect !== "value") {
        this.pos += 1;
        return out;
      }
      if (c === "," && expect === "comma_or_close") {
        this.pos += 1;
        expect = "value";
        continue;
      }
      if (expect === "comma_or_close") return INVALID;
      const v = this.value(depth + 1);
      if (v === END) return out;
      if (v === INVALID) return INVALID;
      out.push(v);
      expect = "comma_or_close";
    }
  }
}

export function completeJsonPrefix(prefix: string): unknown | null {
  const reader = new Reader(prefix);
  const value = reader.value(0);
  if (value === END || value === INVALID) return null;
  reader.skipWs();
  if (!reader.atEnd) return null;
  return value;
}
