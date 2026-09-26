import { describe, expect, it } from "vitest";
import { assertNoSecrets, buildSecretsManifest, generateHandbook, mockSecretEnv, redact } from "../src/index.js";

const profile: any = {
  hasHelm: true, hasK8sManifests: false,
  envVars: [
    { name: "DATABASE_URL", classification: "secret", file: ".env" },
    { name: "STRIPE_API_KEY", classification: "secret", file: ".env" },
    { name: "JWT_SECRET", classification: "secret", file: ".env" },
    { name: "API_BASE_URL", classification: "config", file: ".env" },
    { name: "PORT", classification: "public", file: ".env" },
  ],
};
const candidate: any = {
  id: "gcp-eu-gke", provider: "gcp", architecture: "gcp-gke-autopilot", region: "europe-west1", monthlyUsd: 123.4,
  lines: [{ label: "GKE", quantity: 1, unit: "cluster", monthlyUsd: 73 }], assumptions: ["steady traffic"],
};
const req: any = { latencyP95Ms: 200, peakRps: 50, dataResidency: "eu", dataClasses: ["pii"], compliance: ["gdpr"], monthlyBudgetUsd: 200 };
const decision: any = { chosenId: "gcp-eu-gke", ranked: [], rejected: [{ id: "aws-lambda", reason: "too costly" }], rationale: ["Cheapest that meets EU residency."] };

describe("redact", () => {
  const cases: [string, string][] = [
    ["AKIAIOSFODNN7EXAMPLE", "aws-access-key"],
    ["-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----", "private-key"],
    ["Authorization: Bearer abcdefghijklmnop1234", "bearer-token"],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk123", "jwt"],
    ["API_KEY=Zk39sdf8QwErTy12Uio90Pl", "secret-assignment"],
    ["AIzaSyA1234567890abcdefghijklmnopqrstuv", "gcp-api-key"],
    ["sk-abcdefghijklmnopqrstuvwx", "openai-key"],
  ];
  for (const [t, k] of cases) it(`catches ${k}`, () => {
    expect(redact(t)).toContain(`[REDACTED:${k}]`);
    expect(() => assertNoSecrets(t)).toThrow();
  });
  it("leaves normal text alone", () => {
    const t = "Deploy the app to us-east-1. Set KEY=short and run tofu plan. The skill-set is fine.";
    expect(redact(t)).toBe(t);
    expect(() => assertNoSecrets(t)).not.toThrow();
  });
});

describe("secrets", () => {
  it("maps store, rotation, injection", () => {
    const m = buildSecretsManifest(profile, "gcp");
    expect(m.store).toBe("gcp-secret-manager");
    const by = Object.fromEntries(m.secrets.map((s) => [s.name, s]));
    expect(by.DATABASE_URL!.rotationDays).toBe(30);
    expect(by.STRIPE_API_KEY!.rotationDays).toBe(90);
    expect(by.JWT_SECRET!.rotationDays).toBe(180);
    expect(by.JWT_SECRET!.injection).toBe("external-secret");
    expect(m.config).toEqual([{ name: "API_BASE_URL", perEnv: true }]);
    expect(buildSecretsManifest(profile, "aws").store).toBe("aws-secrets-manager");
    expect(buildSecretsManifest({ ...profile, hasHelm: false }, "azure").secrets[0]!.injection).toBe("env");
    expect(buildSecretsManifest(profile, "azure").store).toBe("vault");
  });
  it("mock env is deterministic and fake", () => {
    const m = buildSecretsManifest(profile, "aws");
    const a = mockSecretEnv(m);
    expect(a).toEqual(mockSecretEnv(m));
    expect(a.DATABASE_URL).toContain("localhost");
    expect(a.STRIPE_API_KEY).toBe("mock-stripe-api-key-000");
    expect(() => assertNoSecrets(Object.entries(a).map(([k, v]) => `${k}=${v}`).join("\n"))).not.toThrow();
  });
});

describe("handbook", () => {
  const input = { profile, requirements: req, candidate: candidate, decision, secrets: buildSecretsManifest(profile, "gcp"), appName: "shop" };
  const files = generateHandbook(input);
  const book = files.find((f) => f.path.endsWith("DEPLOYMENT_HANDBOOK.md"))!.content;
  const agent = files.find((f) => f.path.endsWith("AGENT_RUNBOOK.md"))!.content;
  it("has key sections", () => {
    for (const h of ["Decision summary", "Prerequisites", "Rollback", "Secrets", "Scaling", "Cost monitoring", "Incident runbook", "GDPR", "Decommission"]) expect(book).toContain(h);
    expect(book).toContain("tofu init");
    expect(book).toContain("helm upgrade --install shop");
    expect(book).toContain("$123.40");
    expect(book).toContain("aws-lambda: too costly");
    expect(agent).toContain("STOP AND ASK HUMAN");
    expect(files.every((f) => f.kind === "docs")).toBe(true);
  });
  it("has no secret-like values and is deterministic", () => {
    expect(() => assertNoSecrets(book + agent)).not.toThrow();
    expect(generateHandbook(input)).toEqual(files);
  });
});
