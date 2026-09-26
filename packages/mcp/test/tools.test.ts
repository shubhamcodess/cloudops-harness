import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Sku } from "@smc/contracts";
import { RunStore } from "../src/store.js";
import { makeTools, memoryPriceBook } from "../src/tools.js";

const NODE_API = resolve(process.cwd(), "fixtures/node-api");

function fakeBook(): ReturnType<typeof memoryPriceBook> {
  const now = new Date().toISOString();
  const mk = (o: Partial<Sku> & Pick<Sku, "provider" | "service" | "skuId" | "description" | "region" | "unit" | "unitPrice">): Sku => ({
    currency: "USD", source: "fake", fetchedAt: now, ...o,
  });
  return memoryPriceBook([
    mk({ provider: "aws", service: "ec2", skuId: "ec2-t3med", description: "EC2 t3.medium on-demand", region: "eu-west-1", unit: "hour", unitPrice: 0.0464 }),
    mk({ provider: "aws", service: "data-transfer", skuId: "aws-egress", description: "AWS data transfer out", region: "eu-west-1", unit: "GB", unitPrice: 0.09 }),
  ]);
}

function freshStore() {
  return new RunStore({ root: mkdtempSync(join(tmpdir(), "smc-mcp-")) });
}

const REQUIRED_ANSWERS = {
  dataResidency: "eu",
  availabilityTarget: 0.99,
  latencyP95Ms: 250,
  peakRps: 20,
  userRegions: ["eu-west"],
  allowedProviders: ["aws"],
  dataClasses: ["none"],
  compliance: [],
};

describe("mcp tools: full run lifecycle", () => {
  it("walks created -> profiled -> requirements -> decided -> generated -> verified stages in order", async () => {
    const store = freshStore();
    const tools = makeTools(store, { priceBook: fakeBook() });

    const { runId } = await tools.start_run({ source: NODE_API });
    expect(store.get(runId).stage).toBe("created");

    const profile = await tools.analyze_repo({ runId });
    expect(profile.workloadType).toBe("service");
    expect(store.get(runId).stage).toBe("profiled");

    const submitted = tools.submit_answers({ runId, answers: REQUIRED_ANSWERS });
    expect(submitted.status).toBe("complete");
    expect(store.get(runId).stage).toBe("requirements");

    const priced = await tools.price_and_decide({ runId });
    expect(priced.chosen).toBeTruthy();
    expect(store.get(runId).stage).toBe("decided");

    const generated = tools.generate_artifacts({ runId });
    expect(generated.fileCount).toBeGreaterThan(0);
    expect(store.get(runId).stage).toBe("generated");

    const ledger = tools.get_ledger({ runId });
    expect(ledger.verify.ok).toBe(true);
  });

  it("completes the interview once optional fields are left unanswered", () => {
    const store = freshStore();
    const tools = makeTools(store, { priceBook: fakeBook() });
    const rec = store.create(NODE_API);
    rec.profile = {
      source: { kind: "path", ref: "." }, workloadType: "service", languages: ["ts"], packageManager: "pnpm",
      services: [], dockerable: true, hasDockerfile: false, hasCompose: false, hasHelm: false, hasTerraform: false,
      hasK8sManifests: false, ci: "none", datastores: [],
      ai: { isAi: false, frameworks: [], modelProviders: [], vectorDbs: [], mcpServer: false, mcpClient: false, needsSandbox: false },
      envVars: [], pii: [], evidence: [],
    };
    rec.stage = "profiled";
    store.save(rec);

    const remaining = tools.next_questions({ runId: rec.id }).remaining;
    expect(remaining.some((q) => q.id === "monthlyBudgetUsd" && q.optional)).toBe(true);

    // monthlyBudgetUsd/avgRps/existing are never provided, only required fields are.
    const result = tools.submit_answers({ runId: rec.id, answers: REQUIRED_ANSWERS });
    expect(result.status).toBe("complete");
  });

  it("rejects calling a tool before its required stage", async () => {
    const store = freshStore();
    const tools = makeTools(store, { priceBook: fakeBook() });
    const { runId } = await tools.start_run({ source: NODE_API });
    expect(() => tools.next_questions({ runId })).toThrow(/needs stage>=profiled/);
  });

  it("blocks deliver when verify failed", async () => {
    const store = freshStore();
    const tools = makeTools(store, { priceBook: fakeBook() });
    const rec = store.create(NODE_API);
    rec.stage = "verified";
    rec.proof = { verdict: "failed", checks: [], generatedAt: new Date().toISOString() } as never;
    store.save(rec);
    expect(() => tools.deliver({ runId: rec.id, mode: "write-to-directory", target: mkdtempSync(join(tmpdir(), "smc-out-")) }))
      .toThrow(/cannot deliver/);
  });
});

