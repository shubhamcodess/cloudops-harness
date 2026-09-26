import { createHash } from "node:crypto";
import type { LedgerEntry } from "@smc/contracts";

export const GENESIS = "0".repeat(64);

// Canonical JSON: sort object keys recursively so semantically equal inputs hash equally.
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ":" + canonicalize((value as Record<string, unknown>)[k]));
  return "{" + parts.join(",") + "}";
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export interface AppendInput {
  state: string;
  rule: string;
  engine: "rule" | "llm" | "human";
  input: unknown;
  output: unknown;
  confidence?: number;
}

export class Ledger {
  private entries: LedgerEntry[] = [];

  append(e: AppendInput): LedgerEntry {
    const prevHash = this.entries.length === 0 ? GENESIS : this.entries[this.entries.length - 1]!.hash;
    const seq = this.entries.length;
    const base = {
      seq,
      state: e.state,
      rule: e.rule,
      engine: e.engine,
      input: e.input,
      output: e.output,
      confidence: e.confidence,
      prevHash,
    };
    const hash = sha256(canonicalize(base));
    const entry: LedgerEntry = { ...base, hash };
    this.entries.push(entry);
    return entry;
  }

  verify(): { ok: true } | { ok: false; brokenAt: number; reason: string } {
    let prev = GENESIS;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (e.seq !== i) return { ok: false, brokenAt: i, reason: "seq mismatch" };
      if (e.prevHash !== prev) return { ok: false, brokenAt: i, reason: "prevHash mismatch" };
      const { hash, ...rest } = e;
      const recomputed = sha256(canonicalize(rest));
      if (recomputed !== hash) return { ok: false, brokenAt: i, reason: "hash mismatch" };
      prev = hash;
    }
    return { ok: true };
  }

  toJSON(): LedgerEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  get length(): number {
    return this.entries.length;
  }

  head(): LedgerEntry | undefined {
    return this.entries[this.entries.length - 1];
  }
}
