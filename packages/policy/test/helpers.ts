import type { PriceBook } from "../src/pricebook.js";
import type { Provider, RepoProfile, Requirements, Sku } from "@smc/contracts";

export const now = "2026-09-26T00:00:00Z";

export function fakePrices(overrides: Array<Partial<Sku> & { unitPrice: number }> = []): PriceBook {
  const asList = <T>(x: T | T[] | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
  return {
    find(q) {
      const positives = asList(q.match);
      const negatives = asList(q.exclude);
      for (const o of overrides) {
        if (o.provider && o.provider !== q.provider) continue;
        if (o.region && o.region !== q.region) continue;
        if (o.service && o.service !== q.service) continue;
        const desc = `${o.description ?? ""} ${o.skuId ?? ""}`;
        if (!positives.some((r) => (r.lastIndex = 0, r.test(desc)))) continue;
        if (negatives.length && negatives.some((r) => (r.lastIndex = 0, r.test(desc)))) continue;
        if (q.unitPattern && !q.unitPattern.test(o.unit ?? "")) continue;
        if (q.unit && o.unit && q.unit !== o.unit) continue;
        return {
          provider: o.provider ?? q.provider,
          service: o.service ?? q.service,
          skuId: o.skuId ?? `${q.service}-${q.region}`,
          description: o.description ?? String(positives[0]),
          region: o.region ?? q.region,
          unit: o.unit ?? q.unit ?? "unit",
          unitPrice: o.unitPrice,
          currency: o.currency ?? "USD",
          source: o.source ?? "test",
          fetchedAt: now,
        };
      }
      return undefined;
    },
  };
}

export function serviceProfile(over: Partial<RepoProfile> = {}): RepoProfile {
  return {
    source: { kind: "path", ref: "/tmp/x" },
    workloadType: "service",
    languages: ["ts"],
    packageManager: "pnpm",
    services: [
      { name: "api", path: "packages/api", language: "ts", kind: "service", port: 3000, hasDockerfile: true },
    ],
    dockerable: true,
    hasDockerfile: true,
    hasCompose: false,
    hasHelm: false,
    hasTerraform: false,
    hasK8sManifests: false,
    ci: "github-actions",
    datastores: ["postgres"],
    ai: { isAi: false, frameworks: [], modelProviders: [], vectorDbs: [], mcpServer: false, mcpClient: false, needsSandbox: false },
    envVars: [],
    pii: [],
    evidence: [],
    ...over,
  };
}

export function staticProfile(): RepoProfile {
  return serviceProfile({ workloadType: "static-site", datastores: [], services: [] });
}

export function baseReq(over: Partial<Requirements> = {}): Requirements {
  return {
    latencyP95Ms: 400,
    availabilityTarget: 0.99,
    userRegions: ["eu"],
    peakRps: 50,
    avgRps: 10,
    dataResidency: "none",
    dataClasses: ["none"],
    compliance: [],
    allowedProviders: ["aws", "gcp", "azure"] as Provider[],
    ...over,
  };
}
