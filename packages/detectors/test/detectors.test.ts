import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { detectRepo } from "../src/index.js";

const fx = (n: string) => join(__dirname, "../../../fixtures", n);
const run = async (n: string) => ({ ...(await detectRepo(fx(n))), source: { kind: "path" as const, ref: n } });

const NAMES = ["static-site", "node-api", "python-api", "npm-package", "mcp-server", "ai-agent", "rag-app", "monorepo-microservices", "pii-app", "java-monolith"];

describe("detectRepo", () => {
  it.each(NAMES)("snapshot %s", async (n) => {
    await expect(JSON.stringify(await run(n), null, 2) + "\n").toMatchFileSnapshot(`__snapshots__/${n}.json`);
  });

  it("is deterministic", async () => {
    for (const n of NAMES) expect(await detectRepo(fx(n))).toEqual(await detectRepo(fx(n)));
  });

  it("classifies workloads", async () => {
    const got = Object.fromEntries(await Promise.all(NAMES.map(async (n) => [n, (await run(n)).workloadType])));
    expect(got).toEqual({
      "static-site": "static-site",
      "node-api": "service",
      "python-api": "service",
      "npm-package": "package",
      "mcp-server": "mcp-server",
      "ai-agent": "ai-agent",
      "rag-app": "rag-app",
      "monorepo-microservices": "microservices",
      "pii-app": "service",
      "java-monolith": "monolith",
    });
  });

  it("node-api", async () => {
    const p = await run("node-api");
    expect(p).toMatchObject({ packageManager: "pnpm", hasDockerfile: true, ci: "github-actions", datastores: ["postgres"] });
    expect(p.services[0]).toMatchObject({ port: 3000, language: "typescript" });
    const cls = Object.fromEntries(p.envVars.map((e) => [e.name, e.classification]));
    expect(cls).toMatchObject({ DATABASE_URL: "secret", JWT_SECRET: "secret", PORT: "config", LOG_LEVEL: "config" });
  });

  it("python-api", async () => {
    const p = await run("python-api");
    expect(p).toMatchObject({ packageManager: "pip", languages: ["python"], datastores: ["redis"] });
    expect(p.services[0]).toMatchObject({ port: 8000, startCmd: "uvicorn main:app" });
  });

  it("ai fixtures", async () => {
    expect((await run("ai-agent")).ai).toMatchObject({ isAi: true, needsSandbox: true, modelProviders: ["openai"], vectorDbs: ["pinecone"], frameworks: ["langgraph"] });
    expect((await run("rag-app")).ai).toMatchObject({ vectorDbs: ["chromadb", "pgvector"], needsSandbox: false });
    expect((await run("mcp-server")).ai).toMatchObject({ mcpServer: true, mcpClient: false });
  });

  it("monorepo services and stores", async () => {
    const p = await run("monorepo-microservices");
    expect(p.services.map((s) => s.name)).toEqual(["orders", "web", "worker"]);
    expect(p.services.find((s) => s.name === "web")?.port).toBe(3000);
    expect(p.datastores).toEqual(["postgres", "rabbitmq"]);
    expect(p.hasCompose).toBe(true);
  });

  it("pii-app reports secrets and PII without values", async () => {
    const p = await run("pii-app");
    expect(p.pii.map((x) => x.signal)).toEqual(expect.arrayContaining(["email", "phone", "ip-address", "cookies", "date-of-birth", "analytics-sdk:segment", "analytics-sdk:mixpanel"]));
    expect(p.evidence.filter((e) => e.rule === "secret-in-code").map((e) => e.detail)).toEqual(expect.arrayContaining(["aws-access-key", "stripe-key"]));
    const s = JSON.stringify(p);
    expect(s).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(s).not.toContain("sk_test_EXAMPLE");
  });

  it("java-monolith", async () => {
    const p = await run("java-monolith");
    expect(p).toMatchObject({ packageManager: "maven", datastores: ["postgres"] });
    expect(p.services[0]).toMatchObject({ port: 8080, language: "java" });
  });

  it("every finding has evidence", async () => {
    for (const n of NAMES) expect((await run(n)).evidence.length).toBeGreaterThan(0);
  });
});
