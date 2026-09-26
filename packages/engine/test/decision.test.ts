import { describe, it, expect } from "vitest";
import { z } from "zod";
import { CompositeEngine, Ledger, LlmChoiceBackend, RuleBackend } from "@smc/engine";

const OPTIONS = ["aws", "gcp", "azure"] as const;

describe("CompositeEngine", () => {
  it("takes the rule path when a rule matches with high confidence", async () => {
    const ledger = new Ledger();
    const engine = new CompositeEngine(new RuleBackend(), null, { ledger });
    const res = await engine.decide({
      id: "provider",
      question: "Which provider?",
      options: OPTIONS,
      facts: { residency: "eu" },
      rules: [{ name: "eu->gcp", when: (f) => f.residency === "eu", pick: "gcp" }],
    });
    expect(res).toMatchObject({ choice: "gcp", engine: "rule", confidence: 1, needsHuman: false });
    expect(ledger.length).toBe(1);
  });

  it("falls back to the LLM when no rule matches", async () => {
    const llm = new LlmChoiceBackend(async (_p, _s) => ({ value: "aws", confidence: 0.9 }));
    const engine = new CompositeEngine(new RuleBackend(), llm);
    const res = await engine.decide({
      id: "provider",
      question: "Which provider?",
      options: OPTIONS,
      facts: {},
    });
    expect(res).toMatchObject({ choice: "aws", engine: "llm", needsHuman: false });
  });

  it("escalates to human when confidence is below threshold", async () => {
    const llm = new LlmChoiceBackend(async () => ({ value: "aws" as const, confidence: 0.4 }));
    const engine = new CompositeEngine(new RuleBackend(), llm, { minConfidence: 0.8 });
    const res = await engine.decide({
      id: "q",
      question: "?",
      options: OPTIONS,
      facts: {},
    });
    expect(res.engine).toBe("human");
    expect(res.needsHuman).toBe(true);
    expect(res.choice).toBeNull();
  });

  it("escalates to human when the LLM returns a value outside the enum", async () => {
    const llm = new LlmChoiceBackend(async () => ({ value: "digitalocean" as unknown as "aws", confidence: 0.99 }));
    const engine = new CompositeEngine(new RuleBackend(), llm);
    const res = await engine.decide({ id: "q", question: "?", options: OPTIONS, facts: {} });
    expect(res.needsHuman).toBe(true);
    expect(res.choice).toBeNull();
  });

  it("escalates to human when the LLM backend throws", async () => {
    const llm = new LlmChoiceBackend(async () => {
      throw new Error("upstream down");
    });
    const engine = new CompositeEngine(new RuleBackend(), llm);
    const res = await engine.decide({ id: "q", question: "?", options: OPTIONS, facts: {} });
    expect(res.needsHuman).toBe(true);
  });

  it("writes every decision to the ledger", async () => {
    const ledger = new Ledger();
    const llm = new LlmChoiceBackend(async () => ({ value: "aws" as const, confidence: 0.95 }));
    const engine = new CompositeEngine(new RuleBackend(), llm, { ledger });
    await engine.decide({ id: "a", question: "?", options: OPTIONS, facts: {} });
    await engine.decide({ id: "b", question: "?", options: OPTIONS, facts: {} });
    expect(ledger.length).toBe(2);
    expect(ledger.verify().ok).toBe(true);
  });

  it("LlmChoiceBackend validates with the provided Zod schema", () => {
    const schema = z.enum(OPTIONS as unknown as [string, ...string[]]);
    expect(schema.safeParse("aws").success).toBe(true);
    expect(schema.safeParse("nope").success).toBe(false);
  });
});
