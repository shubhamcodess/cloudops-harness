import { describe, it, expect } from "vitest";
import { Ledger, canonicalize, GENESIS } from "@smc/engine";

describe("canonicalize", () => {
  it("is key-order independent", () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
    expect(canonicalize({ a: { x: 1, y: 2 }, b: [3, 4] })).toBe(
      canonicalize({ b: [3, 4], a: { y: 2, x: 1 } }),
    );
  });
  it("distinguishes different values", () => {
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: 2 }));
  });
});

describe("Ledger", () => {
  it("chains hashes from GENESIS", () => {
    const l = new Ledger();
    const e0 = l.append({ state: "INGEST", rule: "r", engine: "rule", input: { x: 1 }, output: { ok: true } });
    const e1 = l.append({ state: "DETECT", rule: "r", engine: "rule", input: {}, output: { ok: true } });
    expect(e0.prevHash).toBe(GENESIS);
    expect(e1.prevHash).toBe(e0.hash);
    expect(l.verify()).toEqual({ ok: true });
  });

  it("produces deterministic hashes for identical inputs regardless of key order", () => {
    const a = new Ledger();
    const b = new Ledger();
    a.append({ state: "S", rule: "r", engine: "rule", input: { a: 1, b: 2 }, output: { y: 1, x: 2 } });
    b.append({ state: "S", rule: "r", engine: "rule", input: { b: 2, a: 1 }, output: { x: 2, y: 1 } });
    expect(a.head()!.hash).toBe(b.head()!.hash);
  });

  it("detects tampering", () => {
    const l = new Ledger();
    l.append({ state: "S", rule: "r", engine: "rule", input: {}, output: { v: 1 } });
    l.append({ state: "S", rule: "r", engine: "rule", input: {}, output: { v: 2 } });
    const json = l.toJSON();
    (json[1] as { output: unknown }).output = { v: 999 };
    const tampered = new Ledger();
    // rebuild via internal state by reappending; simulate corruption via direct mutation of entries
    (tampered as unknown as { entries: unknown[] }).entries = json;
    const res = tampered.verify();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.brokenAt).toBe(1);
  });
});
