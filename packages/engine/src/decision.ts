import { z } from "zod";
import { Ledger } from "./ledger.js";

export type Engine = "rule" | "llm" | "human";

export interface DecisionQuery<T extends string> {
  id: string;
  question: string;
  options: readonly T[];
  facts: Record<string, unknown>;
  rules?: Array<{ name: string; when: (f: Record<string, unknown>) => boolean; pick: T }>;
  minConfidence?: number;
}

export interface DecisionResult<T extends string> {
  choice: T | null;
  engine: Engine;
  confidence: number;
  rule?: string;
  needsHuman: boolean;
}

export interface DecisionEngine {
  decide<T extends string>(q: DecisionQuery<T>): Promise<DecisionResult<T>>;
}

export type LlmComplete = (
  prompt: string,
  schema: z.ZodType,
) => Promise<{ value: unknown; confidence?: number }>;

export class RuleBackend implements DecisionEngine {
  async decide<T extends string>(q: DecisionQuery<T>): Promise<DecisionResult<T>> {
    for (const r of q.rules ?? []) {
      if (r.when(q.facts)) {
        if (!q.options.includes(r.pick)) {
          return { choice: null, engine: "rule", confidence: 0, rule: r.name, needsHuman: true };
        }
        return { choice: r.pick, engine: "rule", confidence: 1, rule: r.name, needsHuman: false };
      }
    }
    return { choice: null, engine: "rule", confidence: 0, needsHuman: true };
  }
}

export class LlmChoiceBackend implements DecisionEngine {
  constructor(private readonly complete: LlmComplete) {}

  async decide<T extends string>(q: DecisionQuery<T>): Promise<DecisionResult<T>> {
    const schema = z.enum(q.options as unknown as [T, ...T[]]);
    const prompt = buildPrompt(q);
    try {
      const { value, confidence } = await this.complete(prompt, schema);
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        return { choice: null, engine: "llm", confidence: 0, needsHuman: true };
      }
      return {
        choice: parsed.data,
        engine: "llm",
        confidence: confidence ?? 0.7,
        needsHuman: false,
      };
    } catch {
      return { choice: null, engine: "llm", confidence: 0, needsHuman: true };
    }
  }
}

function buildPrompt<T extends string>(q: DecisionQuery<T>): string {
  return [
    `Question: ${q.question}`,
    `Options: ${q.options.join(", ")}`,
    `Facts: ${JSON.stringify(q.facts)}`,
    `Reply with exactly one option.`,
  ].join("\n");
}

export interface CompositeOptions {
  minConfidence?: number;
  ledger?: Ledger;
  state?: string;
}

export class CompositeEngine implements DecisionEngine {
  constructor(
    private readonly rules: RuleBackend,
    private readonly llm: LlmChoiceBackend | null,
    private readonly opts: CompositeOptions = {},
  ) {}

  async decide<T extends string>(q: DecisionQuery<T>): Promise<DecisionResult<T>> {
    const min = q.minConfidence ?? this.opts.minConfidence ?? 0.8;
    let result = await this.rules.decide(q);
    if (result.choice !== null && result.confidence >= min) {
      return this.record(q, result);
    }
    if (this.llm) {
      try {
        result = await this.llm.decide(q);
      } catch {
        result = { choice: null, engine: "llm", confidence: 0, needsHuman: true };
      }
    }
    if (result.choice === null || result.confidence < min) {
      const human: DecisionResult<T> = {
        choice: null,
        engine: "human",
        confidence: result.confidence,
        rule: result.rule,
        needsHuman: true,
      };
      return this.record(q, human);
    }
    return this.record(q, result);
  }

  private record<T extends string>(q: DecisionQuery<T>, r: DecisionResult<T>): DecisionResult<T> {
    this.opts.ledger?.append({
      state: this.opts.state ?? "DECIDE",
      rule: r.rule ?? q.id,
      engine: r.engine,
      input: { id: q.id, question: q.question, options: q.options, facts: q.facts },
      output: { choice: r.choice, needsHuman: r.needsHuman },
      confidence: r.confidence,
    });
    return r;
  }
}
