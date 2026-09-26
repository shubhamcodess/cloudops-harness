import type { Provider, RepoProfile, SecretsManifest } from "@smc/contracts";

type Secret = SecretsManifest["secrets"][number];

const STORES: Record<Provider, SecretsManifest["store"]> = {
  aws: "aws-secrets-manager",
  gcp: "gcp-secret-manager",
  azure: "vault",
};

export function rotationDaysFor(name: string): number {
  const n = name.toUpperCase();
  if (/(DATABASE|DB|POSTGRES|MYSQL|MONGO|REDIS)/.test(n) && /(URL|URI|PASSWORD|PASS|USER|CRED|DSN)/.test(n)) return 30;
  if (/(JWT|SESSION|SIGNING|COOKIE)/.test(n)) return 180;
  return 90;
}

export function buildSecretsManifest(profile: RepoProfile, provider: Provider): SecretsManifest {
  const k8s = profile.hasHelm || profile.hasK8sManifests;
  const injection: Secret["injection"] = k8s ? "external-secret" : "env";
  const seen = new Set<string>();
  const secrets: Secret[] = [];
  const config: SecretsManifest["config"] = [];
  for (const v of [...profile.envVars].sort((a, b) => a.name.localeCompare(b.name))) {
    if (seen.has(v.name)) continue;
    seen.add(v.name);
    if (v.classification === "secret") secrets.push({ name: v.name, rotationDays: rotationDaysFor(v.name), injection });
    else if (v.classification === "config") config.push({ name: v.name, perEnv: /(URL|HOST|ENDPOINT|BUCKET|REGION|DOMAIN|ENV|LEVEL)/i.test(v.name) });
  }
  return { store: STORES[provider], secrets, config };
}

export function mockSecretEnv(manifest: SecretsManifest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of manifest.secrets) {
    const n = s.name.toUpperCase();
    if (/(DATABASE|POSTGRES).*(URL|URI|DSN)/.test(n)) out[s.name] = "postgresql://mock:mock@localhost:5432/mock";
    else if (/MYSQL.*(URL|URI|DSN)/.test(n)) out[s.name] = "mysql://mock:mock@localhost:3306/mock";
    else if (/MONGO.*(URL|URI)/.test(n)) out[s.name] = "mongodb://localhost:27017/mock";
    else if (/REDIS.*(URL|URI)/.test(n)) out[s.name] = "redis://localhost:6379";
    else out[s.name] = `mock-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-000`;
  }
  for (const c of manifest.config) out[c.name] = `mock-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return out;
}