describe("mcp tools: select_candidate (budget-infeasible override)", () => {
  it("price_and_decide reports infeasible, and generate_artifacts is stuck until select_candidate runs", async () => {
    const store = freshStore();
    const tools = makeTools(store, { priceBook: fakeBook() });
    const { runId } = await tools.start_run({ source: NODE_API });
    await tools.analyze_repo({ runId });
    tools.submit_answers({ runId, answers: { ...REQUIRED_ANSWERS, monthlyBudgetUsd: 0.01 } });

    const priced = await tools.price_and_decide({ runId });
    expect(priced.feasible).toBe(false);
    expect(priced.chosen).toBeUndefined();
    expect(priced.candidates.length).toBeGreaterThan(0);
    expect(store.get(runId).stage).toBe("decided");

    // Exactly the stuck state from the real transcript: nothing chosen, generate_artifacts refuses.
    expect(() => tools.generate_artifacts({ runId })).toThrow(/no chosen candidate/);

    const pickId = priced.candidates[0]!.id;
    const picked = tools.select_candidate({ runId, candidateId: pickId });
    expect(picked.chosen).toBe(pickId);
    expect(picked.meets.budget).toBe(false);

    const generated = tools.generate_artifacts({ runId });
    expect(generated.fileCount).toBeGreaterThan(0);

    const ledger = tools.get_ledger({ runId });
    expect(ledger.verify.ok).toBe(true);
    const overrideEntry = ledger.entries.find((e) => e.rule === "select_candidate");
    expect(overrideEntry?.engine).toBe("human");
  });

  it("rejects an unknown candidate id", async () => {
    const store = freshStore();
    const tools = makeTools(store, { priceBook: fakeBook() });
    const { runId } = await tools.start_run({ source: NODE_API });
    await tools.analyze_repo({ runId });
    tools.submit_answers({ runId, answers: REQUIRED_ANSWERS });
    await tools.price_and_decide({ runId });
    expect(() => tools.select_candidate({ runId, candidateId: "not-a-real-candidate" })).toThrow(/candidate not found/);
  });

  it("rejects select_candidate before pricing has run", async () => {
    const store = freshStore();
    const tools = makeTools(store, { priceBook: fakeBook() });
    const { runId } = await tools.start_run({ source: NODE_API });
    expect(() => tools.select_candidate({ runId, candidateId: "x" })).toThrow(/needs stage>=decided/);
  });
});

describe("mcp tools: safety guards", () => {
  it("rejects a non-https clone source that is not a local path", async () => {
    const store = freshStore();
    const tools = makeTools(store, { priceBook: fakeBook() });
    await expect(tools.start_run({ source: "not-a-real-path" })).rejects.toThrow(/does not exist/);
  });

  it("deliver refuses a target outside the working directory", async () => {
    const store = freshStore();
    const tools = makeTools(store, { priceBook: fakeBook() });
    const rec = store.create(NODE_API);
    rec.stage = "verified";
    rec.proof = { verdict: "passed", checks: [], generatedAt: new Date().toISOString() } as never;
    store.save(rec);
    expect(() => tools.deliver({ runId: rec.id, mode: "write-to-directory", target: "/etc/passwd-smc-escape" }))
      .toThrow(/escapes cwd/);
  });
});
